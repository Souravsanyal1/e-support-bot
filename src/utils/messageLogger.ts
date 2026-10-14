import fs from 'fs';
import path from 'path';
import { Bot, InputFile } from 'grammy';
import { env } from '../config/env.config';
import { logger } from './logger';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'messages.txt');

/**
 * Ensures the log directory exists.
 */
function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Formats a log entry for a user message.
 */
function formatLogEntry(entry: {
  timestamp: string;
  userId?: number;
  username?: string;
  firstName?: string;
  chatType: string;
  chatId?: number;
  text: string;
}): string {
  const userPart = [
    entry.firstName ? `Name: ${entry.firstName}` : null,
    entry.username ? `Username: @${entry.username}` : null,
    entry.userId ? `ID: ${entry.userId}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return [
    `─────────────────────────────────────`,
    `[${entry.timestamp}]`,
    `From: ${userPart || 'Unknown'}`,
    `Chat: ${entry.chatType}${entry.chatId ? ` (${entry.chatId})` : ''}`,
    `Message: ${entry.text}`,
  ].join('\n');
}

/**
 * Appends a message log entry to the messages.txt file.
 */
export function logMessageToFile(entry: {
  userId?: number;
  username?: string;
  firstName?: string;
  chatType: string;
  chatId?: number;
  text: string;
}): void {
  try {
    ensureLogDir();
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: env.timezone || 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const formatted = formatLogEntry({ ...entry, timestamp }) + '\n\n';
    fs.appendFileSync(LOG_FILE, formatted, 'utf8');
  } catch (err) {
    logger.warn('Failed to write message log to file', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Forwards a user message notification to all admin Telegram IDs.
 * Non-blocking — errors are swallowed so bot never crashes.
 */
export async function forwardMessageToAdmins(
  bot: Bot,
  entry: {
    userId?: number;
    username?: string;
    firstName?: string;
    chatType: string;
    chatId?: number;
    text: string;
  }
): Promise<void> {
  const adminIds = Array.from(env.adminUserIds);
  if (adminIds.length === 0) return;

  const userPart = [
    entry.firstName ? `*Name:* ${entry.firstName}` : null,
    entry.username ? `*Username:* @${entry.username}` : null,
    entry.userId ? `*ID:* \`${entry.userId}\`` : null,
    `*Chat:* ${entry.chatType}`,
  ]
    .filter(Boolean)
    .join('\n');

  const notification = [
    `📨 *New User Message*`,
    '',
    userPart,
    '',
    `*Message:*`,
    `_${entry.text.slice(0, 400)}${entry.text.length > 400 ? '…' : ''}_`,
  ].join('\n');

  for (const adminId of adminIds) {
    try {
      await bot.api.sendMessage(adminId, notification, { parse_mode: 'Markdown' });
    } catch {
      // Non-fatal — admin may not have started the bot in private
    }
  }
}

/**
 * Sends the current messages.txt log file to all admin IDs as a document.
 */
export async function sendLogFileToAdmins(bot: Bot): Promise<{ sent: number; error?: string }> {
  ensureLogDir();

  if (!fs.existsSync(LOG_FILE)) {
    return { sent: 0, error: 'No log file found. No messages have been recorded yet.' };
  }

  const stats = fs.statSync(LOG_FILE);
  if (stats.size === 0) {
    return { sent: 0, error: 'Log file is empty.' };
  }

  const adminIds = Array.from(env.adminUserIds);
  let sent = 0;

  for (const adminId of adminIds) {
    try {
      await bot.api.sendDocument(
        adminId,
        new InputFile(fs.readFileSync(LOG_FILE), 'messages.txt'),
        {
          caption: `📋 *Celia — Message Log*\n_${new Date().toLocaleString('en-US', { timeZone: env.timezone || 'Asia/Dhaka' })}_`,
          parse_mode: 'Markdown',
        }
      );
      sent++;
    } catch (err) {
      logger.warn('Failed to send log file to admin', {
        adminId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent };
}

/**
 * Clears the messages.txt log file.
 */
export function clearLogFile(): void {
  ensureLogDir();
  fs.writeFileSync(LOG_FILE, '', 'utf8');
}
