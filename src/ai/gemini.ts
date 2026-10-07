import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { buildSystemPrompt } from './systemPrompt';
import { conversationManager } from './conversation';
import { ELITE_FORCE_KNOWLEDGE } from '../config/knowledge.config';

// Initialize the optional Google Gen AI client if key is present
const ai = env.geminiApiKey ? new GoogleGenAI({ apiKey: env.geminiApiKey }) : null;

/**
 * Emergency static knowledge fallback when both AI APIs are unavailable or exhausted.
 * Ensures the bot NEVER sends a generic connection error message.
 */
function getEmergencyKnowledgeResponse(userMessage: string): string {
  const query = userMessage.toLowerCase().trim();

  if (
    query.includes('contract') ||
    query.includes('address') ||
    query.includes('ca') ||
    query.includes('bsc') ||
    query.includes('token')
  ) {
    return (
      `Here is the official **${ELITE_FORCE_KNOWLEDGE.nativeToken.symbol}** token information:\n\n` +
      `• **Token Name:** ${ELITE_FORCE_KNOWLEDGE.nativeToken.name}\n` +
      `• **Symbol:** ${ELITE_FORCE_KNOWLEDGE.nativeToken.symbol}\n` +
      `• **Standard:** ${ELITE_FORCE_KNOWLEDGE.nativeToken.standard}\n` +
      `• **Status:** ${ELITE_FORCE_KNOWLEDGE.nativeToken.status}\n\n` +
      `Contract address and launch details will be revealed exclusively on ${ELITE_FORCE_KNOWLEDGE.officialChannels.telegramChannel}. Beware of scams! 🧡`
    );
  }

  if (
    query.includes('founder') ||
    query.includes('ceo') ||
    query.includes('creator') ||
    query.includes('dev') ||
    query.includes('admin') ||
    query.includes('team')
  ) {
    return (
      `**Elite Force Leadership Team:**\n\n` +
      `• **Founder & CEO:** Prince Sourav (@princesourav80)\n` +
      `• **Co-Founder:** Krit (@kirit_1)\n\n` +
      `For official announcements, follow: ${ELITE_FORCE_KNOWLEDGE.officialChannels.telegramChannel}`
    );
  }

  if (
    query.includes('channel') ||
    query.includes('link') ||
    query.includes('group') ||
    query.includes('website') ||
    query.includes('social')
  ) {
    return (
      `Official **Elite Force** Links:\n\n` +
      `• 📢 **Channel:** ${ELITE_FORCE_KNOWLEDGE.officialChannels.telegramChannel}\n` +
      `• 🐦 **X (Twitter):** ${ELITE_FORCE_KNOWLEDGE.officialChannels.xProfile}\n\n` +
      `Stay connected with our official channels! 🚀`
    );
  }

  if (
    query.includes('hi') ||
    query.includes('hello') ||
    query.includes('hey') ||
    query.includes('start')
  ) {
    return `Hey! 👋 I'm Elite Force AI. I'm here to assist you with questions about Elite Force (E-FORCE), our Web3 ecosystem, BNB Chain token, and community updates. How can I help you today?`;
  }

  return (
    `**Elite Force** is a decentralized Web3 community and reward ecosystem built on the **BNB Smart Chain** centered around its native utility token **E-FORCE**.\n\n` +
    `• **Official Tagline:** *Building Beyond Limits*\n` +
    `• **Official Channel:** ${ELITE_FORCE_KNOWLEDGE.officialChannels.telegramChannel}\n` +
    `• **Official X:** ${ELITE_FORCE_KNOWLEDGE.officialChannels.xProfile}\n\n` +
    `Feel free to ask any questions about our token, vision, or community! 🧡🚀`
  );
}

/**
 * Calls OpenRouter chat completion with auto-fallback to gpt-4o-mini if credits or model limits hit.
 */
async function callOpenRouter(
  userPrompt: string,
  history: Array<{ role: 'user' | 'model'; text: string }>,
  modelOverride?: string
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

  const modelToUse = modelOverride || env.openrouterModel || 'openai/gpt-4o-mini';

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.openrouterApiKey}`,
      'HTTP-Referer': 'https://t.me/Elite_Force_Support_Bot',
      'X-Title': 'Elite Force AI',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelToUse,
      messages,
      temperature: 0.5,
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    // If the chosen model failed due to credit limits or not found, auto-try openai/gpt-4o-mini
    if (modelToUse !== 'openai/gpt-4o-mini') {
      logger.warn(`OpenRouter model ${modelToUse} returned ${res.status}, automatically falling back to openai/gpt-4o-mini`);
      return callOpenRouter(userPrompt, history, 'openai/gpt-4o-mini');
    }
    throw new Error(
      `OpenRouter API error (${res.status}): ${JSON.stringify(errorData)}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const replyText = data.choices?.[0]?.message?.content?.trim();
  if (!replyText) {
    throw new Error('Empty response from OpenRouter API');
  }

  return replyText;
}

/**
 * Calls Google Gemini generateContent with 15s timeout protection.
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

  const timeoutPromise = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new Error('Gemini API timed out after 15 seconds')), 15000);
    if (t.unref) t.unref();
  });

  const response = await Promise.race([
    ai.models.generateContent({
      model: env.geminiModel,
      contents,
      config: {
        systemInstruction,
        temperature: 0.5,
        maxOutputTokens: 350,
      },
    }),
    timeoutPromise,
  ]);

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
  const hour = new Date().getHours();
  return hour < 12 ? 'gemini' : 'openrouter';
}

/**
 * Generates an AI community support response using a time-based provider schedule.
 *
 * Primary schedule:
 *   00:00 – 11:59  →  Google Gemini
 *   12:00 – 23:59  →  OpenRouter (GPT-4o-mini)
 *
 * If primary provider fails, secondary provider is tried automatically.
 * If all AI APIs are unavailable, emergency knowledge fallback guarantees a helpful answer.
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
    logger.error('All AI providers failed, using emergency knowledge fallback', error, { userId });
    const fallbackAnswer = getEmergencyKnowledgeResponse(sanitizedPrompt);
    conversationManager.addMessage(userId, 'user', sanitizedPrompt);
    conversationManager.addMessage(userId, 'model', fallbackAnswer);
    return fallbackAnswer;
  }
}
