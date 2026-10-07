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

    // Suggest anonymous admin status when this bot is added as an admin.
    // Existing group/channel memberships still need to be changed by a chat admin.
    for (const for_channels of [false, true]) {
      try {
        const currentRights = await bot.api.getMyDefaultAdministratorRights({ for_channels });
        if (!currentRights.is_anonymous) {
          await bot.api.setMyDefaultAdministratorRights({
            rights: { ...currentRights, is_anonymous: true },
            for_channels,
          });
        }
      } catch (error) {
        logger.warn('Could not set anonymous administrator defaults', {
          scope: for_channels ? 'channels' : 'groups',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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
