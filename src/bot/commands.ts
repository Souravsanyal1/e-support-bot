import { Bot } from 'grammy';
import { BOT_CONFIG, PUBLIC_COMMANDS } from '../config/bot.config';
import { logger } from '../utils/logger';

/**
 * Registers public bot commands and metadata with the Telegram Bot API.
 */
export async function registerBotCommands(bot: Bot): Promise<void> {
  try {
    // Set standard commands visible to all users
    await bot.api.setMyCommands(PUBLIC_COMMANDS);
    logger.info('Telegram bot commands registered successfully');

    // Optionally set bot description and short description
    try {
      await bot.api.setMyDescription(BOT_CONFIG.description);
      await bot.api.setMyShortDescription(BOT_CONFIG.tagline);
    } catch {
      // Ignore if Telegram API throws minor error on description update
    }
  } catch (error) {
    logger.warn('Failed to register bot commands with Telegram API', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
