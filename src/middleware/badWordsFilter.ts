import { Context, NextFunction } from 'grammy';
import { logger } from '../utils/logger';
import { checkBadWords } from '../utils/badWordsDetector';
import { isAdmin } from './adminAuth';

/**
 * Global English Bad Words & Profanity Moderation Middleware.
 *
 * Rules:
 * - If a message contains abusive language, profanity, swear words, slurs, or vulgar bad words:
 *   -> Instantly deletes / removes the message from the chat.
 *   -> Completely suppresses any reply (no answer or error sent).
 * - Only respectful, clean messages are permitted to proceed.
 */
export async function badWordsFilterMiddleware(
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
  if (userId && isAdmin(userId) && rawText.startsWith('/')) {
    await next();
    return;
  }

  const trimmed = rawText.trim();

  // 4. Exact standard public commands without parameters (e.g. /start, /help, /about)
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
      await next();
      return;
    }
    textToCheck = query;
  }

  // 6. Check for bad words / profanity
  const check = checkBadWords(textToCheck);

  if (check.hasBadWords) {
    logger.info('Moderating bad word / profanity message in English (deleting without reply)', {
      chatId: ctx.chat?.id,
      messageId: ctx.msg?.message_id,
      fromUserId: ctx.from?.id,
      severity: check.severity,
      categories: check.categories,
      isTargetedAbuse: check.isTargetedAbuse,
      isObfuscated: check.isObfuscated,
      detectedWords: check.detectedWords,
      reason: check.reason,
      snippet: textToCheck.slice(0, 60),
    });

    // Delete the incoming abusive/profane message from Telegram
    try {
      await ctx.deleteMessage();
    } catch (deleteError) {
      logger.warn('Failed to delete bad word message (bot may lack delete permissions in group)', {
        chatId: ctx.chat?.id,
        messageId: ctx.msg?.message_id,
        error: deleteError instanceof Error ? deleteError.message : String(deleteError),
      });
    }

    // Crucial: Do NOT reply, do NOT call next()
    return;
  }

  // Message is clean -> continue to next middleware / handlers
  await next();
}
