import { Context } from 'grammy';
import { generateSupportResponse } from '../ai/gemini';
import { BOT_CONFIG, PUBLIC_COMMANDS } from '../config/bot.config';
import {
  safeReply,
  sendTypingAction,
  sendLoadingSticker,
  deleteLoadingSticker,
  sleep,
} from '../utils/telegram';
import { logger } from '../utils/logger';
import {
  getRelevantOfficialChannelContext,
  getLaunchAnnouncementForQuestion,
  observeOfficialChannelPost,
} from '../ai/officialChannelKnowledge';

/**
 * Handles the /start command.
 */
export async function handleStartCommand(ctx: Context): Promise<void> {
  const message = [
    `*Welcome to ${BOT_CONFIG.name}* 👋`,
    `Ask me about Elite Force, E-FORCE, and official updates.`,
    `No sign-up is needed; chat history is not saved.`,
    '',
    `🌐 *Website:* https://elite-force.space`,
    `⏱️ *Timer:* https://timer.elite-force.space`,
    `📢 *Telegram:* https://t.me/Elite_Force_Official`,
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
    `You can chat directly! Simply send any question, and I'll respond in clear, natural English.`,
    '',
    `*Official Channels:*`,
    `• Telegram: https://t.me/Elite_Force_Official`,
    `• X (Twitter): https://x.com/EliteForceOFC`,
    '',
    `*Important Rules:*`,
    `• E-FORCE launch and listing dates are in development and will only be shared via official channels.`,
    `• No price speculation, financial advice, or profit guarantees are provided.`,
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
    `*Ecosystem:* Elite Force`,
    `*Native Token:* E-FORCE (BEP-20 / BNB Smart Chain)`,
    `*Utility:* Decentralized ecosystem utility & community governance`,
    `*Status:* In active development`,
    '',
    `*Official Verified Channels:*`,
    `• Telegram: https://t.me/Elite_Force_Official`,
    `• X (Twitter): https://x.com/EliteForceOFC`,
    '',
    `*Privacy & Security:*`,
    `• No sign-up, email, or phone number is needed to use the bot.`,
    `• The bot does not save chat messages, chat history, or regular users' Telegram IDs.`,
    `• Admin Telegram IDs may be kept in private server settings only to protect admin commands.`,
    `• Telegram provides sender information to bots. A short-lived, one-way anti-spam key stays in memory and expires automatically.`,
    `• Message text is sent to the configured AI provider only to generate a reply; it is not added to training data.`,
    `• We never ask for seed phrases, private keys, or passwords.`,
    `• Technical infrastructure and personal team data remain strictly confidential.`,
  ].join('\n');

  await safeReply(ctx, message);
}

/**
 * Handles the /ask command (e.g., /ask What is Elite Force?).
 */
export async function handleAskCommand(ctx: Context): Promise<void> {
  if (!ctx.from && !ctx.message?.sender_chat) return;

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
  const startTime = Date.now();
  const loadingStickerId = await sendLoadingSticker(ctx);

  try {
    const response = await generateSupportResponse(
      query,
      getLaunchAnnouncementForQuestion(query),
      getRelevantOfficialChannelContext(query)
    );

    // Ensure the animated sticker is visible for at least 3000ms before deletion
    const elapsed = Date.now() - startTime;
    const minDisplayMs = 3000;
    if (elapsed < minDisplayMs) {
      await sleep(minDisplayMs - elapsed);
    }

    await deleteLoadingSticker(ctx, loadingStickerId);
    await safeReply(ctx, response, { replyToMessage: true });
  } catch (error) {
    await deleteLoadingSticker(ctx, loadingStickerId);
    logger.error('Error handling /ask command', error);
    await safeReply(
      ctx,
      "I'm temporarily experiencing an issue generating an answer. Please try again in a moment."
    );
  }
}

/**
 * Silently observes channel posts for launch announcements. Channel posts are
 * never answered, regardless of their contents or commands.
 */
export async function handleChannelPost(ctx: Context): Promise<void> {
  observeOfficialChannelPost(ctx);
}

/**
 * Legacy selective trigger predicate retained for compatibility. The normal
 * text handler no longer uses this gate and responds to all group text messages.
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
 * Works in private DMs and responds to every text message in community groups.
 */
export async function handleTextMessage(ctx: Context): Promise<void> {
  const text = ctx.message?.text?.trim();

  if ((!ctx.from && !ctx.message?.sender_chat) || !text) return;

  // Ignore commands that might have bypassed command routing
  if (text.startsWith('/')) {
    return;
  }

  // Clean prompt by removing bot mention tags
  const botUsername = ctx.me?.username || 'Elite_Force_Support_Bot';
  const cleanedText = text
    .replace(new RegExp(`@${botUsername}`, 'gi'), '')
    .replace(/@elite_force_support_bot/gi, '')
    .trim();

  const queryToProcess = cleanedText || text;

  await sendTypingAction(ctx);
  const startTime = Date.now();
  const loadingStickerId = await sendLoadingSticker(ctx);

  try {
    const response = await generateSupportResponse(
      queryToProcess,
      getLaunchAnnouncementForQuestion(queryToProcess),
      getRelevantOfficialChannelContext(queryToProcess)
    );

    // Ensure the animated sticker is visible for at least 3000ms so user clearly sees the animation
    const elapsed = Date.now() - startTime;
    const minDisplayMs = 3000;
    if (elapsed < minDisplayMs) {
      await sleep(minDisplayMs - elapsed);
    }

    await deleteLoadingSticker(ctx, loadingStickerId);
    await safeReply(ctx, response, { replyToMessage: true });
  } catch (error) {
    await deleteLoadingSticker(ctx, loadingStickerId);
    logger.error('Error handling direct text message', error);
    await safeReply(
      ctx,
      "I'm having temporary trouble reaching my AI engine. Please ask your question again shortly.",
      { replyToMessage: true }
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
      `*Official Channels:*`,
      `📢 *Telegram:* https://t.me/Elite_Force_Official`,
      `🐦 *Official X:* https://x.com/EliteForceOFC`,
      '',
      `🛡️ *Safety Reminder:* Official admins will *never* DM you first or ask for private keys/seed phrases.`,
    ].join('\n');

    await safeReply(ctx, welcome);
  }
}
