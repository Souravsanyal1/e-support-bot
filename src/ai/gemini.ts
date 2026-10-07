import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { buildSystemPrompt } from './systemPrompt';
import { conversationManager } from './conversation';

// Initialize the optional Google Gen AI client if key is present
const ai = env.geminiApiKey ? new GoogleGenAI({ apiKey: env.geminiApiKey }) : null;

/**
 * Calls OpenRouter chat completion (e.g. openai/gpt-4o) with retry logic.
 */
async function callOpenRouter(
  userPrompt: string,
  history: Array<{ role: 'user' | 'model'; text: string }>
): Promise<string> {
  const systemPrompt = buildSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((msg) => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.text,
    })),
    { role: 'user', content: userPrompt },
  ];

  const response = await withRetry(
    async () => {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.openrouterApiKey}`,
          'HTTP-Referer': 'https://t.me/Elite_Force_Support_Bot',
          'X-Title': 'Elite Force AI',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.openrouterModel,
          messages,
          temperature: 0.5,
          max_tokens: 350,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          `OpenRouter API error (${res.status}): ${JSON.stringify(errorData)}`
        );
      }

      return (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
    },
    {
      maxRetries: 2,
      initialDelayMs: 1000,
      operationName: 'OpenRouter ChatCompletion',
    }
  );

  const replyText = response.choices?.[0]?.message?.content?.trim();
  if (!replyText) {
    throw new Error('Empty response from OpenRouter API');
  }

  return replyText;
}

/**
 * Calls Google Gemini generateContent with retry logic.
 */
async function callGemini(
  userPrompt: string,
  history: Array<{ role: 'user' | 'model'; text: string }>
): Promise<string> {
  if (!ai) {
    throw new Error('Gemini API client not initialized');
  }

  const systemInstruction = buildSystemPrompt();
  const contents = [
    ...history.map((msg) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text }],
    })),
    {
      role: 'user',
      parts: [{ text: userPrompt }],
    },
  ];

  const response = await withRetry(
    async () => {
      return await ai.models.generateContent({
        model: env.geminiModel,
        contents,
        config: {
          systemInstruction,
          temperature: 0.5,
          maxOutputTokens: 350,
        },
      });
    },
    {
      maxRetries: 2,
      initialDelayMs: 1200,
      operationName: 'Gemini GenerateContent',
    }
  );

  const replyText = response.text?.trim();
  if (!replyText) {
    throw new Error('Empty response from Gemini API');
  }

  return replyText;
}

/**
 * Returns which AI provider should be the PRIMARY based on current server hour.
 *
 * Schedule (UTC+6 Bangladesh Time):
 *   12:00 AM → 11:59 AM  →  Google Gemini  (hours 0–11)
 *   12:00 PM → 11:59 PM  →  OpenRouter     (hours 12–23)
 *
 * If the primary fails, the other provider is tried automatically as fallback.
 */
function getPrimaryProvider(): 'gemini' | 'openrouter' {
  const hour = new Date().getHours(); // local server hour (0–23)
  return hour < 12 ? 'gemini' : 'openrouter';
}

/**
 * Generates an AI community support response using a time-based provider schedule.
 *
 * Primary schedule:
 *   00:00 – 11:59  →  Google Gemini
 *   12:00 – 23:59  →  OpenRouter (GPT-4o)
 *
 * If the primary provider fails, the secondary is tried automatically.
 */
export async function generateSupportResponse(
  userId: number,
  userMessage: string
): Promise<string> {
  const sanitizedPrompt = userMessage.trim();
  if (!sanitizedPrompt) {
    return "Hey! 👋 I'm Elite Force AI. How can I help you today?";
  }

  const history = conversationManager.getHistory(userId);
  let replyText = '';

  const primary = getPrimaryProvider();
  const secondary = primary === 'gemini' ? 'openrouter' : 'gemini';

  logger.info('AI provider selected by schedule', {
    hour: new Date().getHours(),
    primary,
    secondary,
  });

  async function tryProvider(provider: 'gemini' | 'openrouter'): Promise<string> {
    if (provider === 'gemini') {
      if (!ai) throw new Error('Gemini client not initialized (no API key)');
      return await callGemini(sanitizedPrompt, history);
    } else {
      if (!env.openrouterApiKey) throw new Error('OpenRouter API key not configured');
      return await callOpenRouter(sanitizedPrompt, history);
    }
  }

  try {
    // Try the scheduled primary provider first
    try {
      replyText = await tryProvider(primary);
      logger.info('Primary AI provider responded successfully', { provider: primary });
    } catch (primaryError) {
      logger.warn(`Primary AI provider (${primary}) failed, switching to fallback (${secondary})`, {
        error: primaryError instanceof Error ? primaryError.message : String(primaryError),
      });

      // Automatic fallback to the other provider
      replyText = await tryProvider(secondary);
      logger.info('Fallback AI provider responded successfully', { provider: secondary });
    }

    // Persist this turn into the sliding conversation window
    conversationManager.addMessage(userId, 'user', sanitizedPrompt);
    conversationManager.addMessage(userId, 'model', replyText);

    return replyText;
  } catch (error) {
    logger.error('All AI providers failed to generate content', error, { userId });

    return (
      "I'm temporarily experiencing a connection delay while consulting my knowledge base. " +
      'Please give me a moment and ask your question again!'
    );
  }
}

