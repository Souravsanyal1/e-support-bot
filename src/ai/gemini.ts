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
 * Generates an AI community support response using OpenRouter (GPT-4o)
 * or Google Gemini with automatic cross-provider fallback.
 */
export async function generateSupportResponse(
  userId: number,
  userMessage: string
): Promise<string> {
  const sanitizedPrompt = userMessage.trim();
  if (!sanitizedPrompt) {
    return "Hey! 👋 I'm Elite Force AI. How can I help you today?";
  }

  // Retrieve in-memory conversation history for this user
  const history = conversationManager.getHistory(userId);
  let replyText = '';

  try {
    // Attempt OpenRouter if configured and set as preferred, with Gemini fallback
    if (env.openrouterApiKey && (env.aiProvider === 'openrouter' || !ai)) {
      try {
        replyText = await callOpenRouter(sanitizedPrompt, history);
      } catch (openRouterError) {
        logger.warn('OpenRouter failed, falling back to Gemini if available', {
          error:
            openRouterError instanceof Error
              ? openRouterError.message
              : String(openRouterError),
        });

        if (ai) {
          replyText = await callGemini(sanitizedPrompt, history);
        } else {
          throw openRouterError;
        }
      }
    } else if (ai) {
      // Gemini preferred with OpenRouter fallback
      try {
        replyText = await callGemini(sanitizedPrompt, history);
      } catch (geminiError) {
        logger.warn('Gemini failed, falling back to OpenRouter if available', {
          error:
            geminiError instanceof Error ? geminiError.message : String(geminiError),
        });

        if (env.openrouterApiKey) {
          replyText = await callOpenRouter(sanitizedPrompt, history);
        } else {
          throw geminiError;
        }
      }
    } else {
      throw new Error('No AI provider credentials (OpenRouter or Gemini) configured.');
    }

    // Persist this turn into the user's sliding conversation window
    conversationManager.addMessage(userId, 'user', sanitizedPrompt);
    conversationManager.addMessage(userId, 'model', replyText);

    return replyText;
  } catch (error) {
    // Log the error securely (logger redacts all keys and secrets)
    logger.error('All AI providers failed to generate content', error, {
      userId,
      provider: env.aiProvider,
    });

    // Return a safe, sanitized, user-friendly response - never leak system traces
    return (
      "I'm temporarily experiencing a connection delay while consulting my knowledge base. " +
      "Please give me a moment and ask your question again!"
    );
  }
}
