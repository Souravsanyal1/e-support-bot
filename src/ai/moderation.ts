import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

/**
 * OpenAI omni-moderation-latest and Gemini multimodal image & text moderation client.
 * Provides resilient NSFW / nudity detection even if OpenAI API key is unconfigured.
 */

let _client: OpenAI | null = null;
let _geminiClient: GoogleGenAI | null = null;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY || env.openaiApiKey;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  if (_client && _client.apiKey === apiKey) return _client;
  const timeoutMs = env.imageModerationTimeoutMs || 10_000;
  _client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  return _client;
}

function getGeminiClient(): GoogleGenAI {
  if (_geminiClient) return _geminiClient;
  if (!env.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  _geminiClient = new GoogleGenAI({ apiKey: env.geminiApiKey });
  return _geminiClient;
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
 * Supported MIME types accepted by moderation image input.
 */
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/**
 * Moderates an image using OpenAI omni-moderation-latest.
 */
async function moderateImageWithOpenAI(
  imageBase64: string,
  mimeType: string,
  caption?: string
): Promise<ModerationResult> {
  const client = getClient();
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

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
 * Moderates an image using Google Gemini multimodal analysis and safety filters.
 */
export async function moderateImageWithGemini(
  imageBase64: string,
  mimeType: string,
  caption?: string
): Promise<ModerationResult> {
  const ai = getGeminiClient();
  try {
    const response = await ai.models.generateContent({
      model: env.geminiModel || 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            {
              text:
                'Inspect this image and caption strictly for nudity, sexually explicit content, pornographic material, or exposed breasts/genitals/intimate areas.\n' +
                'Is this image sexually explicit, nude, or inappropriate adult content for a public community?\n' +
                (caption ? `Caption: "${caption}"\n` : '') +
                'Answer ONLY with a JSON object: {"flagged": boolean, "reason": string}',
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === 'SAFETY' || response.promptFeedback?.blockReason === 'SAFETY') {
      logger.warn('Gemini image moderation: blocked by AI safety policy');
      return {
        flagged: true,
        reason: 'Image blocked by AI safety policy (adult/nude content)',
        categories: ['sexual'],
        confidence: 1.0,
      };
    }

    const replyText = response.text?.trim() || '';
    if (!replyText) {
      return {
        flagged: true,
        reason: 'Image blocked by safety filter',
        categories: ['sexual'],
        confidence: 0.95,
      };
    }

    try {
      const parsed = JSON.parse(replyText) as { flagged?: boolean; isNude?: boolean; reason?: string };
      const isFlagged = Boolean(parsed.flagged || parsed.isNude);
      return {
        flagged: isFlagged,
        reason: parsed.reason || (isFlagged ? 'Sexual / adult content detected' : undefined),
        categories: isFlagged ? ['sexual'] : undefined,
        confidence: isFlagged ? 0.99 : 0.05,
      };
    } catch {
      const lower = replyText.toLowerCase();
      const isFlagged =
        lower.includes('"flagged": true') ||
        lower.includes('"isnude": true') ||
        lower.includes('nude') ||
        lower.includes('explicit') ||
        lower.includes('sexual');
      return {
        flagged: isFlagged,
        reason: isFlagged ? 'Sexual / adult content detected' : undefined,
        categories: isFlagged ? ['sexual'] : undefined,
        confidence: isFlagged ? 0.95 : 0.1,
      };
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (/safety|blocked|harm_category|explicit|porn|nude|sex|refus/i.test(errMsg)) {
      logger.warn('Gemini image moderation caught safety refusal; flagging content', { error: errMsg });
      return {
        flagged: true,
        reason: 'Refused by AI safety policy (adult/nude content)',
        categories: ['sexual'],
        confidence: 1.0,
      };
    }
    throw err;
  }
}

/**
 * Moderates an image (and optional caption) using OpenAI omni-moderation-latest
 * with automatic fallback to Gemini multimodal moderation.
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

  // 1. Primary: OpenAI omni-moderation-latest if configured
  if (isOpenAIModerationAvailable()) {
    try {
      return await moderateImageWithOpenAI(imageBase64, mimeType, caption);
    } catch (openAiErr) {
      logger.warn('OpenAI moderation API call failed, attempting Gemini fallback', {
        error: openAiErr instanceof Error ? openAiErr.message : String(openAiErr),
      });
      if (env.geminiApiKey) {
        return await moderateImageWithGemini(imageBase64, mimeType, caption);
      }
      throw openAiErr;
    }
  }

  // 2. Secondary / Primary fallback: Gemini multimodal moderation
  if (env.geminiApiKey) {
    return await moderateImageWithGemini(imageBase64, mimeType, caption);
  }

  throw new Error('No image moderation provider configured (OPENAI_API_KEY or GEMINI_API_KEY required)');
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
 * Returns true if OPENAI_API_KEY is configured and valid.
 */
export function isOpenAIModerationAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || env.openaiApiKey);
}

/**
 * Returns true if either OpenAI or Gemini is available for image moderation.
 */
export function isImageModerationAvailable(): boolean {
  return isOpenAIModerationAvailable() || Boolean(env.geminiApiKey);
}

