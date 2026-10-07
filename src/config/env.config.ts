import dotenv from 'dotenv';

// Load environment variables from .env file if present
dotenv.config();

export interface AppConfig {
  readonly telegramBotToken: string;
  readonly geminiApiKey: string;
  readonly geminiModel: string;
  readonly adminUserIds: ReadonlySet<number>;
  readonly botMode: 'polling' | 'webhook';
  readonly port: number;
  readonly webhookUrl?: string;
  readonly webhookSecret?: string;
  readonly rateLimitMaxMessages: number;
  readonly rateLimitWindowSeconds: number;
  readonly maxConversationHistory: number;
  readonly sessionTtlMinutes: number;
}

/**
 * Validates and parses environment variables.
 * Fails safely at startup if critical secrets or configs are missing.
 */
function loadAndValidateConfig(): AppConfig {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();

  // Validate critical Telegram token
  if (!telegramBotToken || telegramBotToken === 'your_telegram_bot_token_here') {
    throw new Error(
      'Startup Error: TELEGRAM_BOT_TOKEN is missing or set to a placeholder. ' +
      'Please supply a valid token from @BotFather in your environment.'
    );
  }

  // Basic format check for Telegram bot token (<id>:<hash>)
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(telegramBotToken)) {
    throw new Error(
      'Startup Error: TELEGRAM_BOT_TOKEN does not match expected Telegram token pattern (<bot_id>:<token>).'
    );
  }

  // Validate critical Gemini API key
  if (!geminiApiKey || geminiApiKey === 'your_gemini_api_key_here') {
    throw new Error(
      'Startup Error: GEMINI_API_KEY is missing or set to a placeholder. ' +
      'Please supply a valid API key from Google AI Studio in your environment.'
    );
  }

  // Gemini model (default to modern, fast, free-tier friendly Flash model)
  const geminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

  // Parse admin user IDs
  const rawAdminIds = process.env.ADMIN_USER_IDS?.trim() || '';
  const adminUserIds = new Set<number>();
  if (rawAdminIds) {
    for (const rawId of rawAdminIds.split(',')) {
      const parsed = parseInt(rawId.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        adminUserIds.add(parsed);
      }
    }
  }

  // Bot mode
  const rawMode = process.env.BOT_MODE?.trim().toLowerCase();
  const botMode: 'polling' | 'webhook' = rawMode === 'webhook' ? 'webhook' : 'polling';

  const port = parseInt(process.env.PORT?.trim() || '3000', 10);
  const webhookUrl = process.env.WEBHOOK_URL?.trim();
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

  if (botMode === 'webhook') {
    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      throw new Error(
        'Startup Error: WEBHOOK_URL must be an HTTPS URL when BOT_MODE is set to webhook.'
      );
    }
    if (!webhookSecret || webhookSecret === 'your_random_webhook_secret_here') {
      throw new Error(
        'Startup Error: TELEGRAM_WEBHOOK_SECRET must be set to a secure string when BOT_MODE is set to webhook.'
      );
    }
  }

  const rateLimitMaxMessages = parseInt(
    process.env.RATE_LIMIT_MAX_MESSAGES?.trim() || '10',
    10
  );
  const rateLimitWindowSeconds = parseInt(
    process.env.RATE_LIMIT_WINDOW_SECONDS?.trim() || '60',
    10
  );
  const maxConversationHistory = parseInt(
    process.env.MAX_CONVERSATION_HISTORY?.trim() || '6',
    10
  );
  const sessionTtlMinutes = parseInt(
    process.env.SESSION_TTL_MINUTES?.trim() || '30',
    10
  );

  return {
    telegramBotToken,
    geminiApiKey,
    geminiModel,
    adminUserIds,
    botMode,
    port: isNaN(port) ? 3000 : port,
    webhookUrl,
    webhookSecret,
    rateLimitMaxMessages: isNaN(rateLimitMaxMessages) ? 10 : rateLimitMaxMessages,
    rateLimitWindowSeconds: isNaN(rateLimitWindowSeconds) ? 60 : rateLimitWindowSeconds,
    maxConversationHistory: isNaN(maxConversationHistory) ? 6 : maxConversationHistory,
    sessionTtlMinutes: isNaN(sessionTtlMinutes) ? 30 : sessionTtlMinutes,
  };
}

export const env: AppConfig = loadAndValidateConfig();

/**
 * Sanitizes any log string or object by redacting active secret credentials.
 */
export function sanitizeLogString(message: string): string {
  let sanitized = message;
  if (env.telegramBotToken) {
    sanitized = sanitized.split(env.telegramBotToken).join('[REDACTED_TELEGRAM_TOKEN]');
  }
  if (env.geminiApiKey) {
    sanitized = sanitized.split(env.geminiApiKey).join('[REDACTED_GEMINI_KEY]');
  }
  if (env.webhookSecret) {
    sanitized = sanitized.split(env.webhookSecret).join('[REDACTED_WEBHOOK_SECRET]');
  }
  return sanitized;
}
