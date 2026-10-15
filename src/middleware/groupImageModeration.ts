import { Context, NextFunction } from 'grammy';
import { GROUP_MEDIA_POLICY } from '../config/bot.config';
import { isAdmin } from './adminAuth';
import { logger } from '../utils/logger';
import { scheduleAutoDelete } from '../utils/telegram';
import { isImageMessage } from '../utils/imageDetector';

/**
 * Global Group Image Moderation Middleware.
 *
 * Implements Instant Image Removal in Group and Supergroup Chats:
 * 1. Identifies chat type.
 * 2. If group / supergroup:
 *    - Detects if incoming message or edited message contains an image.
 *    - If detected, IMMEDIATELY deletes the message using Telegram's deleteMessage API
 *      BEFORE any AI processing, downloading, queueing, or downstream handler execution.
 *    - Stops processing immediately (does NOT call next()).
 *    - Respects sendWarningInGroups configuration (no warning unless explicitly configured).
 *    - Handles API errors gracefully (missing permissions, already deleted, etc.).
 *    - Logs deletion status without logging image contents.
 * 3. If private chat:
 *    - Passes through untouched to AI Vision analysis.
 */
export async function groupImageModerationMiddleware(
  ctx: Context,
  next: NextFunction
): Promise<void> {
  const chat = ctx.chat;
  const isGroup = chat?.type === 'group' || chat?.type === 'supergroup';

  // Private chats and channels bypass group image deletion and proceed to standard handlers
  if (!isGroup) {
    await next();
    return;
  }

  // Identify incoming message or edited message
  const targetMessage = ctx.message || ctx.editedMessage;
  if (!targetMessage) {
    await next();
    return;
  }

  // Detect image across all supported formats and Telegram representations
  const containsImage = isImageMessage(targetMessage);
  if (!containsImage) {
    await next();
    return;
  }

  // If group image blocking policy is disabled, allow through
  if (!GROUP_MEDIA_POLICY.blockAllImagesInGroups) {
    await next();
    return;
  }

  // Check if sender is configured administrator and admin images are allowed
  const senderId = ctx.from?.id;
  const isSenderAdmin = senderId ? isAdmin(senderId) : false;
  if (isSenderAdmin && GROUP_MEDIA_POLICY.allowAdminImagesInGroups) {
    await next();
    return;
  }

  // ── INSTANT GROUP IMAGE REMOVAL ──────────────────────────────────────────
  // Delete the original message immediately before any AI processing, downloading, or queueing.
  const messageId = targetMessage.message_id;

  try {
    await ctx.api.deleteMessage(chat.id, messageId);
    logger.info('Deleted image from group chat', {
      chatId: chat.id,
      messageId,
      fromUserId: senderId,
    });
  } catch (err) {
    logger.warn('Failed to delete image from group chat (bot may lack delete permissions)', {
      chatId: chat.id,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Do not send a warning or reply in the group unless explicitly configured
  if (GROUP_MEDIA_POLICY.sendWarningInGroups) {
    try {
      const warningMsg = await ctx.reply(GROUP_MEDIA_POLICY.warningMessage);
      if (warningMsg?.message_id && GROUP_MEDIA_POLICY.warningAutoDeleteMs > 0) {
        scheduleAutoDelete(ctx, warningMsg.message_id, GROUP_MEDIA_POLICY.warningAutoDeleteMs);
      }
    } catch {
      // Non-fatal, suppress reply errors
    }
  }

  // Stop processing immediately: do not call next(), do not pass to AI vision
  return;
}
