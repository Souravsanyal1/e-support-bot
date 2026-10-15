import { Context, NextFunction } from 'grammy';
import { env } from '../config/env.config';
import { LANGUAGE_POLICY } from '../config/bot.config';
import { logger } from '../utils/logger';
import { checkMessageLanguage, processAndFilterMessageLanguage } from '../utils/languageDetector';
import { scheduleAutoDelete } from '../utils/telegram';
import { languageModeManager } from '../bot/languageMode';

/**
 * Global Language Moderation Middleware.
 *
 * Rules:
 * 1. Checks every incoming text message, edited message, and photo caption.
 * 2. Strictly permits English only. Rejects Bengali, Banglish, Hindi, Arabic,
 *    and other non-English languages.
 * 3. Handles mixed-language messages: if substantial non-English content is present,
 *    it is rejected.
 * 4. Telegram Groups: Deletes non-English message if bot has permissions; handles
 *    errors gracefully if deletion fails. Sends a 2-minute auto-deleted warning notice.
 * 5. Private Chats: Telegram does not allow bots to delete user messages in DMs.
 *    Rejects the request and responds with a warning notice without attempting deletion.
 * 6. Never forwards rejected messages to Gemini or OpenRouter fallback.
 */
export async function languageFilterMiddleware(
  ctx: Context,
  next: NextFunction
): Promise<void> {
  // If language moderation policy is globally disabled in config, pass through
  if (!LANGUAGE_POLICY.enabled) {
    await next();
    return;
  }

  // Runtime override: admin used /language all → bypass all language filtering
  if (languageModeManager.isAllLanguagesAllowed()) {
    await next();
    return;
  }

  // 1. Channel post updates are read-only official announcements synced to knowledge
  if (ctx.channelPost || ctx.editedChannelPost) {
    await next();
    return;
  }

  // 2. Extract message from standard or edited message update
  const message = ctx.message || ctx.editedMessage;
  const rawText = message?.text || message?.caption;

  // If update has no text/caption (e.g. service update, sticker), pass through
  if (!rawText) {
    await next();
    return;
  }

  // 3. Admin exemption: Authorized admin commands bypass language moderation
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

  // 5. Check if this is an /ask command
  const askMatch = trimmed.match(/^\/ask(@\w+)?(?:\s+(.*))?$/i);
  const isAskCommand = Boolean(askMatch);
  let textToCheck = trimmed;

  if (isAskCommand) {
    const query = askMatch?.[2]?.trim() || '';
    if (!query) {
      // Empty /ask command -> pass through to user handler for usage help
      await next();
      return;
    }
    textToCheck = query;
  }

  // 6. Language Detection and Validation
  const langCheck = checkMessageLanguage(textToCheck);
  const processed = processAndFilterMessageLanguage(textToCheck);

  // If detected as non-English or contains substantial non-English (including mixed)
  const isRejected = !langCheck.isEnglish || !processed.isAllowed;

  if (isRejected) {
    const isPrivate = ctx.chat?.type === 'private';
    const detectedLangs =
      processed.detectedNonEnglishLanguages.length > 0
        ? processed.detectedNonEnglishLanguages
        : [langCheck.language];

    logger.info('Moderating non-English message (rejecting without AI processing)', {
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      messageId: ctx.msg?.message_id,
      fromUserId: ctx.from?.id,
      detectedLanguages: detectedLangs,
      isMixed: langCheck.isMixed || processed.isMixed,
      reason: langCheck.reason || processed.reason,
      snippet: textToCheck.slice(0, 60),
    });

    // 7. Instant Message Deletion Across All Chats (Private DMs & Groups)
    try {
      await ctx.deleteMessage();
      logger.info('Deleted non-English message', {
        chatId: ctx.chat?.id,
        chatType: ctx.chat?.type,
        messageId: ctx.msg?.message_id,
      });
    } catch (deleteError) {
      logger.warn('Failed to delete non-English message', {
        chatId: ctx.chat?.id,
        chatType: ctx.chat?.type,
        messageId: ctx.msg?.message_id,
        error: deleteError instanceof Error ? deleteError.message : String(deleteError),
      });
    }

    // Send temporary warning notice with auto-delete timer
    const shouldSendWarning = isPrivate
      ? LANGUAGE_POLICY.sendWarningInPrivate
      : LANGUAGE_POLICY.sendWarningInGroups;

    if (shouldSendWarning) {
      try {
        const warningMsg = await ctx.reply(LANGUAGE_POLICY.warningMessage);
        if (warningMsg?.message_id && LANGUAGE_POLICY.warningAutoDeleteMs > 0) {
          scheduleAutoDelete(ctx, warningMsg.message_id, LANGUAGE_POLICY.warningAutoDeleteMs);
        }
      } catch {
        // Silently swallow reply errors
      }
    }

    // Crucial: Reject immediately. Do NOT answer non-English content, do NOT call next()
    return;
  }

  // Clean English message -> continue to next handlers
  await next();
}
