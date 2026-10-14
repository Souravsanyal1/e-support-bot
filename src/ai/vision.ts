import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { buildSystemPrompt } from './systemPrompt';

const ai = env.geminiApiKey ? new GoogleGenAI({ apiKey: env.geminiApiKey }) : null;

export interface AnalyzeImageOptions {
  imageBase64: string;
  mimeType: string;
  userPrompt?: string;
  contextInfo?: string;
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

  const systemPrompt = buildSystemPrompt();
  const modelToUse = modelOverride || env.openrouterModel || 'openai/gpt-4o-mini';

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.openrouterApiKey}`,
      'HTTP-Referer': 'https://t.me/Elite_Force_Support_Bot',
      'X-Title': "Celia System & Support Admin",
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
      temperature: 0.4,
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
  const replyText = data.choices?.[0]?.message?.content?.trim();
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

  const systemInstruction = buildSystemPrompt();
  const isThinkingModel =
    env.geminiModel.includes('2.5') || env.geminiModel.includes('thinking');

  const genConfig: Record<string, unknown> = {
    systemInstruction,
    temperature: 0.4,
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

  const replyText = response.text?.trim();
  if (!replyText) {
    throw new Error('Empty response from Gemini Vision API');
  }

  return replyText;
}

/**
 * Analyzes an image with multimodal AI support (Gemini & OpenRouter dual fallback).
 */
export async function analyzeImageWithAI(options: AnalyzeImageOptions): Promise<string> {
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
    try {
      const result = await tryVision(primary);
      logger.info('Primary vision provider succeeded', { provider: primary });
      return result;
    } catch (primaryErr) {
      logger.warn(`Primary vision provider (${primary}) failed, falling back to ${secondary}`, {
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
      const result = await tryVision(secondary);
      logger.info('Secondary vision provider succeeded', { provider: secondary });
      return result;
    }
  } catch (err) {
    logger.error('All vision providers failed for image analysis', err);
    throw new Error('Unable to analyze image at this time due to temporary AI vision unavailability.');
  }
}
