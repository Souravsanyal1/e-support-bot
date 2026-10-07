import express, { Request, Response } from 'express';
import { Server } from 'http';
import { webhookCallback } from 'grammy';
import { env } from './config/env.config';
import { logger } from './utils/logger';
import { createBot } from './bot/bot';
import { registerBotCommands } from './bot/commands';
import { rateLimiter } from './middleware/rateLimiter';
import { conversationManager } from './ai/conversation';

// Global Process Safety Guards (Prevent unhandled async errors from crashing the bot)
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled Promise Rejection caught (process protected from crash):', reason);
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception caught (process protected from crash):', error);
});

/**
 * Starts a keep-alive monitor to prevent free-tier cloud hosts (Render, Glitch, etc.)
 * from going to sleep after 15 minutes of inactivity.
 */
function startKeepAlivePing(port: number): void {
  const externalUrl = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!externalUrl && !process.env.RENDER) {
    return;
  }

  const pingUrl = externalUrl
    ? `${externalUrl.replace(/\/$/, '')}/health`
    : `http://localhost:${port}/health`;

  const intervalMs = 10 * 60 * 1000; // Ping every 10 minutes (Render sleeps at 15m)
  const timer = setInterval(async () => {
    try {
      const res = await fetch(pingUrl);
      logger.debug(`[Keep-Alive] Ping sent to ${pingUrl} (status: ${res.status})`);
    } catch (err) {
      logger.debug('[Keep-Alive] Ping check failed (host may be waking up)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, intervalMs);

  // Allow process to exit cleanly without keeping interval alive during shutdown
  if (timer.unref) {
    timer.unref();
  }

  logger.info(`Keep-alive monitor activated: pinging ${pingUrl} every 10 minutes to prevent sleep.`);
}

async function main(): Promise<void> {
  logger.info('Initializing Elite Force AI Bot...', {
    mode: env.botMode,
    model: env.geminiModel,
    nodeVersion: process.version,
  });

  const bot = createBot();
  let httpServer: Server | null = null;

  // Setup graceful shutdown handling
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}. Initiating graceful shutdown...`);

    try {
      rateLimiter.destroy();
      conversationManager.destroy();

      if (httpServer) {
        httpServer.close();
      }

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

  // Create Express app for health checks and/or webhooks (crucial for Render / Cloud hosting)
  const app = express();

  // Root endpoint for browser verification & UptimeRobot (supports GET & HEAD)
  app.all('/', (_req: Request, res: Response) => {
    res.status(200).send('Elite Force AI Bot is online and running! 🚀');
  });

  // Health check endpoint (for cloud health monitoring & keep-awake pingers)
  app.all('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      service: 'Elite Force AI Bot',
      mode: env.botMode,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  if (env.botMode === 'webhook') {
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

    httpServer = app.listen(env.port, '0.0.0.0', async () => {
      logger.info(`Webhook server listening on 0.0.0.0:${env.port}`);

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

    httpServer.on('error', (err) => {
      logger.error('Server encountered a fatal error', err);
    });

    startKeepAlivePing(env.port);
  } else {
    // Polling Mode: Start health check server on 0.0.0.0:env.port for Render Web Service compatibility
    httpServer = app.listen(env.port, '0.0.0.0', () => {
      logger.info(`Health check HTTP server listening on 0.0.0.0:${env.port} for Render/Cloud monitoring`);
    });

    httpServer.on('error', (err) => {
      logger.warn('HTTP health check server warning (port may already be in use)', { error: err.message });
    });

    startKeepAlivePing(env.port);

    // Resilient Polling Loop with Exponential Backoff & Automatic Recovery
    let retryDelayMs = 2000;
    const MAX_RETRY_DELAY_MS = 30000;

    while (!isShuttingDown) {
      try {
        // Ensure any existing webhook is removed before starting polling
        try {
          await bot.api.deleteWebhook({ drop_pending_updates: false });
          logger.info('Cleared previous webhooks; polling initialized.');
        } catch (delErr) {
          logger.warn('Notice clearing webhooks (will continue to start polling)', {
            error: delErr instanceof Error ? delErr.message : String(delErr),
          });
        }

        // Register autocomplete commands with Telegram
        try {
          await registerBotCommands(bot);
        } catch (cmdErr) {
          logger.warn('Notice registering bot commands (will continue to start polling)', {
            error: cmdErr instanceof Error ? cmdErr.message : String(cmdErr),
          });
        }

        // Start long-polling
        logger.info('Starting Telegram polling loop...');
        await bot.start({
          drop_pending_updates: false,
          onStart: (botInfo) => {
            retryDelayMs = 2000; // Reset backoff on successful connect
            logger.info(`Elite Force AI Bot is online and running! 🚀`, {
              username: botInfo.username,
              id: botInfo.id,
            });
          },
        });

        // If bot.start() returned cleanly without exception
        if (isShuttingDown) break;

        logger.warn('Bot polling stopped unexpectedly. Reconnecting in 3 seconds...');
        await new Promise((res) => setTimeout(res, 3000));
      } catch (startError) {
        if (isShuttingDown) break;

        const errMsg = startError instanceof Error ? startError.message : String(startError);

        // Fatal authentication error - stop only if token is completely invalid
        if (errMsg.includes('401') || errMsg.includes('404') || errMsg.includes('Unauthorized')) {
          logger.error(
            '❌ Telegram Token Authentication Failed: The token in your .env was rejected by Telegram (401 Unauthorized / 404 Not Found).\n' +
            '👉 Please open @BotFather on Telegram, execute /mybots, select your bot, click "API Token" (or generate a new one via /revoke or /token), and update TELEGRAM_BOT_TOKEN in .env.'
          );
          process.exit(1);
        }

        // 409 Conflict: Another instance is running (or previous connection taking a moment to release)
        if (errMsg.includes('409') || errMsg.includes('Conflict')) {
          logger.warn(
            '⚠️ 409 Conflict: Another bot instance is currently active with this token. Waiting 10 seconds before retrying...'
          );
          await new Promise((res) => setTimeout(res, 10000));
          continue;
        }

        // Network glitch, ETIMEDOUT, ECONNRESET, 502 Bad Gateway, 504 Gateway Timeout
        logger.warn(
          `Telegram polling encountered an intermittent error. Auto-reconnecting in ${retryDelayMs / 1000}s...`,
          { error: errMsg }
        );

        await new Promise((res) => setTimeout(res, retryDelayMs));
        retryDelayMs = Math.min(retryDelayMs * 1.5, MAX_RETRY_DELAY_MS);
      }
    }
  }
}

main().catch((fatal) => {
  logger.error('Application failed to start', fatal);
  process.exit(1);
});
