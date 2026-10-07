import dotenv from 'dotenv';

// Load environment variables from .env file if present
dotenv.config();

export interface AppConfig {
  readonly telegramBotToken: string;
  readonly aiProvider: 'openrouter' | 'gemini';
  readonly openrouterApiKey?: string;
  readonly openrouterModel: string;
  readonly geminiApiKey?: string;
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

  // AI Provider configuration
  const rawOpenRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const openrouterApiKey =
    rawOpenRouterKey && rawOpenRouterKey !== 'your_openrouter_api_key_here'
      ? rawOpenRouterKey
      : undefined;

  const openrouterModel = process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini';

  const rawGeminiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiApiKey =
    rawGeminiKey && rawGeminiKey !== 'your_gemini_api_key_here'
      ? rawGeminiKey
      : undefined;

  const geminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

  const specifiedProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  const aiProvider: 'openrouter' | 'gemini' =
    specifiedProvider === 'openrouter' || specifiedProvider === 'gemini'
      ? specifiedProvider
      : openrouterApiKey
      ? 'openrouter'
      : 'gemini';

  // Ensure at least one working AI key is present
  if (aiProvider === 'openrouter' && !openrouterApiKey) {
    if (geminiApiKey) {
      // Fallback automatically to Gemini
    } else {
      throw new Error(
        'Startup Error: OPENROUTER_API_KEY is missing or set to a placeholder while AI_PROVIDER is set to openrouter.'
      );
    }
  } else if (aiProvider === 'gemini' && !geminiApiKey) {
    if (!openrouterApiKey) {
      throw new Error(
        'Startup Error: GEMINI_API_KEY is missing. Please supply a valid key in your environment.'
      );
    }
  }

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
    aiProvider,
    openrouterApiKey,
    openrouterModel,
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
  if (env.openrouterApiKey) {
    sanitized = sanitized.split(env.openrouterApiKey).join('[REDACTED_OPENROUTER_KEY]');
  }
  if (env.geminiApiKey) {
    sanitized = sanitized.split(env.geminiApiKey).join('[REDACTED_GEMINI_KEY]');
  }
  if (env.webhookSecret) {
    sanitized = sanitized.split(env.webhookSecret).join('[REDACTED_WEBHOOK_SECRET]');
  }
  return sanitized;
}
