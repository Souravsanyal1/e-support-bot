import { Bot } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { updateLoggerMiddleware } from '../middleware/logging';
import { rateLimitMiddleware } from '../middleware/rateLimiter';
import { sanitizeMessageMiddleware } from '../middleware/sanitizer';
import { languageFilterMiddleware } from '../middleware/languageFilter';
import { badWordsFilterMiddleware } from '../middleware/badWordsFilter';
import { antiImpersonationMiddleware } from '../middleware/antiImpersonation';
import { requireAdmin } from '../middleware/adminAuth';
import { handleAdminBan, handleAdminLimit } from '../handlers/moderationHandler';
import {
  handleStartCommand,
  handleHelpCommand,
  handleAboutCommand,
  handleAskCommand,
  handleTextMessage,
  handlePhotoMessage,
  handleDocumentAsImage,
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
  handleAdminLookup,
  handleAdminLogs,
  handleAdminClearLogs,
  handleAdminLanguage,
  handleAdminSubAdmin,
} from '../handlers/adminHandler';
import { groupImageModerationMiddleware } from '../middleware/groupImageModeration';
import { isImageDocument } from '../utils/imageDetector';
import {
  handleQuizCommand,
  handlePointCommand,
  handleQuizCallback,
} from '../handlers/quizHandler';
import { botStateManager } from './state';
import { queuePausedMessage, replayPausedMessages } from '../services/pausedMessageQueue';

/**
 * Initializes and configures the GrammY Telegram Bot instance.
 */
export function createBot(): Bot {
  const bot = new Bot(env.telegramBotToken);
  const recentUpdateIds = new Set<number>();

  // Telegram may redeliver an update after a transient polling/network error.
  // Claim it before any middleware can send a sticker or reply twice.
  bot.use(async (ctx, next) => {
    const updateId = ctx.update.update_id;
    if (recentUpdateIds.has(updateId)) return;
    recentUpdateIds.add(updateId);
    if (recentUpdateIds.size > 2000) {
      const oldest = recentUpdateIds.values().next().value;
      if (oldest !== undefined) recentUpdateIds.delete(oldest);
    }
    await next();
  });

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
  bot.use(groupImageModerationMiddleware); // Instant image removal in groups before any other processing
  bot.use(rateLimitMiddleware);
  bot.use(sanitizeMessageMiddleware);
  bot.use(antiImpersonationMiddleware);
  bot.use(languageFilterMiddleware);
  bot.use(badWordsFilterMiddleware);
  // Queue valid text updates during /off; command messages still reach handlers
  // so an administrator can use /on to resume the bot.
  bot.use(async (ctx, next) => {
    if (botStateManager.isUserFacingActive()) {
      await next();
      return;
    }
    if (queuePausedMessage(ctx)) return;
    await next();
  });
  botStateManager.setOnReactivateCallback(async () => {
    await replayPausedMessages((ctx) => handleTextMessage(ctx, { replayingPausedMessage: true }));
  });

  // Channel updates are registered explicitly for Telegram polling/webhooks.
  // These handlers only sync official posts and never call next or send a reply.
  bot.on('channel_post', handleChannelPost);
  bot.on('edited_channel_post', handleChannelPost);

  // 3. Public User Commands
  bot.command('start', handleStartCommand);
  bot.command('help', handleHelpCommand);
  bot.command('about', handleAboutCommand);
  bot.command('ask', handleAskCommand);
  bot.command(['point', 'points'], handlePointCommand);
  bot.command('quiz', handleQuizCommand);

  // Interactive Quiz Option Callbacks
  bot.callbackQuery(/^quiz_ans:/, handleQuizCallback);

  // 4. Admin-Only Commands (Protected by requireAdmin middleware)
  bot.command('status', requireAdmin, handleAdminStatus);
  bot.command('reload', requireAdmin, handleAdminReload);
  bot.command('sync', requireAdmin, handleAdminSync);
  bot.command('broadcast', requireAdmin, handleAdminBroadcast);
  bot.command('users', requireAdmin, handleAdminUsers);
  bot.command('off', requireAdmin, handleAdminOff);
  bot.command('on', requireAdmin, handleAdminOn);
  bot.command('time', requireAdmin, handleAdminTime);
  bot.command('lookup', requireAdmin, handleAdminLookup);
  bot.command('logs', requireAdmin, handleAdminLogs);
  bot.command('clearlogs', requireAdmin, handleAdminClearLogs);
  bot.command('language', requireAdmin, handleAdminLanguage);
  bot.command(['sub_admin', 'subadmin'], requireAdmin, handleAdminSubAdmin);
  bot.command('ban', requireAdmin, handleAdminBan);
  bot.command('limit', requireAdmin, handleAdminLimit);

  // 5. Natural Conversational Text Messages
  bot.on('message:text', (ctx) => handleTextMessage(ctx));

  // 6. User Photo & Image Moderation
  // Telegram sends compressed photos as 'photo' type
  bot.on('message:photo', handlePhotoMessage);

  // Telegram sends uncompressed / "Send as file" images as 'document' type.
  // We detect images by BOTH mime_type AND file extension to catch every format.
  bot.on('message:document', async (ctx, next) => {
    const doc = ctx.message?.document;
    if (isImageDocument(doc?.mime_type, doc?.file_name)) {
      await handleDocumentAsImage(ctx);
    } else {
      await next();
    }
  });

  // 7. Community Group Member Updates (Welcome message when bot joins)
  bot.on('message:new_chat_members', handleNewChatMembers);

  return bot;
}
