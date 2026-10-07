import { Context } from 'grammy';
import { generateSupportResponse } from '../ai/gemini';
import { BOT_CONFIG, PUBLIC_COMMANDS } from '../config/bot.config';
import { safeReply, sendTypingAction } from '../utils/telegram';
import { logger } from '../utils/logger';

/**
 * Handles the /start command.
 */
export async function handleStartCommand(ctx: Context): Promise<void> {
  const firstName = ctx.from?.first_name ? ` ${ctx.from.first_name}` : '';
  const message = [
    `*Hey${firstName}! Welcome to ${BOT_CONFIG.name}* 👋`,
    '',
    `I am your official AI-powered community support assistant for the *Elite Force* ecosystem.`,
    '',
    `*What I can do for you:*`,
    `• Answer questions about the Elite Force ecosystem`,
    `• Guide you toward official verified information & channels`,
    `• Help in *English*, *Bengali (বাংলা)*, or *Banglish*`,
    '',
    `*Quick Ways to Interact:*`,
    `• Simply send any message or question directly in this chat`,
    `• Use \`/ask <question>\` to ask a specific question`,
    `• Type \`/help\` to see all commands and helpful tips`,
    `• Type \`/about\` to learn about our mission and security guidelines`,
    '',
    `🛡️ *Safety Reminder:* Official Elite Force team members will *never* DM you first asking for funds, private keys, or seed phrases.`,
  ].join('\n');

  await safeReply(ctx, message);
}

/**
 * Handles the /help command.
 */
export async function handleHelpCommand(ctx: Context): Promise<void> {
  const commandList = PUBLIC_COMMANDS.map((cmd) => `• \`/${cmd.command}\` — ${cmd.description}`).join(
    '\n'
  );

  const message = [
    `*${BOT_CONFIG.name} — Help & Commands Guide* 💡`,
    '',
    `*Available Commands:*`,
    commandList,
    '',
    `*Direct Chat:*`,
    `You don't need commands to talk to me! Just send any text message, and I'll reply naturally.`,
    '',
    `*Multilingual Support:*`,
    `• *English*: Ask anything in English.`,
    `• *বাংলা*: বাংলায় সরাসরি প্রশ্ন করতে পারেন।`,
    `• *Banglish*: "Elite Force ki?", "kivabe join korbo?" — feel free to ask in conversational Banglish!`,
    '',
    `*Rules & Boundaries:*`,
    `• I do not provide financial advice, price speculation, or profit guarantees.`,
    `• For sensitive matters or token contracts, always verify via official pinned announcements.`,
  ].join('\n');

  await safeReply(ctx, message);
}

/**
 * Handles the /about command.
 */
export async function handleAboutCommand(ctx: Context): Promise<void> {
  const message = [
    `*About ${BOT_CONFIG.name}* 🛡️`,
    '',
    `*Ecosystem*: Elite Force`,
    `*Role*: AI Community Support Assistant`,
    `*Version*: ${BOT_CONFIG.version}`,
    '',
    `*Our Mission:*`,
    `To provide friendly, fast, and accurate guidance for community members exploring the Elite Force ecosystem, while safeguarding users against misinformation and scams.`,
    '',
    `*Privacy & Security:*`,
    `• We do *not* collect or store your personal identity, IP address, phone number, or credentials.`,
    `• Conversation history is held strictly in temporary in-memory sessions for dialogue continuity.`,
    `• We never ask for seed phrases, private keys, or passwords.`,
    '',
    `*Compliance Note:*`,
    `Elite Force AI answers based on verified official materials. Speculation is not presented as fact, and no financial promises are ever made.`,
  ].join('\n');

  await safeReply(ctx, message);
}

/**
 * Handles the /ask command (e.g., /ask What is Elite Force?).
 */
export async function handleAskCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const rawText = ctx.message?.text || '';
  // Strip the '/ask' prefix
  const query = rawText.replace(/^\/ask(@\w+)?/i, '').trim();

  if (!query) {
    await safeReply(
      ctx,
      `Please provide a question after the command, for example:\n\`/ask What is Elite Force?\`\n\nOr you can simply send your question directly!`
    );
    return;
  }

  await sendTypingAction(ctx);

  try {
    const response = await generateSupportResponse(userId, query);
    await safeReply(ctx, response, { replyToMessage: true });
  } catch (error) {
    logger.error('Error handling /ask command', error, { userId });
    await safeReply(
      ctx,
      "I'm temporarily experiencing an issue generating an answer. Please try again in a moment."
    );
  }
}

/**
 * Handles standard incoming text messages (natural conversation).
 */
export async function handleTextMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const text = ctx.message?.text?.trim();

  if (!userId || !text) return;

  // Ignore commands that might have bypassed command routing
  if (text.startsWith('/')) {
    return;
  }

  // Fast path for simple greetings to provide instant natural response
  const lower = text.toLowerCase().replace(/[^\w\s]/g, '').trim();
  if (lower === 'hello' || lower === 'hi' || lower === 'hey') {
    await safeReply(ctx, "Hey! 👋 I'm Elite Force AI. How can I help you today?");
    return;
  }

  await sendTypingAction(ctx);

  try {
    const response = await generateSupportResponse(userId, text);
    await safeReply(ctx, response);
  } catch (error) {
    logger.error('Error handling direct text message', error, { userId });
    await safeReply(
      ctx,
      "I'm having temporary trouble reaching my AI engine. Please ask your question again shortly."
    );
  }
}
