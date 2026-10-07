import { Bot } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { updateLoggerMiddleware } from '../middleware/logging';
import { rateLimitMiddleware } from '../middleware/rateLimiter';
import { sanitizeMessageMiddleware } from '../middleware/sanitizer';
import { requireAdmin } from '../middleware/adminAuth';
import {
  handleStartCommand,
  handleHelpCommand,
  handleAboutCommand,
  handleAskCommand,
  handleTextMessage,
  handleChannelPost,
  handleNewChatMembers,
} from '../handlers/userHandler';
import {
  handleAdminStatus,
  handleAdminReload,
  handleAdminBroadcast,
  handleAdminUsers,
} from '../handlers/adminHandler';

/**
 * Initializes and configures the GrammY Telegram Bot instance.
 */
export function createBot(): Bot {
  const bot = new Bot(env.telegramBotToken);

  // 1. Global Safe Error Boundary
  bot.catch((err) => {
    const ctx = err.ctx;
    const error = err.error;

    logger.error('Unhandled error in Telegram Bot execution', error, {
      updateId: ctx?.update?.update_id,
      userId: ctx?.from?.id,
    });

    // Provide friendly, non-technical feedback to user without exposing stack traces
    try {
      ctx.reply(
        '⚠️ An unexpected error occurred while processing your request. Please try again in a few moments.'
      ).catch(() => {
        // Silently swallow reply errors in global catch
      });
    } catch {
      // Ignore
    }
  });

  // 2. Global Middlewares
  bot.use(updateLoggerMiddleware);
  bot.use(rateLimitMiddleware);
  bot.use(sanitizeMessageMiddleware);

  // 3. Public User Commands
  bot.command('start', handleStartCommand);
  bot.command('help', handleHelpCommand);
  bot.command('about', handleAboutCommand);
  bot.command('ask', handleAskCommand);

  // 4. Admin-Only Commands (Protected by requireAdmin middleware)
  bot.command('status', requireAdmin, handleAdminStatus);
  bot.command('reload', requireAdmin, handleAdminReload);
  bot.command('broadcast', requireAdmin, handleAdminBroadcast);
  bot.command('users', requireAdmin, handleAdminUsers);

  // 5. Natural Conversational Text Messages
  bot.on('message:text', handleTextMessage);

  // Channel posts use a separate Telegram update type from regular messages.
  bot.on('channel_post:text', handleChannelPost);

  // 6. Community Group Member Updates (Welcome message when bot joins)
  bot.on('message:new_chat_members', handleNewChatMembers);

  return bot;
}
