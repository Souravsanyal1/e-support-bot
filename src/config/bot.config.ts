import { BotCommand } from 'grammy/types';

export const BOT_CONFIG = {
  name: 'Celia',
  introduction: "I'm Celia, your System & Group Management Admin.",
  username: '@Elite_Force_Support_Bot',
  tagline: 'Official AI Community Support Assistant for Elite Force',
  version: '1.0.0',
  description:
    "I'm Celia, your System & Group Management Admin. I help guide community members, " +
    'explain the Elite Force ecosystem, answer questions, and direct users to official verified information.',
} as const;

/**
 * Official loading sticker displayed while AI generates responses.
 * Pack: https://t.me/addstickers/EliteForceWeb3 (Sticker #6: Trophy 🏆 animated)
 */
export const LOADING_STICKER_FILE_ID =
  'CAACAgUAAxUAAWrF3Jy0Btgu2qKJrEKpHrnUNWLlAALDKgACMIAIVmTsKwTA2B2hPQQ';

/**
 * Standard public bot commands registered with Telegram via BotFather / setMyCommands.
 */
export const PUBLIC_COMMANDS: readonly BotCommand[] = [
  {
    command: 'start',
    description: 'Start conversation with Celia',
  },
  {
    command: 'help',
    description: 'Show available commands, language tips, and usage guide',
  },
  {
    command: 'about',
    description: 'Learn about Celia, security, and official sources',
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
  OFF: 'off',
  ON: 'on',
  TIME: 'time',
} as const;

/**
 * Centralized Language Enforcement Policy Configuration
 */
export const LANGUAGE_POLICY = {
  enabled: true,
  allowedLanguage: 'english',
  deleteInGroups: true,
  sendWarningInGroups: true,
  sendWarningInPrivate: true,
  warningAutoDeleteMs: 2 * 60 * 1000, // 2 minutes auto-delete in groups
  warningMessage: '⚠️ Only English is supported. Please ask your question in English.',
  // Reject mixed messages if any non-Latin script or substantial non-English words are found
  rejectMixedWithSubstantialNonEnglish: true,
} as const;
