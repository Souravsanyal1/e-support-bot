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
  /** OpenAI API key — used exclusively for the free omni-moderation-latest endpoint. No charges for moderation calls. */
  readonly openaiApiKey?: string;
  readonly adminUserIds: ReadonlySet<number>;
  readonly adminChatId?: number;
  readonly botUsername: string;
  readonly groupReplyCooldownSeconds: number;
  readonly contextMessages: number;
  readonly memoryTtlHours: number;
  readonly scanAllGroupMessages: boolean;
  readonly timezone: string;
  readonly botMode: 'polling' | 'webhook';
  readonly port: number;
  readonly webhookUrl?: string;
  readonly webhookSecret?: string;
  readonly rateLimitMaxMessages: number;
  readonly rateLimitWindowSeconds: number;
  readonly maxConversationHistory: number;
  readonly sessionTtlMinutes: number;
  /** Whether to block images when OpenAI moderation API is unavailable (fail-closed). Default: false = allow image through. */
  readonly moderationFailClosed: boolean;
  // Knowledge Auto-Sync System Configuration
  readonly enableKnowledgeSync: boolean;
  readonly knowledgeSyncIntervalMinutes: number;
  readonly knowledgeFilePath: string;
  readonly officialWebsiteUrl: string;
  readonly officialTimerUrl: string;
  // Inappropriate Image Detection & Auto-Moderation (Req 18)
  readonly enableImageModeration: boolean;
  readonly moderationGroupIds: ReadonlySet<number>;
  readonly imageModerationProvider: 'openai' | 'gemini' | 'openrouter';
  readonly imageModerationConfidenceThreshold: number;
  readonly imageModerationTimeoutMs: number;
  readonly imageModerationWarningMessage: string;
  // ── English-Only Language Enforcement ──────────────────────────────────────
  readonly englishOnlyMode: boolean;
  /** If true, admins are exempt from English-only enforcement. */
  readonly englishOnlyAdminExempt: boolean;
  /** If true, confirmed non-English group messages are deleted. */
  readonly englishOnlyDeleteNonEnglish: boolean;
  /** If true, send a short English warning after deleting a non-English message. */
  readonly englishOnlyWarnUser: boolean;
  /** Minimum language-detection confidence (0-1) before applying deletion. */
  readonly englishOnlyMinConfidence: number;
  // ── Profanity & Abuse Moderation ──────────────────────────────────────────
  readonly profanityFilterEnabled: boolean;
  readonly profanityAutoDelete: boolean;
  /** If true, admins are exempt from profanity auto-deletion. */
  readonly profanityAdminExempt: boolean;
  /** If true, send a short warning after deleting abusive message. */
  readonly profanityWarnUser: boolean;
  /** Strict mode catches medium-severity words in addition to high/critical. */
  readonly profanityStrictMode: boolean;
  /** If true, repeat offenders are escalated to primary admins. */
  readonly profanityRepeatOffenderEscalation: boolean;
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

  // OpenAI API key — only used for the FREE omni-moderation-latest endpoint
  const rawOpenAIKey = process.env.OPENAI_API_KEY?.trim();
  const openaiApiKey =
    rawOpenAIKey && rawOpenAIKey !== 'your_openai_api_key_here' ? rawOpenAIKey : undefined;

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

  // Default verified backend admin IDs (guarantees primary backend administrator is always recognized)
  const DEFAULT_BACKEND_ADMIN_IDS = [6427121076];

  // Parse admin user IDs from TELEGRAM_ADMIN_ID and ADMIN_USER_IDS
  const rawAdminSources = [
    process.env.TELEGRAM_ADMIN_ID?.trim(),
    process.env.ADMIN_USER_IDS?.trim(),
  ].filter(Boolean);

  const adminUserIds = new Set<number>(DEFAULT_BACKEND_ADMIN_IDS);
  for (const source of rawAdminSources) {
    if (!source) continue;
    for (const rawId of source.split(',')) {
      const parsed = parseInt(rawId.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        adminUserIds.add(parsed);
      }
    }
  }

  // Configured timezone with fallback to Asia/Dhaka
  const timezone = process.env.TIMEZONE?.trim() || 'Asia/Dhaka';

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

  const moderationFailClosed = process.env.MODERATION_FAIL_CLOSED?.trim().toLowerCase() === 'true';

  // Knowledge Auto-Sync System Configuration
  const enableKnowledgeSync = process.env.ENABLE_KNOWLEDGE_SYNC?.trim().toLowerCase() !== 'false';
  const rawSyncInterval = parseInt(process.env.KNOWLEDGE_SYNC_INTERVAL_MINUTES?.trim() || '15', 10);
  const knowledgeSyncIntervalMinutes = isNaN(rawSyncInterval) || rawSyncInterval < 1 ? 15 : rawSyncInterval;
  const knowledgeFilePath = process.env.KNOWLEDGE_FILE_PATH?.trim() || 'knowledge/elite-force-knowledge.md';
  const officialWebsiteUrl = process.env.OFFICIAL_WEBSITE_URL?.trim() || 'https://elite-force.space';
  const officialTimerUrl = process.env.OFFICIAL_TIMER_URL?.trim() || 'https://timer.elite-force.space';

  // Inappropriate Image Detection & Auto-Moderation Configuration (Req 18)
  const enableImageModeration = process.env.ENABLE_IMAGE_MODERATION?.trim().toLowerCase() !== 'false';

  // Parse allowed moderation group IDs (empty set = all groups)
  const moderationGroupIds = new Set<number>();
  const rawModGroups = process.env.MODERATION_GROUP_IDS?.trim();
  if (rawModGroups) {
    for (const rawId of rawModGroups.split(',')) {
      const parsed = parseInt(rawId.trim(), 10);
      if (!isNaN(parsed)) {
        moderationGroupIds.add(parsed);
      }
    }
  }

  const rawModProvider = process.env.IMAGE_MODERATION_PROVIDER?.trim().toLowerCase();
  const imageModerationProvider: 'openai' | 'gemini' | 'openrouter' =
    rawModProvider === 'gemini' || rawModProvider === 'openrouter' ? rawModProvider : 'openai';

  const rawThreshold = parseFloat(process.env.IMAGE_MODERATION_CONFIDENCE_THRESHOLD?.trim() || '0.80');
  const imageModerationConfidenceThreshold =
    isNaN(rawThreshold) || rawThreshold < 0 || rawThreshold > 1 ? 0.80 : rawThreshold;

  const rawTimeout = parseInt(process.env.IMAGE_MODERATION_TIMEOUT_MS?.trim() || '10000', 10);
  const imageModerationTimeoutMs = isNaN(rawTimeout) || rawTimeout < 1000 ? 10000 : rawTimeout;

  const imageModerationWarningMessage =
    process.env.IMAGE_MODERATION_WARNING_MESSAGE?.trim() ||
    '⚠️ Inappropriate, adult, or nude images are strictly prohibited in Elite Force community chats.';

  // Bot identity & group behaviour
  const botUsername = process.env.BOT_USERNAME?.trim().replace(/^@/, '') || '';

  const rawCooldown = parseInt(process.env.GROUP_REPLY_COOLDOWN_SECONDS?.trim() || '3', 10);
  const groupReplyCooldownSeconds = isNaN(rawCooldown) || rawCooldown < 0 ? 3 : rawCooldown;

  const rawContextMessages = parseInt(process.env.CONTEXT_MESSAGES?.trim() || '5', 10);
  const contextMessages = isNaN(rawContextMessages) || rawContextMessages < 1 ? 5 : rawContextMessages;

  const rawMemoryTtl = parseFloat(process.env.MEMORY_TTL_HOURS?.trim() || '24');
  const memoryTtlHours = isNaN(rawMemoryTtl) || rawMemoryTtl <= 0 ? 24 : rawMemoryTtl;

  const scanAllGroupMessages =
    process.env.SCAN_ALL_GROUP_MESSAGES?.trim().toLowerCase() === 'true';

  // ── English-Only Language Enforcement ──────────────────────────────────────
  const englishOnlyMode =
    process.env.ENGLISH_ONLY_MODE?.trim().toLowerCase() !== 'false'; // default: true
  const englishOnlyAdminExempt =
    process.env.ENGLISH_ONLY_ADMIN_EXEMPT?.trim().toLowerCase() !== 'false'; // default: true
  const englishOnlyDeleteNonEnglish =
    process.env.ENGLISH_ONLY_DELETE_NON_ENGLISH?.trim().toLowerCase() !== 'false'; // default: true
  const englishOnlyWarnUser =
    process.env.ENGLISH_ONLY_WARN_USER?.trim().toLowerCase() === 'true'; // default: false
  const rawEngConf = parseFloat(process.env.ENGLISH_ONLY_MIN_CONFIDENCE?.trim() || '0.70');
  const englishOnlyMinConfidence =
    isNaN(rawEngConf) || rawEngConf < 0 || rawEngConf > 1 ? 0.70 : rawEngConf;

  // ── Profanity & Abuse Moderation ──────────────────────────────────────────
  const profanityFilterEnabled =
    process.env.PROFANITY_FILTER_ENABLED?.trim().toLowerCase() !== 'false'; // default: true
  const profanityAutoDelete =
    process.env.PROFANITY_AUTO_DELETE?.trim().toLowerCase() !== 'false'; // default: true
  const profanityAdminExempt =
    process.env.PROFANITY_ADMIN_EXEMPT?.trim().toLowerCase() !== 'false'; // default: true
  const profanityWarnUser =
    process.env.PROFANITY_WARN_USER?.trim().toLowerCase() === 'true'; // default: false
  const profanityStrictMode =
    process.env.PROFANITY_STRICT_MODE?.trim().toLowerCase() !== 'false'; // default: true
  const profanityRepeatOffenderEscalation =
    process.env.PROFANITY_REPEAT_OFFENDER_ESCALATION?.trim().toLowerCase() !== 'false'; // default: true

  return {
    telegramBotToken,
    aiProvider,
    openrouterApiKey,
    openrouterModel,
    geminiApiKey,
    geminiModel,
    openaiApiKey,
    adminUserIds,
    botUsername,
    groupReplyCooldownSeconds,
    contextMessages,
    memoryTtlHours,
    scanAllGroupMessages,
    timezone,
    botMode,
    port: isNaN(port) ? 3000 : port,
    webhookUrl,
    webhookSecret,
    rateLimitMaxMessages: isNaN(rateLimitMaxMessages) ? 10 : rateLimitMaxMessages,
    rateLimitWindowSeconds: isNaN(rateLimitWindowSeconds) ? 60 : rateLimitWindowSeconds,
    maxConversationHistory: isNaN(maxConversationHistory) ? 6 : maxConversationHistory,
    sessionTtlMinutes: isNaN(sessionTtlMinutes) ? 30 : sessionTtlMinutes,
    moderationFailClosed,
    enableKnowledgeSync,
    knowledgeSyncIntervalMinutes,
    knowledgeFilePath,
    officialWebsiteUrl,
    officialTimerUrl,
    enableImageModeration,
    moderationGroupIds,
    imageModerationProvider,
    imageModerationConfidenceThreshold,
    imageModerationTimeoutMs,
    imageModerationWarningMessage,
    // English-only enforcement
    englishOnlyMode,
    englishOnlyAdminExempt,
    englishOnlyDeleteNonEnglish,
    englishOnlyWarnUser,
    englishOnlyMinConfidence,
    // Profanity & abuse moderation
    profanityFilterEnabled,
    profanityAutoDelete,
    profanityAdminExempt,
    profanityWarnUser,
    profanityStrictMode,
    profanityRepeatOffenderEscalation,
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
  if (env.openaiApiKey) {
    sanitized = sanitized.split(env.openaiApiKey).join('[REDACTED_OPENAI_KEY]');
  }
  if (env.webhookSecret) {
    sanitized = sanitized.split(env.webhookSecret).join('[REDACTED_WEBHOOK_SECRET]');
  }
  return sanitized;
}
