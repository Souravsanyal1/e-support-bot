import { BotCommand } from 'grammy/types';

export const BOT_CONFIG = {
  name: 'Elite Force AI',
  username: '@Elite_Force_Support_Bot',
  tagline: 'Official AI Community Support Assistant for Elite Force',
  version: '1.0.0',
  description:
    'Elite Force AI is an intelligent community assistant designed to guide members, ' +
    'explain the Elite Force ecosystem, answer questions, and direct users to official verified information.',
} as const;

/**
 * Standard public bot commands registered with Telegram via BotFather / setMyCommands.
 */
export const PUBLIC_COMMANDS: readonly BotCommand[] = [
  {
    command: 'start',
    description: 'Start conversation and overview of Elite Force AI',
  },
  {
    command: 'help',
    description: 'Show available commands, language tips, and usage guide',
  },
  {
    command: 'about',
    description: 'Learn about Elite Force AI, security, and official sources',
  },
  {
    command: 'ask',
    description: 'Ask a specific question (e.g., /ask What is Elite Force?)',
  },
] as const;

/**
 * Administrative commands available only to authorized Telegram user IDs.
 */
export const ADMIN_COMMANDS = {
  STATUS: 'status',
  RELOAD: 'reload',
  BROADCAST: 'broadcast',
  USERS: 'users',
} as const;
