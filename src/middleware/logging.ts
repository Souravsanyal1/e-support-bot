import { Context, NextFunction } from 'grammy';
import { logger } from '../utils/logger';

/**
 * Middleware that logs metadata about incoming updates safely.
 * Never stores or logs private user credentials, tokens, or PII.
 */
export async function updateLoggerMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const start = Date.now();
  // Keep operational logs anonymous: do not log Telegram IDs, message content,
  // lengths, or command names.
  const updateType = Object.keys(ctx.update).find((key) => key !== 'update_id') || 'unknown';

  logger.debug('Incoming Telegram update', { updateType });

  try {
    await next();
  } finally {
    const elapsed = Date.now() - start;
    logger.debug('Completed processing update', {
      updateType,
      elapsedMs: elapsed,
    });
  }
}
