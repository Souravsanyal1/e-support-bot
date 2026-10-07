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
 * Determines whether the bot should respond to a message in a group or supergroup.
 * Prevents spamming unrelated group discussions.
 */
export function shouldRespondInGroup(ctx: Context, text: string): boolean {
  const chatType = ctx.chat?.type;
  // In private DMs, always respond
  if (chatType === 'private') {
    return true;
  }

  // In groups or supergroups:
  const botUsername = ctx.me?.username ? ctx.me.username.toLowerCase() : 'elite_force_support_bot';
  const lowerText = text.toLowerCase();

  // 1. Tagged with bot username (e.g. @Elite_Force_Support_Bot)
  if (lowerText.includes(`@${botUsername}`) || lowerText.includes('@elite_force_support_bot')) {
    return true;
  }

  // 2. Direct reply to one of the bot's messages
  if (ctx.message?.reply_to_message?.from?.id && ctx.me?.id) {
    if (ctx.message.reply_to_message.from.id === ctx.me.id) {
      return true;
    }
  }

  // 3. Questions / messages mentioning "elite force" or "eliteforce" or "elite-force"
  if (
    lowerText.includes('elite force') ||
    lowerText.includes('eliteforce') ||
    lowerText.includes('elite-force')
  ) {
    return true;
  }

  return false;
}

/**
 * Handles standard incoming text messages (natural conversation).
 * Works seamlessly in private DMs and selectively in community groups.
 */
export async function handleTextMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const text = ctx.message?.text?.trim();

  if (!userId || !text) return;

  // Ignore commands that might have bypassed command routing
  if (text.startsWith('/')) {
    return;
  }

  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

  // In groups, ignore unrelated banter between members
  if (isGroup && !shouldRespondInGroup(ctx, text)) {
    return;
  }

  // Clean prompt by removing bot mention tags
  const botUsername = ctx.me?.username || 'Elite_Force_Support_Bot';
  const cleanedText = text
    .replace(new RegExp(`@${botUsername}`, 'gi'), '')
    .replace(/@elite_force_support_bot/gi, '')
    .trim();

  const queryToProcess = cleanedText || text;

  // Fast path for simple greetings to provide instant natural response
  const lower = queryToProcess.toLowerCase().replace(/[^\w\s]/g, '').trim();
  if (lower === 'hello' || lower === 'hi' || lower === 'hey') {
    await safeReply(ctx, "Hey! 👋 I'm Elite Force AI. How can I help you today?", {
      replyToMessage: isGroup,
    });
    return;
  }

  await sendTypingAction(ctx);

  try {
    const response = await generateSupportResponse(userId, queryToProcess);
    await safeReply(ctx, response, { replyToMessage: isGroup });
  } catch (error) {
    logger.error('Error handling direct text message', error, { userId });
    await safeReply(
      ctx,
      "I'm having temporary trouble reaching my AI engine. Please ask your question again shortly.",
      { replyToMessage: isGroup }
    );
  }
}

/**
 * Welcomes the community when the bot is added to a group or supergroup.
 */
export async function handleNewChatMembers(ctx: Context): Promise<void> {
  const newMembers = ctx.message?.new_chat_members || [];
  const botId = ctx.me?.id;

  // Check if our bot was added
  const isBotAdded = newMembers.some((member) => member.id === botId);

  if (isBotAdded) {
    const username = ctx.me?.username || 'Elite_Force_Support_Bot';
    const welcome = [
      `👋 *Hello everyone! I am ${BOT_CONFIG.name}.*`,
      '',
      `I am the official AI community support assistant for the *Elite Force* ecosystem.`,
      '',
      `*How to interact with me in this group:*`,
      `• Tag me: @${username} <your question>`,
      `• Reply directly to any of my messages`,
      `• Ask any question mentioning *Elite Force*`,
      `• Use \`/ask <question>\` or \`/help\``,
      '',
      `🛡️ *Safety Reminder:* Official admins will *never* DM you first or ask for private keys/seed phrases.`,
    ].join('\n');

    await safeReply(ctx, welcome);
  }
}
