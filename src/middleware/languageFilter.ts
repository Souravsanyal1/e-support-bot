import { Context, NextFunction } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { checkMessageLanguage } from '../utils/languageDetector';

/**
 * Global Language Moderation Middleware.
 *
 * Rules:
 * - If a message is sent in Bengali (Bangla script) or Banglish (Romanized Bengali):
 *   -> Instantly removes / deletes the message from the chat.
 *   -> Completely suppresses any reply (no answer or error sent).
 * - If a message is in any language other than English (non-English):
 *   -> Removes / deletes the message from the chat.
 *   -> Completely suppresses any reply.
 * - Only clear, natural English messages are permitted to proceed.
 */
export async function languageFilterMiddleware(
  ctx: Context,
  next: NextFunction
): Promise<void> {
  // 1. Channel post updates are read-only official announcements synced to knowledge
  if (ctx.channelPost || ctx.editedChannelPost) {
    await next();
    return;
  }

  const message = ctx.message;
  const rawText = message?.text || message?.caption;

  // 2. If update has no text/caption (e.g. member joins, service updates), pass through
  if (!rawText) {
    await next();
    return;
  }

  // 3. Admin exemption for admin commands
  const userId = ctx.from?.id;
  if (userId && env.adminUserIds.has(userId) && rawText.startsWith('/')) {
    await next();
    return;
  }

  const trimmed = rawText.trim();

  // 4. Exact standard public commands (e.g. /start, /help, /about)
  if (/^\/(start|help|about)(@\w+)?$/i.test(trimmed)) {
    await next();
    return;
  }

  // 5. Determine text to evaluate
  let textToCheck = trimmed;
  const askMatch = trimmed.match(/^\/ask(@\w+)?(?:\s+(.*))?$/i);
  if (askMatch) {
    const query = askMatch[2]?.trim() || '';
    if (!query) {
      // Empty /ask command -> pass through to show usage instructions
      await next();
      return;
    }
    textToCheck = query;
  }

  // 6. Evaluate message language
  const check = checkMessageLanguage(textToCheck);

  if (!check.isEnglish) {
    logger.info('Moderating non-English/Bangla/Banglish message (deleting without reply)', {
      chatId: ctx.chat?.id,
      messageId: ctx.msg?.message_id,
      fromUserId: ctx.from?.id,
      detectedLanguage: check.language,
      reason: check.reason,
      snippet: textToCheck.slice(0, 60),
    });

    // Delete the incoming message from Telegram
    try {
      await ctx.deleteMessage();
    } catch (deleteError) {
      logger.warn('Failed to delete non-English message (bot may lack delete permissions in group)', {
        chatId: ctx.chat?.id,
        messageId: ctx.msg?.message_id,
        error: deleteError instanceof Error ? deleteError.message : String(deleteError),
      });
    }

    // Crucial: Do NOT reply, do NOT call next()
    return;
  }

  // Message is valid English -> continue to standard handlers
  await next();
}
