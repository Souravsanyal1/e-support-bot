import { Context } from 'grammy';
import { InputFile } from 'grammy';
import { env } from '../config/env.config';
import { safeReply } from '../utils/telegram';
import { logger } from '../utils/logger';
import { botStateManager } from '../bot/state';
import { knowledgeSyncService } from '../services/knowledgeSync';
import { clearLogFile } from '../utils/messageLogger';
import { languageModeManager } from '../bot/languageMode';
import { subAdminManager } from '../services/subAdminManager';
import { registerAdminCommandsForUser } from '../bot/commands';
import {
  parseTimeCommand,
  formatTimerConfirmation,
  formatTimeStatus,
  formatDateTimeInTimezone,
  formatInternationalDateTime,
  formatRemainingDuration,
} from '../utils/timeParser';

/**
 * Formats uptime milliseconds into human-readable string.
 */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return parts.join(' ');
}

/**
 * Formats byte memory to MB.
 */
function toMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

/**
 * Handles the admin /off command.
 * Usage:
 *   /off -> Temporary shutdown (until /on or manual reactivation)
 *   /off permanent -> Permanent shutdown across restarts until explicit /on
 */
export async function handleAdminOff(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const rawText = ctx.message?.text || '';
  const args = rawText.replace(/^\/off(@\w+)?/i, '').trim().toLowerCase();

  const isPermanent = args === 'permanent';

  botStateManager.turnOff({
    permanent: isPermanent,
    disabledBy: userId,
    reason: isPermanent ? 'Permanent admin shutdown' : 'Temporary admin shutdown',
  });

  const responseText = isPermanent
    ? [
        `⛔ *Celia — Permanent Bot Shutdown Activated*`,
        '',
        `• *Status:* Permanently Disabled`,
        `• *Persistence:* Survives server restarts and redeployments`,
        `• *User Activities:* All user-facing AI responses and public commands are paused`,
        `• *Admin Controls:* Remotely active and listening for /on`,
        '',
        `_To resume normal bot functionality at any time, execute \`/on\`._`,
      ].join('\n')
    : [
        `⏸️ *Celia — Temporary Bot Shutdown Activated*`,
        '',
        `• *Status:* Temporarily Disabled`,
        `• *User Activities:* All user-facing AI responses and public commands are paused`,
        `• *Admin Controls:* Remotely active and listening for /on or /time`,
        '',
        `_To resume immediately, send \`/on\`. To schedule an automatic reactivation timer, use \`/time <duration>\`._`,
      ].join('\n');

  logger.info('Admin executed /off', { isPermanent, userId });
  await safeReply(ctx, responseText);
}

/**
 * Handles the admin /on command.
 * Reactivates user-facing functionality and clears any scheduled timer.
 */
export async function handleAdminOn(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  botStateManager.turnOn(userId);

  const responseText = [
    `✅ *Celia — Bot Reactivated*`,
    '',
    `• *Status:* 🟢 Active & Online`,
    `• *AI Responses:* Fully operational`,
    `• *Scheduled Timers:* Cleared`,
    `• *Public Commands:* Active`,
    '',
    `Celia is now responding normally to user queries across community groups and private chats! 🚀`,
  ].join('\n');

  logger.info('Admin executed /on', { userId });
  await safeReply(ctx, responseText);
}

/**
 * Handles the admin /time command.
 * Usage:
 *   /time 2 minutes
 *   /time 30 minutes
 *   /time 2 hours
 *   /time 9:00 AM
 *   /time tomorrow 9:00 AM
 *   /time status
 *   /time cancel
 */
