import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { buildSystemPrompt } from './systemPrompt';
import { conversationManager } from './conversation';

// Initialize the official Google Gen AI client with the validated environment key
const ai = new GoogleGenAI({
  apiKey: env.geminiApiKey,
});

/**
 * Generates an AI community support response using the official @google/genai SDK.
 * Includes conversation context, exponential retry handling, and safe error boundaries.
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

  // Format history and current message for Gemini API
  const contents = [
    ...history.map((msg) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text }],
    })),
    {
      role: 'user',
      parts: [{ text: sanitizedPrompt }],
    },
  ];

  const systemInstruction = buildSystemPrompt();

  try {
    const response = await withRetry(
      async () => {
        return await ai.models.generateContent({
          model: env.geminiModel,
          contents,
          config: {
            systemInstruction,
            temperature: 0.6,
            maxOutputTokens: 800,
          },
        });
      },
      {
        maxRetries: 3,
        initialDelayMs: 1200,
        operationName: 'Gemini GenerateContent',
      }
    );

    const replyText = response.text?.trim();

    if (!replyText) {
      return (
        "I'm here to assist with Elite Force community support, but I couldn't generate a complete answer just now. " +
        "Could you please rephrase or ask your question again?"
      );
    }

    // Persist this turn into the user's sliding conversation window
    conversationManager.addMessage(userId, 'user', sanitizedPrompt);
    conversationManager.addMessage(userId, 'model', replyText);

    return replyText;
  } catch (error) {
    // Log the error securely (logger redacts all keys and secrets)
    logger.error('Gemini API call failed after retries', error, {
      userId,
      model: env.geminiModel,
    });

    // Return a safe, sanitized, user-friendly response - never leak system traces
    return (
      "I'm temporarily experiencing a connection delay while checking my knowledge base. " +
      "Please give me a moment and ask your question again!"
    );
  }
}
