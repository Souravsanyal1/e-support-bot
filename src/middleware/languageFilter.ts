import { Context, NextFunction } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { processAndFilterMessageLanguage } from '../utils/languageDetector';
import { scheduleAutoDelete } from '../utils/telegram';

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
  const askMatch = trimmed.match(/^\/ask(@\w+)?(?:\s+(.*))?$/i);
  const isAskCommand = Boolean(askMatch);
  let textToCheck = trimmed;

  if (isAskCommand) {
    const query = askMatch?.[2]?.trim() || '';
    if (!query) {
      // Empty /ask command -> pass through to show usage instructions
      await next();
      return;
    }
    textToCheck = query;
  }

  // 6. Processing Flow:
  // 1. Detect language -> 2. Remove non-English content -> 3. Process remaining English text -> 4. Respond only in English
  const processed = processAndFilterMessageLanguage(textToCheck);

  if (processed.hasNonEnglish && processed.hasEnglish) {
    // Mixed message: Non-English content stripped, remaining English text preserved
    logger.info('Stripped non-English content from mixed message, preserving remaining English text', {
      chatId: ctx.chat?.id,
      messageId: ctx.msg?.message_id,
      fromUserId: ctx.from?.id,
      removedLanguages: processed.detectedNonEnglishLanguages,
      removedFragments: processed.removedContent,
      cleanedEnglishText: processed.cleanedEnglishText,
    });

    // Update message text in-place with the clean English content
    const updatedContent = isAskCommand
      ? `/ask ${processed.cleanedEnglishText}`
      : processed.cleanedEnglishText;

    if (message.text) message.text = updatedContent;
    if (message.caption) message.caption = updatedContent;

    await next();
    return;
  }

  if (!processed.hasEnglish) {
    // Purely non-English message: Do not process content; send English-only notification & delete
    logger.info('Moderating pure non-English message (deleting and suppressing non-English response)', {
      chatId: ctx.chat?.id,
      messageId: ctx.msg?.message_id,
      fromUserId: ctx.from?.id,
      detectedLanguages: processed.detectedNonEnglishLanguages,
      snippet: textToCheck.slice(0, 60),
    });

    // Delete the incoming non-English message from Telegram
    try {
      await ctx.deleteMessage();
    } catch (deleteError) {
      logger.warn('Failed to delete non-English message (bot may lack delete permissions in group)', {
        chatId: ctx.chat?.id,
        messageId: ctx.msg?.message_id,
        error: deleteError instanceof Error ? deleteError.message : String(deleteError),
      });
    }

    // Notify that only English is supported, and auto-delete this warning after 2 minutes (120,000 ms)
    try {
      const warningMsg = await ctx.reply(
        '⚠️ Only English is supported. Please ask your question in English.'
      );
      if (warningMsg?.message_id) {
        scheduleAutoDelete(ctx, warningMsg.message_id, 2 * 60 * 1000);
      }
    } catch {
      // Silently swallow reply errors
    }

    // Crucial: Do NOT answer non-English content, do NOT call next()
    return;
  }

  // Pure clean English message -> continue to next handlers
  await next();
}
