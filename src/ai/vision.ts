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
  text: string;
  isInappropriate: boolean;
  reason?: string;
}

/**
 * Builds the multimodal vision prompt ensuring the AI understands its visual capabilities,
 * strictly enforces nudity/bad-image moderation, and prevents repetitive introductions.
 */
export function buildVisionSystemPrompt(): string {
  return `
You are Celia, the System & Group Management Admin for Elite Force. You have full multimodal visual perception capabilities and can see, inspect, and analyze uploaded images in high detail.

==================================================
SAFETY & CONTENT MODERATION (STRICT ENFORCEMENT)
==================================================
Inspect the image carefully for:
1. Nudity, naked individuals, underwear/lingerie, exposed breasts/genitals/buttocks, sexually explicit, suggestive adult, pornographic, or NSFW content.
2. Graphic violence, gore, hate symbols, or offensive/bad material.

IF THE IMAGE CONTAINS ANY NUDITY, NAKEDNESS, SEXUALLY EXPLICIT, NSFW, OR OFFENSIVE CONTENT:
You MUST respond ONLY with the exact text:
${INAPPROPRIATE_CONTENT_TAG}
Do NOT provide any descriptions, commentary, or advice for inappropriate content.

==================================================
LEGITIMATE IMAGE ANALYSIS (ELITE FORCE & SYSTEM GUIDANCE)
==================================================
If the image is legitimate (e.g. Elite Force announcements, logos, BNB Chain/crypto transactions, wallets, error screenshots, technical interfaces, websites, system diagrams, charts, or user questions):
- Provide clear, accurate, helpful, and professional guidance in English.
- Identify and explain any error messages, transaction statuses, buttons, or next steps clearly.
- CRITICAL CONVERSATIONAL RULE: DO NOT start your response with "I'm Celia, your System & Group Management Admin." Answer the user's question or explain the image directly!
- Never claim that you cannot see, inspect, or process images.
- Keep the tone calm, polite, and professional under 150 words.
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
): Promise<VisionAnalysisResult> {
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

  if (
    replyText.includes(INAPPROPRIATE_CONTENT_TAG) ||
    replyText.includes('INAPPROPRIATE_CONTENT')
  ) {
    return {
      text: '',
      isInappropriate: true,
      reason: 'OpenRouter flagged inappropriate/nude content',
    };
  }

  if (!replyText) {
    throw new Error('Empty response from OpenRouter Vision API');
  }

  return {
    text: replyText,
    isInappropriate: false,
  };
}

/**
 * Calls Google Gemini generateContent with inline image data.
 */
async function callGeminiVision(
  base64Data: string,
  mimeType: string,
  prompt: string
): Promise<VisionAnalysisResult> {
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

  try {
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

    const candidate = response.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') {
      return {
        text: '',
        isInappropriate: true,
        reason: 'Gemini safety filter triggered (adult or harmful image content)',
      };
    }

    const replyText = response.text?.trim() || '';

    if (
      replyText.includes(INAPPROPRIATE_CONTENT_TAG) ||
      replyText.includes('INAPPROPRIATE_CONTENT')
    ) {
      return {
        text: '',
        isInappropriate: true,
        reason: 'Gemini flagged inappropriate/nude content',
      };
    }

    if (!replyText) {
      throw new Error('Empty response from Gemini Vision API');
    }

    return {
      text: replyText,
      isInappropriate: false,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('SAFETY') || errMsg.includes('HARM_CATEGORY')) {
      return {
        text: '',
        isInappropriate: true,
        reason: `Gemini safety exception: ${errMsg}`,
      };
    }
    throw err;
  }
}

/**
 * Analyzes an image with multimodal AI support (Gemini & OpenRouter dual fallback).
 * Returns VisionAnalysisResult indicating if the image was flagged as inappropriate/nude
 * or the English analysis response text.
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

  logger.info('Analyzing image using multimodal AI', {
    primaryProvider: primary,
    mimeType,
    hasCaption: Boolean(userPrompt),
  });

  async function tryVision(provider: 'gemini' | 'openrouter'): Promise<VisionAnalysisResult> {
    if (provider === 'gemini') {
      if (!ai) throw new Error('Gemini API is not configured');
      return await callGeminiVision(imageBase64, mimeType, promptWithContext);
    } else {
      if (!env.openrouterApiKey) throw new Error('OpenRouter API is not configured');
      return await callOpenRouterVision(imageBase64, mimeType, promptWithContext);
    }
  }

  try {
    try {
      const result = await tryVision(primary);
      logger.info('Primary vision provider succeeded', {
        provider: primary,
        isInappropriate: result.isInappropriate,
      });
      return result;
    } catch (primaryErr) {
      logger.warn(`Primary vision provider (${primary}) failed, falling back to ${secondary}`, {
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
      const result = await tryVision(secondary);
      logger.info('Secondary vision provider succeeded', {
        provider: secondary,
        isInappropriate: result.isInappropriate,
      });
      return result;
    }
  } catch (err) {
    logger.error('All vision providers failed for image analysis', err);
    throw new Error('Unable to analyze image at this time due to temporary AI vision unavailability.');
  }
}
