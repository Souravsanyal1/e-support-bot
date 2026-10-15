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
  SYNC: 'sync',
  BROADCAST: 'broadcast',
  USERS: 'users',
  OFF: 'off',
  ON: 'on',
  TIME: 'time',
  LOOKUP: 'lookup',
  LOGS: 'logs',
  CLEARLOGS: 'clearlogs',
} as const;

/**
 * Full command list registered for authorized administrators.
 */
export const ADMIN_COMMANDS_LIST: readonly BotCommand[] = [
  ...PUBLIC_COMMANDS,
  { command: 'status', description: 'Server status, latency & AI models' },
  { command: 'reload', description: 'Hot-reload training data and prompts' },
  { command: 'sync', description: 'Force sync official channels & knowledge' },
  { command: 'broadcast', description: 'Broadcast announcement to active users' },
  { command: 'users', description: 'View active user sessions and statistics' },
  { command: 'off', description: 'Disable bot responses (with optional reason)' },
  { command: 'on', description: 'Re-enable bot responses for users' },
  { command: 'time', description: 'Schedule temporary downtime with auto-reactivation' },
  { command: 'lookup', description: 'Lookup user details by @username' },
  { command: 'logs', description: 'Get full message log as txt file' },
  { command: 'clearlogs', description: 'Clear the message log file' },
  { command: 'language', description: 'Switch language mode (all | english | status)' },
] as const;

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

/**
 * Community Group Media Moderation Policy
 * Disallows image sharing by regular members in community groups.
 */
export const GROUP_MEDIA_POLICY = {
  blockAllImagesInGroups: true,
  allowAdminImagesInGroups: true,
  sendWarningInGroups: false, // Do not send warning or reply in group unless explicitly configured
  warningMessage: '⚠️ Sharing images is not allowed in this community group.',
  warningAutoDeleteMs: 60 * 1000, // 1 minute auto-delete notice
} as const;