export async function handleAdminTime(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const rawText = ctx.message?.text || '';
  const param = rawText.replace(/^\/time(@\w+)?/i, '').trim();

  const parseResult = parseTimeCommand(param, env.timezone);

  switch (parseResult.type) {
    case 'status': {
      const currentState = botStateManager.getState();
      const statusMsg = formatTimeStatus(currentState, env.timezone);
      await safeReply(ctx, statusMsg);
      return;
    }

    case 'cancel': {
      const currentState = botStateManager.getState();
      if (!currentState.reactivateAt) {
        await safeReply(ctx, 'ℹ️ No scheduled reactivation timer is currently active.');
        return;
      }

      botStateManager.cancelSchedule(userId);
      await safeReply(
        ctx,
        `🚫 *Scheduled Reactivation Cancelled*\n\nThe pending timer has been cleared. The bot remains in its current status (\`${currentState.status}\`). To reactivate the bot now, send \`/on\`.`
      );
      return;
    }

    case 'ambiguous': {
      await safeReply(ctx, parseResult.clarification);
      return;
    }

    case 'invalid': {
      await safeReply(ctx, parseResult.error);
      return;
    }

    case 'duration': {
      const updatedState = botStateManager.turnOff({
        permanent: false,
        reactivateAt: parseResult.targetDate,
        durationMinutes: parseResult.durationMinutes,
        disabledBy: userId,
        reason: `Disabled for ${parseResult.durationMinutes} minute(s)`,
      });

      const confirmMsg = formatTimerConfirmation(updatedState, env.timezone);
      await safeReply(ctx, confirmMsg);
      return;
    }

    case 'specific_time': {
      const diffMs = parseResult.targetDate.getTime() - Date.now();
      const durationMinutes = Math.max(1, Math.round(diffMs / 60000));

      const updatedState = botStateManager.turnOff({
        permanent: false,
        reactivateAt: parseResult.targetDate,
        durationMinutes,
        disabledBy: userId,
        reason: `Disabled until scheduled time: ${parseResult.description}`,
      });

      const confirmMsg = formatTimerConfirmation(updatedState, env.timezone);
      await safeReply(ctx, confirmMsg);
      return;
    }
  }
}

/**
 * Handles the admin /status command.
 */
export async function handleAdminStatus(ctx: Context): Promise<void> {
  const uptime = formatUptime(process.uptime());
  const mem = process.memoryUsage();
  const state = botStateManager.getState();

  let stateDescription = '🟢 Active';
  if (state.status === 'temporary_disabled') {
    stateDescription = '⏸️ Temporarily Disabled';
    if (state.reactivateAt) {
      const rDate = new Date(state.reactivateAt);
      stateDescription += ` (Reactivates: ${formatDateTimeInTimezone(rDate, env.timezone)} | ${formatInternationalDateTime(rDate)})`;
    }
  } else if (state.status === 'permanently_disabled') {
    stateDescription = '⛔ Permanently Disabled';
  }

  const report = [
    `*📊 Celia — System & Operational Telemetry*`,
    '',
    `*Operational State:*`,
    `• *Bot Status:* ${stateDescription}`,
    `• *Timezone (Local):* \`${env.timezone}\``,
    `• *Timezone (International):* \`UTC / GMT\``,
    ...(state.reactivateAt
      ? [`• *Timer Remaining:* \`${formatRemainingDuration(new Date(state.reactivateAt))}\``]
      : []),
    '',
    `*Runtime Status:*`,
    `• *Uptime:* ${uptime}`,
    `• *Node.js:* ${process.version}`,
    `• *Mode:* \`${env.botMode}\``,
    `• *Model:* \`${env.geminiModel}\``,
    '',
    `*Memory Usage:*`,
    `• *Heap Used:* ${toMB(mem.heapUsed)} MB`,
    `• *Heap Total:* ${toMB(mem.heapTotal)} MB`,
    `• *RSS:* ${toMB(mem.rss)} MB`,
    '',
    `• *User conversation history:* Disabled`,
    `• *Training source:* @Elite_Force_Official only`,
    `• *Authorized Admins:* ${subAdminManager.getAllAdminIds().size} (${env.adminUserIds.size} Primary, ${subAdminManager.listSubAdmins().length} Sub)`,
    `• *Rate Limit Window:* ${env.rateLimitMaxMessages} msgs / ${env.rateLimitWindowSeconds}s`,
  ].join('\n');

  await safeReply(ctx, report);
}

/**
 * Handles the admin /sync command.
 * Manually triggers knowledge sync and reports detailed source status.
 */
