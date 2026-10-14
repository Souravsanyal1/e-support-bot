import { Context } from 'grammy';
import { generateSupportResponse } from '../ai/gemini';
import { analyzeImageWithAI } from '../ai/vision';
import { BOT_CONFIG, PUBLIC_COMMANDS } from '../config/bot.config';
import { env } from '../config/env.config';
import { botStateManager } from '../bot/state';
import { isAdmin } from '../middleware/adminAuth';
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
import { checkMessageLanguage } from '../utils/languageDetector';
import { checkBadWords } from '../utils/badWordsDetector';

const OFFICIAL_CHANNEL_ID = '@Elite_Force_Official';
const ADMIN_LIST_QUERY = /\b(admins?|administrators?|moderators?)\b/i;

function isAdminListQuery(text: string): boolean {
  return ADMIN_LIST_QUERY.test(text) && /\b(who|list|names?|new|added|show|tell|channel|group)\b/i.test(text);
}

async function getOfficialChannelAdmins(ctx: Context): Promise<string> {
  try {
    const admins = await ctx.api.getChatAdministrators(OFFICIAL_CHANNEL_ID);
    const humanAdmins = admins
      .filter((admin) => !admin.user.is_bot)
      .map((admin) => {
        const name = [admin.user.first_name, admin.user.last_name].filter(Boolean).join(' ').trim();
        return admin.user.username ? `${name || 'Admin'} (@${admin.user.username})` : name || 'Admin';
      });
    const uniqueAdmins = [...new Set(humanAdmins)];

    return uniqueAdmins.length
      ? `Current human administrators of the official Elite Force Telegram channel (verified live from Telegram):\n${uniqueAdmins.map((name) => `• ${name}`).join('\n')}\n\nThis list excludes bots and reflects administrators currently listed by Telegram.`
      : 'Telegram currently returned no human administrators for the official channel.';
  } catch {
    return `I can't retrieve the official channel's administrator list right now. Please check directly at https://t.me/Elite_Force_Official; I won't guess or identify any bot as an admin.`;
  }
}

/**
 * Handles the /start command.
 */
export async function handleStartCommand(ctx: Context): Promise<void> {
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  const message = [
    `*${BOT_CONFIG.introduction}* 👋`,
    `Ask me about Elite Force, E-FORCE, and official updates.`,
    `No sign-up is needed; chat history is not saved.`,
    '',
    `🌐 [Website](https://elite-force.space) • ⏱️ [Timer](https://timer.elite-force.space) • 📢 [Telegram](https://t.me/Elite_Force_Official)`,
  ].join('\n');

  await safeReply(ctx, message);
}

/**
 * Handles the /help command.
 */
