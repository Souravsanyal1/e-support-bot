import { Context } from 'grammy';
import { generateSupportResponse } from '../ai/gemini';
import { analyzeImageWithAI } from '../ai/vision';
import {
  moderateImage,
  isOpenAIModerationAvailable,
  isMessageAlreadyProcessed,
  markMessageAsProcessed,
  shouldModerateChat,
} from '../ai/moderation';
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

export const VERIFIED_OFFICIAL_ADMINS = [
  '• Elite Force | Support (@EliteForceSupportTeam)',
  '• 𝓓𝓮𝓕𝓲 𝓖𝓮𝓷𝓮𝓻𝓪𝓽𝓸𝓻 (@cripto_currency_bro)',
];

export const VERIFIED_OFFICIAL_ADMINS_TEXT = [
  'Current human administrators of the official Elite Force Telegram channel (verified live from Telegram):',
  ...VERIFIED_OFFICIAL_ADMINS,
  '',
  'This list excludes bots and reflects administrators currently listed by Telegram.',
].join('\n');

export function isAdminListQuery(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const hasAdmin = ADMIN_LIST_QUERY.test(lower);
  const hasInquiry = /\b(who|list|names?|new|added|show|tell|channel|group|official)\b/i.test(lower);
  return hasAdmin && (hasInquiry || lower === 'admin' || lower === 'admins');
}

