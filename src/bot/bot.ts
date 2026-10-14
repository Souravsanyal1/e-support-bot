import { Bot } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { updateLoggerMiddleware } from '../middleware/logging';
import { rateLimitMiddleware } from '../middleware/rateLimiter';
import { sanitizeMessageMiddleware } from '../middleware/sanitizer';
import { languageFilterMiddleware } from '../middleware/languageFilter';
import { badWordsFilterMiddleware } from '../middleware/badWordsFilter';
import { requireAdmin } from '../middleware/adminAuth';
import {
  handleStartCommand,
  handleHelpCommand,
  handleAboutCommand,
  handleAskCommand,
  handleTextMessage,
  handlePhotoMessage,
  handleChannelPost,
  handleNewChatMembers,
} from '../handlers/userHandler';
import {
  handleAdminStatus,
  handleAdminReload,
  handleAdminBroadcast,
  handleAdminUsers,
  handleAdminOff,
  handleAdminOn,
  handleAdminTime,
  handleAdminSync,
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

    logger.error('Unhandled error in Telegram Bot execution', error);

    // Channel posts are read-only inputs. Never send any error reply back to
    // a channel post, including when an upstream handler unexpectedly fails.
    if (ctx?.channelPost || ctx?.editedChannelPost) return;

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
  bot.use(languageFilterMiddleware);
  bot.use(badWordsFilterMiddleware);

  // Channel updates are registered explicitly for Telegram polling/webhooks.
  // These handlers only sync official posts and never call next or send a reply.
  bot.on('channel_post', handleChannelPost);
  bot.on('edited_channel_post', handleChannelPost);

  // 3. Public User Commands
  bot.command('start', handleStartCommand);
  bot.command('help', handleHelpCommand);
  bot.command('about', handleAboutCommand);
  bot.command('ask', handleAskCommand);

  // 4. Admin-Only Commands (Protected by requireAdmin middleware)
  bot.command('status', requireAdmin, handleAdminStatus);
  bot.command('reload', requireAdmin, handleAdminReload);
  bot.command('sync', requireAdmin, handleAdminSync);
  bot.command('broadcast', requireAdmin, handleAdminBroadcast);
  bot.command('users', requireAdmin, handleAdminUsers);
  bot.command('off', requireAdmin, handleAdminOff);
  bot.command('on', requireAdmin, handleAdminOn);
  bot.command('time', requireAdmin, handleAdminTime);

  // 5. Natural Conversational Text Messages
  bot.on('message:text', handleTextMessage);

  // 6. User Photo & Image Analysis
  bot.on('message:photo', handlePhotoMessage);
  bot.on('message:document', async (ctx, next) => {
    if (ctx.message?.document?.mime_type?.startsWith('image/')) {
      await handlePhotoMessage(ctx);
    } else {
      await next();
    }
  });

  // 7. Community Group Member Updates (Welcome message when bot joins)
  bot.on('message:new_chat_members', handleNewChatMembers);

  return bot;
}
