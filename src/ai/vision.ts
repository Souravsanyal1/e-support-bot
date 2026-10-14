import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

const ai = env.geminiApiKey ? new GoogleGenAI({ apiKey: env.geminiApiKey }) : null;

export const INAPPROPRIATE_CONTENT_TAG = '[INAPPROPRIATE_CONTENT_DETECTED]';

export interface AnalyzeImageOptions {
  imageBase64: string;
  mimeType: string;
  userPrompt?: string;
  contextInfo?: string;
}

export interface VisionAnalysisResult {
  /** AI-generated analysis text for the image */
  text: string;
  /** Whether the image was flagged as inappropriate, adult, or nude */
  isInappropriate: boolean;
}

export function isInappropriateResponse(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.includes(INAPPROPRIATE_CONTENT_TAG.toLowerCase())) return true;
  if (lower.includes("unable to assist with that")) return true;
  if (lower.includes("cannot assist with that")) return true;
  if (lower.includes("cannot assist with this image")) return true;
  if (lower.includes("can't help with that")) return true;
  if (lower.includes("cannot fulfill this request")) return true;
  if (lower.includes("violates our safety policy")) return true;
  if (lower.includes("violates our usage policy")) return true;
  return false;
}

/**
 * Builds the multimodal vision system prompt for image analysis.
 * Incorporates strict safety moderation to prevent processing or describing
 * nude, sexually explicit, adult, or vulgar images.
 */
export function buildVisionSystemPrompt(): string {
  return `
You are Celia, the System & Group Management Admin for Elite Force. You have full multimodal visual perception capabilities and can see, inspect, and analyze uploaded images in high detail.

==================================================
IMAGE ANALYSIS GUIDELINES
==================================================
- The image has already been verified as safe content before reaching you.
- Inspect the image carefully and provide clear, accurate, and helpful information.
- Identify and explain any visible text, error messages, transaction statuses, wallet addresses, interface buttons, charts, logos, or UI elements.
- For Elite Force ecosystem images: provide detailed, helpful guidance.
- For general screenshots or technical images: explain what you see clearly.
- Never claim that you cannot see or process images.
- Keep your response professional, helpful, and under 150 words.

==================================================
RESPONSE RULES
==================================================
- CRITICAL: DO NOT start your response with "I'm Celia, your System & Group Management Admin." Answer directly.
- Reply in English only.
- Be concise, accurate, and helpful.
- If the image is unclear or too small to analyze: say so and ask for a clearer version.
- If the image contains adult material, exposed body parts, or sexually explicit content, respond only with: ${INAPPROPRIATE_CONTENT_TAG}
`.trim();
}

/**
 * Calls OpenRouter with vision payload (multimodal).
 */
async function callOpenRouterVision(
  base64Data: string,
  mimeType: string,
  prompt: string,
  modelOverride?: string
): Promise<string> {
  if (!env.openrouterApiKey) {
    throw new Error('OpenRouter API key is not configured');
  }

  const systemPrompt = buildVisionSystemPrompt();
  const modelToUse = modelOverride || env.openrouterModel || 'openai/gpt-4o-mini';

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.openrouterApiKey}`,
      'HTTP-Referer': 'https://t.me/Elite_Force_Support_Bot',
      'X-Title': 'Celia System & Support Admin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelToUse,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
          ],
        },
      ],
      temperature: 0.3,
      max_tokens: 600,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    if (modelToUse !== 'openai/gpt-4o-mini') {
      logger.warn(`OpenRouter model ${modelToUse} failed for vision, falling back to openai/gpt-4o-mini`);
      return callOpenRouterVision(base64Data, mimeType, prompt, 'openai/gpt-4o-mini');
    }
    throw new Error(`OpenRouter Vision API error (${res.status}): ${JSON.stringify(errorData)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const replyText = data.choices?.[0]?.message?.content?.trim() || '';

  if (!replyText) {
    throw new Error('Empty response from OpenRouter Vision API');
  }

  return replyText;
}

