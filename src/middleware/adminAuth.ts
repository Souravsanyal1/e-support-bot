import { Context, NextFunction } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { subAdminManager } from '../services/subAdminManager';

/**
 * Helper to check if a numeric user ID is an authorized admin.
 */
export function isAdmin(userId?: number): boolean {
  if (!userId) {
    return false;
  }
  if (env.adminUserIds.has(userId) || subAdminManager.isSubAdmin(userId)) {
    return true;
  }
  // Also check runtime environment variables directly
  const envAdmin = [process.env.TELEGRAM_ADMIN_ID, process.env.ADMIN_USER_IDS].filter(Boolean).join(',');
  if (envAdmin) {
    for (const rawId of envAdmin.split(',')) {
      const parsed = parseInt(rawId.trim(), 10);
      if (!isNaN(parsed) && parsed === userId) {
        return true;
      }
    }
  }
  return false;
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
