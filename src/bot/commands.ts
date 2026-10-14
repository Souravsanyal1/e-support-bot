import { Bot } from 'grammy';
import { BOT_CONFIG, PUBLIC_COMMANDS, ADMIN_COMMANDS_LIST } from '../config/bot.config';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

/**
 * Registers special administrator commands for a specific admin chat.
 */
export async function registerAdminCommandsForUser(
  api: { setMyCommands: Function },
  chatId: number
): Promise<void> {
  try {
    await api.setMyCommands(ADMIN_COMMANDS_LIST, {
      scope: { type: 'chat', chat_id: chatId },
    });
  } catch (error) {
    logger.warn('Failed to set special admin commands for chat scope', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Registers public bot commands and metadata with the Telegram Bot API.
 * Also configures special admin command scopes for configured administrators.
 */
export async function registerBotCommands(bot: Bot): Promise<void> {
  try {
    // 1. Set standard public commands visible to all users
    await bot.api.setMyCommands(PUBLIC_COMMANDS);
    logger.info('Telegram public bot commands registered successfully');

    // 2. Register special administrator commands for each configured admin's private chat scope
    for (const adminId of env.adminUserIds) {
      await registerAdminCommandsForUser(bot.api, adminId);
    }

    // Suggest anonymous admin status when this bot is added as an admin.
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
      // Minor description update errors are non-fatal
    }
  } catch (error) {
    logger.warn('Failed to register bot commands with Telegram API', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

