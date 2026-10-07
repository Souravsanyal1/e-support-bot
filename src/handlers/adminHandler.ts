import { Context } from 'grammy';
import { env } from '../config/env.config';
import { safeReply } from '../utils/telegram';
import { logger } from '../utils/logger';

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
 * Handles the admin /status command.
 */
export async function handleAdminStatus(ctx: Context): Promise<void> {
  const uptime = formatUptime(process.uptime());
  const mem = process.memoryUsage();

  const report = [
    `*📊 Elite Force AI — System Telemetry*`,
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
 * Handles the admin /reload command.
 */
export async function handleAdminReload(ctx: Context): Promise<void> {
  logger.info('Admin triggered system reload');

  const message = [
    `*🔄 Elite Force AI — Reload Complete*`,
    '',
    `• *User conversation memory:* Disabled`,
    `• *Knowledge base & system prompt:* Re-read for the next response`,
    `• *Official channel training data:* Auto-synced from new/edit posts`,
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
    `*👥 Elite Force AI — Privacy Status*`,
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
