import OpenAI from 'openai';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

/**
 * OpenAI omni-moderation-latest image & text moderation client.
 * The OpenAI moderation endpoint is FREE — no charged tokens consumed.
 * It only classifies content; it never generates text or stores images.
 */

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  if (!env.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const timeoutMs = env.imageModerationTimeoutMs || 10_000;
  _client = new OpenAI({ apiKey: env.openaiApiKey, timeout: timeoutMs, maxRetries: 1 });
  return _client;
}

export interface ModerationResult {
  /** Whether the content was flagged as inappropriate */
  flagged: boolean;
  /** Human-readable reason for the flag */
  reason?: string;
  /** Detected categories that triggered the flag */
  categories?: string[];
  /** Confidence score (0.0 to 1.0) */
  confidence?: number;
  /** Whether it was a child-safety violation */
  isChildSafetyViolation?: boolean;
}

// In-memory LRU-style deduplication cache to prevent duplicate warnings and processing
const processedMessages = new Map<number, number>();
const DEDUPLICATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function isMessageAlreadyProcessed(messageId: number): boolean {
  const timestamp = processedMessages.get(messageId);
  if (!timestamp) return false;
  if (Date.now() - timestamp > DEDUPLICATION_TTL_MS) {
    processedMessages.delete(messageId);
    return false;
  }
  return true;
}

export function markMessageAsProcessed(messageId: number): void {
  // Prune expired entries
  const now = Date.now();
  for (const [id, time] of processedMessages.entries()) {
    if (now - time > DEDUPLICATION_TTL_MS) {
      processedMessages.delete(id);
    }
  }
  processedMessages.set(messageId, now);
}

/**
 * Checks if moderation is enabled and if the chat is targeted for moderation.
 */
export function shouldModerateChat(chatId?: number, isGroup = true): boolean {
  if (!env.enableImageModeration) return false;
  // If moderationGroupIds is specified and this is a group, chat ID must be included
  if (isGroup && env.moderationGroupIds.size > 0) {
    return chatId !== undefined && env.moderationGroupIds.has(chatId);
  }
  // Moderation applies to all chats (groups, channels, and private DMs)
  return true;
}

/**
 * Supported MIME types accepted by omni-moderation-latest image input.
 */
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/**
 * Moderates an image (and optional caption) using OpenAI omni-moderation-latest.
 * Only sexual-content categories are used for flagging; violence/harassment are
 * NOT treated as NSFW image violations.
 *
 * @throws Error if OPENAI_API_KEY is not configured or API call fails
 */
export async function moderateImage(
  imageBase64: string,
  mimeType: string,
  caption?: string
): Promise<ModerationResult> {
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    logger.warn('Image MIME type not supported by moderation API, skipping', { mimeType });
    return { flagged: false, reason: `Unsupported MIME type: ${mimeType}` };
  }

  const client = getClient();
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  // Build multimodal moderation input: image + optional text caption
  const input: OpenAI.Moderations.ModerationMultiModalInput[] = [
    { type: 'image_url', image_url: { url: dataUrl } },
    ...(caption?.trim()
      ? [{ type: 'text' as const, text: caption.slice(0, 1000) }]
      : []),
  ];

  const response = await client.moderations.create({
    model: 'omni-moderation-latest',
    input,
  });

  const result = response.results[0];
  if (!result) {
    throw new Error('Empty response from OpenAI moderation API');
  }

  // Cast to access string-keyed category properties and scores safely
  const cats = result.categories as unknown as Record<string, boolean>;
  const catScores = ((result as unknown as { category_scores?: Record<string, number> }).category_scores || {}) as Record<string, number>;

  const sexualMinorsScore = catScores['sexual/minors'] ?? (cats['sexual/minors'] ? 1.0 : 0.0);
  const sexualScore = catScores['sexual'] ?? (cats['sexual'] ? 1.0 : 0.0);
  const threshold = env.imageModerationConfidenceThreshold;

  const sexualMinors = cats['sexual/minors'] === true || sexualMinorsScore >= threshold;
  const sexual = cats['sexual'] === true || sexualScore >= threshold;

  if (sexualMinors) {
    logger.warn('Image moderation: potential child-safety violation detected', { score: sexualMinorsScore });
    return {
      flagged: true,
      reason: 'Potential child-safety violation',
      categories: ['sexual/minors'],
      confidence: sexualMinorsScore,
      isChildSafetyViolation: true,
    };
  }

  if (sexual) {
    logger.info('Image moderation: sexual content detected', { score: sexualScore, threshold });
    return {
      flagged: true,
      reason: 'Sexual / explicit content detected',
      categories: ['sexual'],
      confidence: sexualScore,
    };
  }

  return { flagged: false, confidence: Math.max(sexualScore, sexualMinorsScore) };
}

/**
 * Moderates a plain-text string using OpenAI omni-moderation-latest.
 * Returns true if the text is flagged by any category.
 */
export async function moderateText(text: string): Promise<boolean> {
  const client = getClient();
  const response = await client.moderations.create({
    model: 'omni-moderation-latest',
    input: text.slice(0, 4000),
  });
  return response.results[0]?.flagged ?? false;
}

/**
 * Returns true if OPENAI_API_KEY is configured and valid (non-placeholder).
 */
export function isOpenAIModerationAvailable(): boolean {
  try {
    getClient();
    return true;
  } catch {
    return false;
  }
}
