import { Context, NextFunction } from 'grammy';
import { logger } from '../utils/logger';

/**
 * Middleware that logs metadata about incoming updates safely.
 * Never stores or logs private user credentials, tokens, or PII.
 */
export async function updateLoggerMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const start = Date.now();
  const updateId = ctx.update.update_id;
  const isCommand = ctx.message?.text?.startsWith('/');
  const commandName = isCommand ? ctx.message?.text?.split(' ')[0] : undefined;

  logger.debug('Incoming Telegram update', {
    updateId,
    hasText: Boolean(ctx.message?.text),
    textLength: ctx.message?.text?.length,
    command: commandName,
  });

  try {
    await next();
  } finally {
    const elapsed = Date.now() - start;
    logger.debug('Completed processing update', {
      updateId,
      elapsedMs: elapsed,
    });
  }
}