export async function handleAdminSync(ctx: Context): Promise<void> {
  logger.info('Admin triggered manual knowledge sync');

  try {
    const status = await knowledgeSyncService.syncKnowledge({ force: true });
    const sourceLines = status.sources.map(
      (s) => `• *${s.source}:* \`${s.status.toUpperCase()}\`${s.message ? ` (${s.message})` : ''}`
    );

    const report = [
      `*✅ Celia — Knowledge Base Synchronized*`,
      '',
      `• *Version:* \`v${status.version}\``,
      `• *Characters:* \`${status.totalCharacters}\``,
      `• *Content Hash:* \`${status.contentHash ? status.contentHash.slice(0, 10) : 'n/a'}\``,
      `• *Last Synced:* \`${status.lastSuccessfulSyncAt || 'Now'}\``,
      '',
      `*Source Details:*`,
      ...sourceLines,
      '',
      `_The active system prompt has hot-reloaded the updated knowledge._`,
    ].join('\n');

    await safeReply(ctx, report);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Manual knowledge sync failed', err);
    await safeReply(ctx, `⚠️ *Knowledge sync failed:* ${errorMsg}\n\nFalling back to last-known-good backup.`);
  }
}

/**
 * Handles the admin /reload command.
 */
export async function handleAdminReload(ctx: Context): Promise<void> {
  logger.info('Admin triggered system reload');

  // Trigger knowledge sync check
  try {
    await knowledgeSyncService.syncKnowledge();
  } catch {
    // Non-fatal
  }

  const syncStatus = knowledgeSyncService.getStatus();

  const message = [
    `*🔄 Celia — Reload Complete*`,
    '',
    `• *User conversation memory:* Disabled`,
    `• *Knowledge base & system prompt:* Re-read from \`${env.knowledgeFilePath}\` (v${syncStatus.version})`,
    `• *Official channel training data:* Auto-synced from new/edit posts`,
    `• *Image Moderation:* \`${env.enableImageModeration ? 'ENABLED' : 'DISABLED'}\` (Threshold: ${env.imageModerationConfidenceThreshold})`,
    `• *Active Model:* \`${env.geminiModel}\``,
    '',
    `System is running with optimal configuration.`,
  ].join('\n');

  await safeReply(ctx, message);
}

/**
 * Handles the admin /users command.
 */
export async function handleAdminUsers(ctx: Context): Promise<void> {
  const report = [
    `*👥 Celia — Privacy Status*`,
    '',
    `• User messages are not saved as training data.`,
    `• Chat history and regular users' raw Telegram IDs are not stored.`,
    `• Configured admin IDs remain in private server settings for access control.`,
    `• Only public posts from @Elite_Force_Official update the knowledge file.`,
    `• Message text is sent to the configured AI provider for the current reply only.`,
    '',
    `_A one-way, process-only anti-spam key is kept in memory briefly and cleared after its rate-limit window expires._`,
  ].join('\n');

  await safeReply(ctx, report);
}

/**
 * Handles the admin /broadcast <message> command.
 */
export async function handleAdminBroadcast(ctx: Context): Promise<void> {
  logger.info('Admin broadcast command declined because recipient IDs are not retained');
  await safeReply(
    ctx,
    `Broadcast is disabled because the bot does not store user IDs. Please publish announcements in the official channel.`
  );
}

/**
 * Handles the admin /lookup command.
 * Usage: /lookup @username  OR  /lookup username
 * Fetches Telegram user/chat info by username via Telegram API.
 */
