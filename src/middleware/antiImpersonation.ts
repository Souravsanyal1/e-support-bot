import { Context, NextFunction } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { safeReply } from '../utils/telegram';
import { detectSuspiciousContactPromotion, OFFICIAL_SAFETY_NOTICE } from '../utils/antiImpersonation';

/** Blocks risky promotions of unofficial support/admin contacts in group chats. */
export async function antiImpersonationMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
    await next();
    return;
  }

  const text = ctx.message?.text ?? ctx.message?.caption;
  if (!text) {
    await next();
    return;
  }

  const finding = detectSuspiciousContactPromotion(text);
  if (!finding) {
    await next();
    return;
  }

  let deleted = false;
  if (env.antiImpersonationAutoDelete) {
    try {
      await ctx.deleteMessage();
      deleted = true;
    } catch (error) {
      logger.warn('Could not delete suspicious unofficial-contact promotion', {
        chatId: ctx.chat.id,
        messageId: ctx.msg?.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.warn('Blocked suspicious unofficial support/contact promotion', {
    chatId: ctx.chat.id,
    messageId: ctx.msg?.message_id,
    userId: ctx.from?.id,
    handleCount: finding.handleCount,
    deleted,
  });

  // Never pass a flagged promotion to the AI, even if deletion is disabled or fails.
  try {
    await safeReply(ctx, OFFICIAL_SAFETY_NOTICE, { replyToMessage: true });
  } catch (error) {
    logger.warn('Could not send anti-impersonation safety notice', {
      chatId: ctx.chat.id,
      messageId: ctx.msg?.message_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
