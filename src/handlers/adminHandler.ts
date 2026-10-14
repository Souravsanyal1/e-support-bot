import { Context } from 'grammy';
import { env } from '../config/env.config';
import { safeReply } from '../utils/telegram';
import { logger } from '../utils/logger';
import { botStateManager } from '../bot/state';
import { knowledgeSyncService } from '../services/knowledgeSync';
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
    `• *Authorized Admins:* ${env.adminUserIds.size}`,
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