export async function handleAdminLookup(ctx: Context): Promise<void> {
  const rawText = ctx.message?.text || '';
  const param = rawText.replace(/^\/lookup(@\w+)?/i, '').trim();

  if (!param) {
    await safeReply(
      ctx,
      `*🔍 Usage:* \`/lookup @username\`\n\nProvide a Telegram username to fetch their details.`
    );
    return;
  }

  // Normalize: remove leading @ if present
  const username = param.startsWith('@') ? param : `@${param}`;

  try {
    const chat = await ctx.api.getChat(username);

    const lines: string[] = [
      `*🔍 User Lookup — ${username}*`,
      '',
    ];

    if ('first_name' in chat) {
      if (chat.first_name) lines.push(`• *First Name:* ${chat.first_name}`);
    }
    if ('last_name' in chat && (chat as { last_name?: string }).last_name) {
      lines.push(`• *Last Name:* ${(chat as { last_name?: string }).last_name}`);
    }
    if (chat.username) lines.push(`• *Username:* @${chat.username}`);
    lines.push(`• *Telegram ID:* \`${chat.id}\``);
    lines.push(`• *Type:* ${chat.type}`);

    if ('bio' in chat && (chat as { bio?: string }).bio) {
      lines.push(`• *Bio:* ${(chat as { bio?: string }).bio?.slice(0, 100)}`);
    }
    if ('description' in chat && (chat as { description?: string }).description) {
      lines.push(`• *Description:* ${(chat as { description?: string }).description?.slice(0, 100)}`);
    }

    logger.info('Admin lookup performed', { username, resolvedId: chat.id, adminId: ctx.from?.id });
    await safeReply(ctx, lines.join('\n'));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn('Admin lookup failed', { username, error: errMsg });

    if (errMsg.includes('400') || errMsg.includes('chat not found') || errMsg.includes('Bad Request')) {
      await safeReply(
        ctx,
        `⚠️ *User not found:* \`${username}\`\n\nThis username doesn't exist, or the user has never interacted with Telegram in a way that makes them discoverable.`
      );
    } else {
      await safeReply(ctx, `⚠️ *Lookup failed:* ${errMsg}`);
    }
  }
}

/**
 * Handles the admin /logs command.
 * Sends the current messages.txt log file to the admin.
 */
export async function handleAdminLogs(ctx: Context): Promise<void> {
  await safeReply(ctx, `📋 *Fetching message log...*`);

  // We need the bot instance — use ctx.api directly with sendDocument
  try {
    const fs = await import('fs');
    const path = await import('path');
    const LOG_FILE = path.resolve(process.cwd(), 'logs', 'messages.txt');

    if (!fs.existsSync(LOG_FILE) || fs.statSync(LOG_FILE).size === 0) {
      await safeReply(ctx, `ℹ️ No messages have been logged yet.`);
      return;
    }

    const fileContent = fs.readFileSync(LOG_FILE);
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: env.timezone || 'Asia/Dhaka',
    });

    await ctx.api.sendDocument(
      ctx.chat!.id,
      new InputFile(fileContent, 'messages.txt'),
      {
        caption: `📋 *Celia — Message Log*\n_Generated: ${timestamp}_`,
        parse_mode: 'Markdown',
      }
    );

    logger.info('Admin requested message log', { adminId: ctx.from?.id });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to send log file to admin', { error: errMsg });
    await safeReply(ctx, `⚠️ Failed to send log file: ${errMsg}`);
  }
}

/**
 * Handles the admin /clearlogs command.
 * Wipes the messages.txt log file.
 */
