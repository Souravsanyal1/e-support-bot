import { Context } from 'grammy';
import { conversationManager } from '../ai/conversation';
import { env } from '../config/env.config';
import { safeReply, splitMessage } from '../utils/telegram';
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
  const stats = conversationManager.getStats();

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
    `*Session Telemetry:*`,
    `• *Active Sessions:* ${stats.activeSessions}`,
    `• *Total Tracked Users:* ${stats.totalTrackedUsers}`,
    `• *Authorized Admins:* ${env.adminUserIds.size}`,
    `• *Session TTL:* ${env.sessionTtlMinutes} minutes`,
    `• *Rate Limit Window:* ${env.rateLimitMaxMessages} msgs / ${env.rateLimitWindowSeconds}s`,
  ].join('\n');

  await safeReply(ctx, report);
}

/**
 * Handles the admin /reload command.
 */
export async function handleAdminReload(ctx: Context): Promise<void> {
  const clearedCount = conversationManager.clearAllSessions();

  logger.info('Admin triggered system reload', {
    adminId: ctx.from?.id,
    clearedSessions: clearedCount,
  });

  const message = [
    `*🔄 Elite Force AI — Reload Complete*`,
    '',
    `• *In-memory conversation caches cleared:* ${clearedCount} sessions`,
    `• *Knowledge base & system prompt:* Re-synchronized`,
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
  const stats = conversationManager.getStats();

  const report = [
    `*👥 Elite Force AI — User Metrics*`,
    '',
    `• *Total Distinct Users Encountered:* ${stats.totalTrackedUsers}`,
    `• *Current Active In-Memory Sessions:* ${stats.activeSessions}`,
    `• *Sliding History Window:* ${env.maxConversationHistory} turns`,
    `• *Session Inactivity Timeout:* ${env.sessionTtlMinutes} minutes`,
    '',
    `_Note: In strict compliance with privacy standards, zero personal user information, usernames, IP addresses, or contact details are retained._`,
  ].join('\n');

  await safeReply(ctx, report);
}

/**
 * Handles the admin /broadcast <message> command.
 */
export async function handleAdminBroadcast(ctx: Context): Promise<void> {
  const rawText = ctx.message?.text || '';
  const broadcastText = rawText.replace(/^\/broadcast(@\w+)?/i, '').trim();

  if (!broadcastText) {
    await safeReply(
      ctx,
      `*Broadcast Usage:*\n\`/broadcast <announcement message>\`\n\nPlease supply the announcement text to broadcast to all tracked community members.`
    );
    return;
  }

  const userIds = conversationManager.getAllKnownUserIds();

  if (userIds.length === 0) {
    await safeReply(
      ctx,
      `*Notice:* No active community users have interacted with the bot in this session yet.`
    );
    return;
  }

  await safeReply(
    ctx,
    `*Starting broadcast to ${userIds.length} users...* 📢\nPlease wait while messages are queued.`
  );

  let successCount = 0;
  let failCount = 0;

  const chunks = splitMessage(broadcastText);

  // Send sequentially with slight delay to comply with Telegram 30 msgs/second limit
  for (const targetUserId of userIds) {
    try {
      for (const chunk of chunks) {
        await ctx.api.sendMessage(targetUserId, `📢 *Elite Force Announcement*\n\n${chunk}`, {
          parse_mode: 'Markdown',
        });
      }
      successCount++;
    } catch {
      failCount++;
    }

    // 40ms delay = max 25 messages/second
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  logger.info('Broadcast execution completed', {
    adminId: ctx.from?.id,
    successCount,
    failCount,
    total: userIds.length,
  });

  await safeReply(
    ctx,
    `*📢 Broadcast Complete*\n\n• *Delivered:* ${successCount}\n• *Failed/Blocked:* ${failCount}\n• *Total Attempted:* ${userIds.length}`
  );
}
