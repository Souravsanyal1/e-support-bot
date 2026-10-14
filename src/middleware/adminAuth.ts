import { Context, NextFunction } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

/**
 * Helper to check if a numeric user ID is an authorized admin.
 */
export function isAdmin(userId?: number): boolean {
  if (!userId || env.adminUserIds.size === 0) {
    return false;
  }
  return env.adminUserIds.has(userId);
}

/**
 * Middleware that strictly verifies that the user is an authorized administrator.
 * Unauthorized users receive a generic 'Unknown command.' message so that
 * admin commands are completely indistinguishable from non-existent commands.
 */
export async function requireAdmin(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId || !isAdmin(userId)) {
    logger.warn('Unauthorized command attempt blocked by adminAuth guard', {
      fromUserId: userId,
      chatId: ctx.chat?.id,
    });
    // Return a generic response to prevent information leakage
    await ctx.reply('Unknown command. Type /help to see available commands.');
    return;
  }

  await next();
}