export async function getOfficialChannelAdmins(ctx: Context): Promise<string> {
  try {
    const admins = await ctx.api.getChatAdministrators(OFFICIAL_CHANNEL_ID);
    const humanAdmins = admins
      .filter((admin) => !admin.user.is_bot)
      .map((admin) => {
        const name = [admin.user.first_name, admin.user.last_name].filter(Boolean).join(' ').trim();
        return admin.user.username ? `${name || 'Admin'} (@${admin.user.username})` : name || 'Admin';
      });
    const uniqueAdmins = [...new Set(humanAdmins)];

    // Strictly enforce: never display Owner ID or numeric user IDs.
    if (uniqueAdmins.length > 0) {
      return [
        'Current human administrators of the official Elite Force Telegram channel (verified live from Telegram):',
        ...uniqueAdmins.map((name) => `• ${name}`),
        '',
        'This list excludes bots and reflects administrators currently listed by Telegram.',
      ].join('\n');
    }
    return VERIFIED_OFFICIAL_ADMINS_TEXT;
  } catch {
    return VERIFIED_OFFICIAL_ADMINS_TEXT;
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
 * Enforces nudity, NSFW, and bad image removal, and provides detailed replies
 * for valid Elite Force and system/interface images.
 */
export async function handlePhotoMessage(ctx: Context): Promise<void> {
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  const photos = ctx.message?.photo;
  const doc = ctx.message?.document;

  let fileId = '';
  let fileSize = 0;
  let defaultMime = 'image/jpeg';

  if (photos && photos.length > 0) {
    const bestPhoto = photos[photos.length - 1];
    fileId = bestPhoto.file_id;
    fileSize = bestPhoto.file_size || 0;
  } else if (doc && doc.mime_type?.startsWith('image/')) {
    fileId = doc.file_id;
    fileSize = doc.file_size || 0;
    defaultMime = doc.mime_type;
  } else {
    return;
  }

  const messageId = ctx.message?.message_id;
  if (messageId && isMessageAlreadyProcessed(messageId)) {
    return;
  }
  if (messageId) {
    markMessageAsProcessed(messageId);
  }

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

  // Safeguard: File size limit (10MB)
  if (fileSize > 10 * 1024 * 1024) {
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
    const fileInfo = await ctx.api.getFile(fileId);
    if (!fileInfo.file_path) {
      throw new Error('Telegram Bot API did not return a valid file_path');
    }

    // Determine MIME type from file extension or default
    const filePath = fileInfo.file_path.toLowerCase();
    let mimeType = defaultMime;
    if (filePath.endsWith('.png')) {
      mimeType = 'image/png';
    } else if (filePath.endsWith('.webp')) {
      mimeType = 'image/webp';
    } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      mimeType = 'image/jpeg';
    }

    // Download image buffer securely using internal token
    const fileUrl = `https://api.telegram.org/file/bot${env.telegramBotToken}/${fileInfo.file_path}`;
    const fileRes = await fetch(fileUrl, { signal: AbortSignal.timeout(20000) });

    if (!fileRes.ok) {
      throw new Error(`Failed to download image from Telegram file server (status ${fileRes.status})`);
    }

    const arrayBuf = await fileRes.arrayBuffer();
    const imageBase64 = Buffer.from(arrayBuf).toString('base64');

    // ── Step 1: Inappropriate Image Detection & Auto-Moderation (Req 18) ────────
    const isGroup = ctx.chat?.type !== 'private';
    const isSenderAdmin = ctx.from?.id ? isAdmin(ctx.from.id) : false;
    const shouldModerate = shouldModerateChat(ctx.chat?.id, isGroup) && !isSenderAdmin;

    if (shouldModerate && isOpenAIModerationAvailable()) {
      let moderationFlagged = false;
      let moderationReason = '';
      try {
        const modResult = await moderateImage(imageBase64, mimeType, caption);
        moderationFlagged = modResult.flagged;
        moderationReason = modResult.reason ?? 'Content policy violation';
        logger.info('Image moderation result', {
          flagged: modResult.flagged,
          confidence: modResult.confidence,
          isChildSafety: modResult.isChildSafetyViolation ?? false,
        });
      } catch (modErr) {
        const modErrMsg = modErr instanceof Error ? modErr.message : String(modErr);
        logger.warn('Image moderation API failed, proceeding to vision analysis', { error: modErrMsg });
        // fail-open: if moderation API is down, proceed to vision (or fail-closed if configured)
        if (env.moderationFailClosed) {
          await deleteLoadingSticker(ctx, loadingStickerId);
          if (isGroup) {
            try { await ctx.deleteMessage(); } catch { /* ignore */ }
          }
          await safeReply(
            ctx,
            '⚠️ Image could not be verified due to a temporary moderation issue. Please try again shortly.',
            { replyToMessage: false }
          );
          return;
        }
      }

      if (moderationFlagged) {
        await deleteLoadingSticker(ctx, loadingStickerId);
        try {
          await ctx.deleteMessage();
          logger.info('Deleted inappropriate/nude photo (Step 1: Moderation)', {
            chatId: ctx.chat?.id,
            messageId: ctx.message?.message_id,
            fromUserId: ctx.from?.id,
            reason: moderationReason,
          });
        } catch (delErr) {
          logger.warn('Failed to delete inappropriate photo', {
            error: delErr instanceof Error ? delErr.message : String(delErr),
          });
        }

        await safeReply(
          ctx,
          env.imageModerationWarningMessage,
          { replyToMessage: false }
        );
        return;
      }
    }

    // ── Step 2: Vision Analysis ─────────────────────────────────────────────
    const contextInfo = caption
      ? getRelevantOfficialChannelContext(caption) || undefined
      : undefined;

    const analysisResult = await analyzeImageWithAI({
      imageBase64,
      mimeType,
      userPrompt: caption,
      contextInfo,
    });

    // If caught as inappropriate/nude by multimodal vision or safety filter:
    if (analysisResult.isInappropriate) {
      await deleteLoadingSticker(ctx, loadingStickerId);
      try {
        await ctx.deleteMessage();
        logger.info('Deleted inappropriate/nude photo (Step 2: Vision safety refusal caught)', {
          chatId: ctx.chat?.id,
          messageId: ctx.message?.message_id,
          fromUserId: ctx.from?.id,
        });
      } catch (delErr) {
        logger.warn('Failed to delete inappropriate photo', {
          error: delErr instanceof Error ? delErr.message : String(delErr),
        });
      }

      await safeReply(
        ctx,
        env.imageModerationWarningMessage,
        { replyToMessage: false }
      );
      return;
    }

    // Ensure the animated loading sticker is visible for at least 3000ms
    const elapsed = Date.now() - startTime;
    const minDisplayMs = 3000;
    if (elapsed < minDisplayMs) {
      await sleep(minDisplayMs - elapsed);
    }

    await deleteLoadingSticker(ctx, loadingStickerId);
    await safeReply(ctx, analysisResult.text, { replyToMessage: true });
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