/**
 * Calls Google Gemini generateContent with inline image data.
 */
async function callGeminiVision(
  base64Data: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  if (!ai) {
    throw new Error('Gemini API client not initialized');
  }

  const systemInstruction = buildVisionSystemPrompt();
  const isThinkingModel =
    env.geminiModel.includes('2.5') || env.geminiModel.includes('thinking');

  const genConfig: Record<string, unknown> = {
    systemInstruction,
    temperature: 0.3,
    maxOutputTokens: 600,
  };

  if (isThinkingModel) {
    genConfig.thinkingConfig = {
      thinkingBudget: 0,
    };
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new Error('Gemini Vision timed out after 15 seconds')), 15000);
    if (t.unref) t.unref();
  });

  const response = await Promise.race([
    ai.models.generateContent({
      model: env.geminiModel,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: genConfig,
    }),
    timeoutPromise,
  ]);

  const replyText = response.text?.trim() || '';
  if (!replyText) {
    throw new Error('Empty response from Gemini Vision API');
  }

  return replyText;
}

/**
 * Analyzes an image with multimodal AI support (Gemini & OpenRouter dual fallback).
 *
 * NOTE: This function assumes the image has ALREADY been moderated by
 * OpenAI omni-moderation-latest (moderation.ts). Call moderateImage() first;
 * only call analyzeImageWithAI() if moderation returned flagged=false.
 */
export async function analyzeImageWithAI(options: AnalyzeImageOptions): Promise<VisionAnalysisResult> {
  const { imageBase64, mimeType, userPrompt, contextInfo } = options;

  const defaultQuestion =
    'Please analyze this image thoroughly. Identify any text, error messages, cryptocurrency transactions, ' +
    'system interfaces, logos, or diagrams shown. Provide clear, accurate, and helpful English guidance.';

  const cleanPrompt = userPrompt && userPrompt.trim().length > 0 ? userPrompt.trim() : defaultQuestion;

  const promptWithContext = contextInfo
    ? `${cleanPrompt}\n\n[Additional Verified Community Context:\n${contextInfo}]`
    : cleanPrompt;

  // Schedule based: 0-11 hrs Gemini, 12-23 hrs OpenRouter (with mutual auto-fallback)
  const hour = new Date().getHours();
  const primary = hour < 12 ? 'gemini' : 'openrouter';
  const secondary = primary === 'gemini' ? 'openrouter' : 'gemini';

  logger.info('Analyzing image using multimodal AI (pre-moderated as safe)', {
    primaryProvider: primary,
    mimeType,
    hasCaption: Boolean(userPrompt),
  });

  async function tryVision(provider: 'gemini' | 'openrouter'): Promise<string> {
    if (provider === 'gemini') {
      if (!ai) throw new Error('Gemini API is not configured');
      return await callGeminiVision(imageBase64, mimeType, promptWithContext);
    } else {
      if (!env.openrouterApiKey) throw new Error('OpenRouter API is not configured');
      return await callOpenRouterVision(imageBase64, mimeType, promptWithContext);
    }
  }

  try {
    let rawText = '';
    try {
      rawText = await tryVision(primary);
      logger.info('Primary vision provider succeeded', { provider: primary });
    } catch (primaryErr) {
      logger.warn(`Primary vision provider (${primary}) failed, falling back to ${secondary}`, {
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
      rawText = await tryVision(secondary);
      logger.info('Secondary vision provider succeeded', { provider: secondary });
    }

    if (isInappropriateResponse(rawText)) {
      logger.warn('Vision analysis flagged image as inappropriate/adult or triggered safety refusal', {
        snippet: rawText.slice(0, 100),
      });
      return { text: '', isInappropriate: true };
    }

    return { text: rawText, isInappropriate: false };
  } catch (err) {
    logger.error('All vision providers failed for image analysis', err);
    throw new Error('Unable to analyze image at this time due to temporary AI vision unavailability.');
  }
}
