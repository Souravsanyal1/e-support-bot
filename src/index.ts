import express, { Request, Response } from 'express';
import { webhookCallback } from 'grammy';
import { env } from './config/env.config';
import { logger } from './utils/logger';
import { createBot } from './bot/bot';
import { registerBotCommands } from './bot/commands';
import { rateLimiter } from './middleware/rateLimiter';
import { conversationManager } from './ai/conversation';

async function main(): Promise<void> {
  logger.info('Initializing Elite Force AI Bot...', {
    mode: env.botMode,
    model: env.geminiModel,
    nodeVersion: process.version,
  });

  const bot = createBot();

  // Setup graceful shutdown handling
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}. Initiating graceful shutdown...`);

    try {
      rateLimiter.destroy();
      conversationManager.destroy();

      if (env.botMode === 'polling') {
        await bot.stop();
      }

      logger.info('Graceful shutdown completed successfully.');
      process.exit(0);
    } catch (shutdownError) {
      logger.error('Error encountered during shutdown', shutdownError);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

  if (env.botMode === 'webhook') {
    // Webhook Mode with Express Server
    const app = express();

    // Health check endpoint (for cloud health monitoring)
    app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({
        status: 'healthy',
        service: 'Elite Force AI Bot',
        uptimeSeconds: Math.floor(process.uptime()),
      });
    });

    // Webhook verification middleware
    app.use('/webhook', (req: Request, res: Response, next) => {
      const secretHeader = req.header('x-telegram-bot-api-secret-token');

      if (!secretHeader || secretHeader !== env.webhookSecret) {
        logger.warn('Rejected unauthorized webhook request: invalid or missing secret token');
        res.status(401).send('Unauthorized');
        return;
      }

      next();
    });

    // Mount Telegram update handler
    app.use(express.json());
    app.post('/webhook', webhookCallback(bot, 'express'));

    const server = app.listen(env.port, async () => {
      logger.info(`Webhook server listening on port ${env.port}`);

      try {
        if (env.webhookUrl) {
          await bot.api.setWebhook(env.webhookUrl, {
            secret_token: env.webhookSecret,
            drop_pending_updates: true,
          });
          logger.info(`Telegram webhook successfully configured at ${env.webhookUrl}`);
        }
        await registerBotCommands(bot);
      } catch (webhookErr) {
        logger.error('Failed to configure Telegram webhook', webhookErr);
      }
    });

    server.on('error', (err) => {
      logger.error('Server encountered a fatal error', err);
    });
  } else {
    // Polling Mode (Default for free-tier deployments, background workers, and local dev)
    try {
      // Ensure any existing webhook is removed before starting polling
      await bot.api.deleteWebhook({ drop_pending_updates: false });
      logger.info('Cleared previous webhooks; polling initialized.');

      // Register autocomplete commands with Telegram
      await registerBotCommands(bot);

      // Start long-polling
      await bot.start({
        onStart: (botInfo) => {
          logger.info(`Elite Force AI Bot is online and running!`, {
            username: botInfo.username,
            id: botInfo.id,
          });
        },
      });
    } catch (startError) {
      const errMsg = startError instanceof Error ? startError.message : String(startError);
      if (errMsg.includes('401') || errMsg.includes('404') || errMsg.includes('Unauthorized')) {
        logger.error(
          '❌ Telegram Token Authentication Failed: The token in your .env was rejected by Telegram (401 Unauthorized / 404 Not Found).\n' +
          '👉 Please open @BotFather on Telegram, execute /mybots, select your bot, click "API Token" (or generate a new one via /revoke or /token), and update TELEGRAM_BOT_TOKEN in .env.'
        );
      } else {
        logger.error('Fatal error during bot polling startup', startError);
      }
      process.exit(1);
    }
  }
}

main().catch((fatal) => {
  logger.error('Application failed to start', fatal);
  process.exit(1);
});
