import { Context, NextFunction } from 'grammy';
import { logger } from '../utils/logger';
import { checkBadWords } from '../utils/badWordsDetector';
import { isAdmin } from './adminAuth';
import { env, AppConfig } from '../config/env.config';
import { scheduleAutoDelete } from '../utils/telegram';
import { LANGUAGE_POLICY } from '../config/bot.config';
import { recordProfanityViolation } from '../services/profanityEscalation';

type BadWordsFilterSettings = Pick<AppConfig,
  'profanityFilterEnabled' | 'profanityAutoDelete' | 'profanityAdminExempt' |
  'profanityWarnUser' | 'profanityStrictMode' | 'profanityRepeatOffenderEscalation' | 'adminUserIds'>;

/**
 * Global English Bad Words & Profanity Moderation Middleware.
 *
 * Enforces configured severity, strict-mode, deletion, warning, and
 * admin-exemption settings. Medium-severity findings pass when strict mode is
 * disabled; blocked messages never reach AI handlers.
 */
export async function badWordsFilterMiddleware(
  ctx: Context,
  next: NextFunction,
  overrides: Partial<BadWordsFilterSettings> = {}
): Promise<void> {
  const settings: BadWordsFilterSettings = {
    profanityFilterEnabled: env.profanityFilterEnabled,
    profanityAutoDelete: env.profanityAutoDelete,
    profanityAdminExempt: env.profanityAdminExempt,
    profanityWarnUser: env.profanityWarnUser,
    profanityStrictMode: env.profanityStrictMode,
    profanityRepeatOffenderEscalation: env.profanityRepeatOffenderEscalation,
    adminUserIds: env.adminUserIds,
    ...overrides,
  };

  // 1. Channel post updates are read-only official announcements synced to knowledge
  if (ctx.channelPost || ctx.editedChannelPost) {
    await next();
    return;
  }

  if (!settings.profanityFilterEnabled) {
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

  // 3. Configured admin exemption applies to every message from an authorized admin.
  const userId = ctx.from?.id;
  if (userId && isAdmin(userId) && (settings.profanityAdminExempt || rawText.startsWith('/'))) {
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

  const isModerationViolation = check.hasBadWords && (
    settings.profanityStrictMode || check.severity !== 'medium'
  );

  if (isModerationViolation) {
    let escalationCount: number | undefined;
    if (settings.profanityRepeatOffenderEscalation && userId !== undefined) {
      const escalation = recordProfanityViolation(userId);
      escalationCount = escalation.count;
      if (escalation.shouldEscalate) {
        const notice = [
          'Profanity moderation escalation',
          `User ID: ${userId}`,
          `Chat ID: ${ctx.chat?.id ?? 'unknown'}`,
          `Severity: ${check.severity ?? 'unknown'}`,
          `Violations in 24 hours: ${escalation.count}`,
        ].join('\n');
        await Promise.all(Array.from(settings.adminUserIds, async (adminId) => {
          try {
            await ctx.api.sendMessage(adminId, notice);
          } catch (error) {
            logger.warn('Could not send profanity escalation to configured admin', {
              adminId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }));
      }
    }

    logger.info('Moderating message under configured profanity policy', {
      chatId: ctx.chat?.id,
      messageId: ctx.msg?.message_id,
      fromUserId: ctx.from?.id,
      severity: check.severity,
      categories: check.categories,
      isTargetedAbuse: check.isTargetedAbuse,
      isObfuscated: check.isObfuscated,
      detectedWords: check.detectedWords,
      reason: check.reason,
      escalationCount,
    });

    // A violation is withheld from AI handling even when message deletion is disabled.
    if (settings.profanityAutoDelete) {
      try {
        await ctx.deleteMessage();
      } catch (deleteError) {
        logger.warn('Failed to delete bad word message (bot may lack delete permissions in group)', {
          chatId: ctx.chat?.id,
          messageId: ctx.msg?.message_id,
          error: deleteError instanceof Error ? deleteError.message : String(deleteError),
        });
      }
    }

    if (settings.profanityWarnUser) {
      try {
        const warning = await ctx.reply('⚠️ Please keep messages respectful and avoid abusive language.');
        if (warning?.message_id && LANGUAGE_POLICY.warningAutoDeleteMs > 0) {
          scheduleAutoDelete(ctx, warning.message_id, LANGUAGE_POLICY.warningAutoDeleteMs);
        }
      } catch {
        // Warning failures do not allow a flagged message through to AI handling.
      }
    }

    // Crucial: Do NOT reply, do NOT call next()
    return;
  }

  // Message is clean -> continue to next middleware / handlers
  await next();
}