export async function handleHelpCommand(ctx: Context): Promise<void> {
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  const commandList = PUBLIC_COMMANDS.map((cmd) => `• \`/${cmd.command}\` — ${cmd.description}`).join(
    '\n'
  );

  const message = [
    `*${BOT_CONFIG.name} — Help & Commands Guide* 💡`,
    '',
    `*Available Commands:*`,
    commandList,
    '',
    `*Direct Chat & Image Support:*`,
    `You can chat directly or send photos/screenshots with questions! I will analyze them and reply in clear English.`,
    '',
    `*Official Channels:*`,
    `📢 [Telegram](https://t.me/Elite_Force_Official) • 🐦 [X (Twitter)](https://x.com/EliteForceOFC)`,
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
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  const message = [
    `*About ${BOT_CONFIG.name}* 🛡️`,
    '',
    `*Ecosystem:* Elite Force`,
    `*Native Token:* E-FORCE (BEP-20 / BNB Smart Chain)`,
    `*Utility:* Decentralized ecosystem utility & community governance`,
    `*Status:* In active development`,
    '',
    `*Official Verified Channels:*`,
    `📢 [Telegram](https://t.me/Elite_Force_Official) • 🐦 [X (Twitter)](https://x.com/EliteForceOFC)`,
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
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  if (!ctx.from && !ctx.message?.sender_chat) return;

  const rawText = ctx.message?.text || '';
  // Strip the '/ask' prefix
  const query = rawText.replace(/^\/ask(@\w+)?/i, '').trim();

  if (!query) {
    await safeReply(
      ctx,
      `Please provide a question after the command, for example:\n\`/ask What is Elite Force?\`\n\nOr you can simply send your question or image directly!`
    );
    return;
  }

  if (isAdminListQuery(query)) {
    await safeReply(ctx, await getOfficialChannelAdmins(ctx));
    return;
  }

  // Reject and remove non-English / Bangla / Banglish queries without replying
  const langCheck = checkMessageLanguage(query);
  if (!langCheck.isEnglish) {
    if (ctx.chat?.type !== 'private') {
      try {
        await ctx.deleteMessage();
      } catch {
        // Ignore
      }
    }
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
 * Legacy selective trigger predicate retained for compatibility.
 */
export function shouldRespondInGroup(ctx: Context, text: string): boolean {
  const chatType = ctx.chat?.type;
  if (chatType === 'private') {
    return true;
  }

  const botUsername = ctx.me?.username ? ctx.me.username.toLowerCase() : 'elite_force_support_bot';
  const lowerText = text.toLowerCase();

  if (lowerText.includes(`@${botUsername}`) || lowerText.includes('@elite_force_support_bot')) {
    return true;
  }

  if (ctx.message?.reply_to_message?.from?.id && ctx.me?.id) {
    if (ctx.message.reply_to_message.from.id === ctx.me.id) {
      return true;
    }
  }

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
 */
export async function handleTextMessage(ctx: Context): Promise<void> {
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

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

  if (isAdminListQuery(queryToProcess)) {
    await safeReply(ctx, await getOfficialChannelAdmins(ctx), { replyToMessage: true });
    return;
  }

  // Reject and remove non-English / Bangla / Banglish queries without replying
  const langCheck = checkMessageLanguage(queryToProcess);
  if (!langCheck.isEnglish) {
    if (ctx.chat?.type !== 'private') {
      try {
        await ctx.deleteMessage();
      } catch {
        // Ignore
      }
    }
    return;
  }

  await sendTypingAction(ctx);
  const startTime = Date.now();
  const loadingStickerId = await sendLoadingSticker(ctx);

  try {
    const response = await generateSupportResponse(
      queryToProcess,
      getLaunchAnnouncementForQuestion(queryToProcess),
      getRelevantOfficialChannelContext(queryToProcess)
    );

    // Ensure the animated sticker is visible for at least 3000ms
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
 * Handles user-submitted photos and screenshots using multimodal AI vision.
 */
export async function handlePhotoMessage(ctx: Context): Promise<void> {
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

  const caption = ctx.message?.caption?.trim();

  // If caption has non-English text or bad words, enforce community guidelines
  if (caption) {
    const badCheck = checkBadWords(caption);
    if (badCheck.hasBadWords) {
      if (ctx.chat?.type !== 'private') {
        try {
          await ctx.deleteMessage();
        } catch {
          // Ignore
        }
      }
      return;
    }

    const langCheck = checkMessageLanguage(caption);
    if (!langCheck.isEnglish) {
      if (ctx.chat?.type !== 'private') {
        try {
          await ctx.deleteMessage();
        } catch {
          // Ignore
        }
      }
      return;
    }
  }

  // Select the highest resolution photo
  const bestPhoto = photos[photos.length - 1];

  // Safeguard: File size limit (10MB)
  if (bestPhoto.file_size && bestPhoto.file_size > 10 * 1024 * 1024) {
    await safeReply(
      ctx,
      '⚠️ The sent image is too large. Please upload an image smaller than 10 MB.',
      { replyToMessage: true }
    );
    return;
  }

  await sendTypingAction(ctx);
  const startTime = Date.now();
  const loadingStickerId = await sendLoadingSticker(ctx);

  try {
    // Retrieve file metadata from Telegram Bot API
    const fileInfo = await ctx.api.getFile(bestPhoto.file_id);
    if (!fileInfo.file_path) {
      throw new Error('Telegram Bot API did not return a valid file_path');
    }

    // Determine MIME type from file extension
    const filePath = fileInfo.file_path.toLowerCase();
    let mimeType = 'image/jpeg';
    if (filePath.endsWith('.png')) {
      mimeType = 'image/png';
    } else if (filePath.endsWith('.webp')) {
      mimeType = 'image/webp';
    }

    // Download image buffer securely using internal token
    const fileUrl = `https://api.telegram.org/file/bot${env.telegramBotToken}/${fileInfo.file_path}`;
    const fileRes = await fetch(fileUrl, { signal: AbortSignal.timeout(15000) });

    if (!fileRes.ok) {
      throw new Error(`Failed to download image from Telegram file server (status ${fileRes.status})`);
    }

    const arrayBuf = await fileRes.arrayBuffer();
    const imageBase64 = Buffer.from(arrayBuf).toString('base64');

    // Contextual knowledge from official channel
    const contextInfo = caption
      ? getRelevantOfficialChannelContext(caption) || undefined
      : undefined;

    // Analyze with vision model
    const analysisResponse = await analyzeImageWithAI({
      imageBase64,
      mimeType,
      userPrompt: caption,
      contextInfo,
    });

    // Ensure the animated loading sticker is visible for at least 3000ms
    const elapsed = Date.now() - startTime;
    const minDisplayMs = 3000;
    if (elapsed < minDisplayMs) {
      await sleep(minDisplayMs - elapsed);
    }

    await deleteLoadingSticker(ctx, loadingStickerId);
    await safeReply(ctx, analysisResponse, { replyToMessage: true });
  } catch (error) {
    await deleteLoadingSticker(ctx, loadingStickerId);
    logger.error('Error handling photo message', error);
    await safeReply(
      ctx,
      "I'm temporarily experiencing an issue analyzing this image. Please ensure the image is clear and try again in a few moments.",
      { replyToMessage: true }
    );
  }
}

/**
 * Welcomes the community when the bot is added to a group or supergroup.
 */
export async function handleNewChatMembers(ctx: Context): Promise<void> {
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  const newMembers = ctx.message?.new_chat_members || [];
  const botId = ctx.me?.id;

  const isBotAdded = newMembers.some((member) => member.id === botId);

  if (isBotAdded) {
    const username = ctx.me?.username || 'Elite_Force_Support_Bot';
    const welcome = [
      `👋 *${BOT_CONFIG.introduction}*`,
      '',
      `I’m here to help manage the group and answer questions about the *Elite Force* ecosystem.`,
      '',
      `*How to interact with me in this group:*`,
      `• Tag me: @${username} <your question>`,
      `• Send an image/screenshot with a question`,
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
