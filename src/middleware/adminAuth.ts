import { Context, NextFunction } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

/**
 * Middleware that strictly verifies that the user is an authorized administrator.
 * Normal users will be blocked from executing admin commands.
 */
export async function requireAdmin(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply('⛔ Action not permitted.');
    return;
  }

  if (env.adminUserIds.size === 0) {
    logger.warn('Admin command attempted but no ADMIN_USER_IDS are configured.');
    await ctx.reply(
      '⚠️ Administrator features are currently disabled. No admin user IDs have been configured in server settings.'
    );
    return;
  }

  if (!env.adminUserIds.has(userId)) {
    logger.warn('Unauthorized admin command attempt');
    await ctx.reply('⛔ Access denied. This command is reserved for administrators.');
    return;
  }

  await next();
}