export async function handleAdminClearLogs(ctx: Context): Promise<void> {
  try {
    clearLogFile();
    logger.info('Admin cleared message logs', { adminId: ctx.from?.id });
    await safeReply(ctx, `🗑️ *Message log cleared successfully.*`);
  } catch (err) {
    await safeReply(ctx, `⚠️ Failed to clear logs: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Handles the admin /language command.
 * Allows admins to switch runtime language mode:
 * - /language all     → Allow all languages across groups and private chats
 * - /language english → Enforce strict English-only (default)
 * - /language status  → Show current active language mode
 */
export async function handleAdminLanguage(ctx: Context): Promise<void> {
  const text = ctx.message?.text?.trim() || '';
  const parts = text.split(/\s+/);
  const subCommand = parts[1]?.toLowerCase();
  const adminId = ctx.from?.id;

  if (subCommand === 'all') {
    languageModeManager.setAll(adminId);
    logger.info('Admin switched language mode to ALL', { adminId });
    await safeReply(
      ctx,
      `🌐 *Language Mode Updated: ALL LANGUAGES ALLOWED*\n\n` +
      `• The bot will now accept and process messages in *all languages* without deletion or warnings.\n` +
      `• AI responses will adapt to user language.\n` +
      `• Bad words/profanity filter remains active.\n\n` +
      `_To switch back to English only, use:_ \`/language english\``
    );
    return;
  }

  if (subCommand === 'english' || subCommand === 'en') {
    languageModeManager.setEnglishOnly(adminId);
    logger.info('Admin switched language mode to ENGLISH ONLY', { adminId });
    await safeReply(
      ctx,
      `🇬🇧 *Language Mode Updated: STRICT ENGLISH ONLY*\n\n` +
      `• Non-English messages will be filtered / rejected according to group & private chat policy.\n` +
      `• AI responses will be strictly English only.\n\n` +
      `_To allow all languages, use:_ \`/language all\``
    );
    return;
  }

  // If subCommand === 'status' or unrecognized/empty, show current status & usage
  const status = languageModeManager.getStatus();
  const currentModeStr =
    status.mode === 'all'
      ? '🌐 *ALL LANGUAGES* (Language filter bypassed)'
      : '🇬🇧 *ENGLISH ONLY* (Strict English filter active)';

  const changedInfo = status.changedAt
    ? `\n_Last changed:_ ${new Date(status.changedAt).toLocaleString('en-US', { timeZone: env.timezone || 'Asia/Dhaka' })}`
    : '';

  await safeReply(
    ctx,
    `⚙️ *Current Language Mode:*\n${currentModeStr}${changedInfo}\n\n` +
    `*Admin Commands:*\n` +
    `• \`/language all\` — Allow all languages (no deletion / warning)\n` +
    `• \`/language english\` — Re-enable strict English-only filter\n` +
    `• \`/language status\` — Check current mode`
  );
}

/**
 * Handles the admin /sub_admin command.
 * Allows primary admins to add, remove, and list sub-admins dynamically with JSON persistence.
 *
 * Syntax:
 * - /sub_admin list (or /sub_admin without args) -> Lists all primary and sub-admins
 * - /sub_admin add <userId> [note] -> Adds a new sub-admin by numeric Telegram ID
 * - /sub_admin add [note] (as reply to a user's message) -> Adds the replied-to user
 * - /sub_admin remove <userId> -> Removes a sub-admin
 * - /sub_admin remove (as reply to a user's message) -> Removes the replied-to user
 */
