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
  _client = new OpenAI({ apiKey: env.openaiApiKey, timeout: 15_000, maxRetries: 1 });
  return _client;
}

export interface ModerationResult {
  /** Whether the content was flagged as inappropriate */
  flagged: boolean;
  /** Human-readable reason for the flag */
  reason?: string;
  /** Detected categories that triggered the flag */
  categories?: string[];
  /** Whether it was a child-safety violation */
  isChildSafetyViolation?: boolean;
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

  // Cast to access string-keyed category properties safely
  const cats = result.categories as unknown as Record<string, boolean>;

  const sexualMinors = cats['sexual/minors'] === true;
  const sexual = cats['sexual'] === true;

  if (sexualMinors) {
    logger.warn('Image moderation: potential child-safety violation detected');
    return {
      flagged: true,
      reason: 'Potential child-safety violation',
      categories: ['sexual/minors'],
      isChildSafetyViolation: true,
    };
  }

  if (sexual) {
    return {
      flagged: true,
      reason: 'Sexual / explicit content detected',
      categories: ['sexual'],
    };
  }

  return { flagged: false };
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