export async function handleAdminSubAdmin(ctx: Context): Promise<void> {
  const fromUserId = ctx.from?.id;
  const isPrimary = subAdminManager.isPrimaryAdmin(fromUserId);

  const rawText = ctx.message?.text?.trim() || '';
  const args = rawText.replace(/^\/sub_?admins?(@\w+)?/i, '').trim();
  const parts = args.split(/\s+/).filter(Boolean);
  const action = parts[0]?.toLowerCase();

  // If no action or 'list', display the admin overview
  if (!action || action === 'list') {
    const primaryAdmins = Array.from(env.adminUserIds);
    const subAdmins = subAdminManager.listSubAdmins();

    const primaryText =
      primaryAdmins.length > 0
        ? primaryAdmins.map((id) => `• \`${id}\` _(Primary / ENV)_`).join('\n')
        : '• _None configured_';

    const subText =
      subAdmins.length > 0
        ? subAdmins
            .map((sub, index) => {
              const userStr = sub.username ? `@${sub.username} (\`${sub.userId}\`)` : `\`${sub.userId}\``;
              const noteStr = sub.note ? ` — _${sub.note}_` : '';
              const byStr = sub.addedBy ? ` (by \`${sub.addedBy}\`)` : '';
              return `${index + 1}. ${userStr}${noteStr}${byStr}`;
            })
            .join('\n')
        : '• _No sub-admins configured yet_';

    const message = [
      `🛡️ *Elite Force — Administrator Management*`,
      '',
      `👑 *Primary Administrators (${primaryAdmins.length}):*`,
      primaryText,
      '',
      `🎖️ *Sub-Administrators (${subAdmins.length}):*`,
      subText,
      '',
      `📖 *Usage Commands:*`,
      `• \`/sub_admin add <user_id> [note]\` — Add a new sub-admin`,
      `• \`/sub_admin remove <user_id>\` — Remove a sub-admin`,
      `• Reply to any message with \`/sub_admin add\` or \`/sub_admin remove\``,
      `• \`/sub_admin list\` — View this list`,
    ].join('\n');

    await safeReply(ctx, message);
    return;
  }

  // Adding or removing sub-admins is strictly restricted to Primary Administrators
  if (!isPrimary) {
    await safeReply(
      ctx,
      `⛔ *Permission Denied:* Only Primary Administrators (configured in environment) are authorized to add or remove sub-admins.`
    );
    return;
  }

  // Action: ADD
  if (action === 'add') {
    let targetId: number | undefined;
    let username: string | undefined;
    let note: string | undefined;

    // Check if command is a reply to another user's message
    const replyMsg = ctx.message?.reply_to_message;
    if (replyMsg?.from) {
      targetId = replyMsg.from.id;
      username = replyMsg.from.username;
      note = parts.slice(1).join(' ').trim() || undefined;
    } else {
      // Second argument must be the numeric user ID
      const rawId = parts[1];
      if (!rawId || isNaN(parseInt(rawId, 10))) {
        await safeReply(
          ctx,
          `⚠️ *Usage Error:*\nPlease provide a valid numeric Telegram User ID or reply to a user's message.\n\nExample:\n\`/sub_admin add 123456789 Community Moderator\``
        );
        return;
      }
      targetId = parseInt(rawId, 10);
      note = parts.slice(2).join(' ').trim() || undefined;
    }

    if (!targetId || targetId <= 0) {
      await safeReply(ctx, `⚠️ Invalid User ID.`);
      return;
    }

    const result = subAdminManager.addSubAdmin(targetId, fromUserId || 0, note, username);
    if (!result.success) {
      await safeReply(ctx, `⚠️ ${result.message}`);
      return;
    }

    // Try to register admin commands in Telegram scope for the new sub-admin
    try {
      await registerAdminCommandsForUser(ctx.api, targetId);
    } catch {
      // Non-fatal if the user hasn't messaged the bot yet
    }

    await safeReply(
      ctx,
      `✅ *Sub-Admin Successfully Added!*\n\n` +
      `• *User ID:* \`${targetId}\`${username ? ` (@${username})` : ''}\n` +
      `• *Authorized By:* \`${fromUserId}\`\n` +
      (note ? `• *Note:* ${note}\n` : '') +
      `\n_This user can now access all administrative features and commands._`
    );
    return;
  }

  // Action: REMOVE / DEL / DELETE
  if (action === 'remove' || action === 'del' || action === 'delete' || action === 'rm') {
    let targetId: number | undefined;

    const replyMsg = ctx.message?.reply_to_message;
    if (replyMsg?.from) {
      targetId = replyMsg.from.id;
    } else {
      const rawId = parts[1];
      if (!rawId || isNaN(parseInt(rawId, 10))) {
        await safeReply(
          ctx,
          `⚠️ *Usage Error:*\nPlease provide the numeric Telegram User ID to remove, or reply to their message with \`/sub_admin remove\`.\n\nExample:\n\`/sub_admin remove 123456789\``
        );
        return;
      }
      targetId = parseInt(rawId, 10);
    }

    const result = subAdminManager.removeSubAdmin(targetId);
    if (!result.success) {
      await safeReply(ctx, `⚠️ ${result.message}`);
      return;
    }

    await safeReply(
      ctx,
      `🗑️ *Sub-Admin Removed!*\n\n` +
      `User \`${targetId}\` has been revoked and can no longer execute administrative commands.`
    );
    return;
  }

  // Unrecognized action
  await safeReply(
    ctx,
    `⚠️ Unrecognized action: \`${action}\`.\n\nUse:\n• \`/sub_admin add <id> [note]\`\n• \`/sub_admin remove <id>\`\n• \`/sub_admin list\``
  );
}


