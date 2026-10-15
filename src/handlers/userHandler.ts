import { Context } from 'grammy';
import { generateSupportResponse, getWalletSafetyResponse } from '../ai/gemini';
import { analyzeImageWithAI } from '../ai/vision';
import {
  moderateImage,
  isImageModerationAvailable,
  isMessageAlreadyProcessed,
  markMessageAsProcessed,
  shouldModerateChat,
} from '../ai/moderation';
import { BOT_CONFIG, PUBLIC_COMMANDS, GROUP_MEDIA_POLICY } from '../config/bot.config';
import { env } from '../config/env.config';
import { botStateManager } from '../bot/state';
import { isAdmin } from '../middleware/adminAuth';
import {
  safeReply,
  sendTypingAction,
  sendLoadingSticker,
  deleteLoadingSticker,
  showReplyStickerTemporarily,
  scheduleAutoDelete,
  sleep,
} from '../utils/telegram';
import { logger } from '../utils/logger';
import {
  getRelevantOfficialChannelContext,
  getLaunchAnnouncementForQuestion,
  ensureOfficialChannelHistorySynced,
  observeOfficialChannelPost,
} from '../ai/officialChannelKnowledge';
import { checkMessageLanguage } from '../utils/languageDetector';
import { checkBadWords } from '../utils/badWordsDetector';
import { registerAdminCommandsForUser } from '../bot/commands';
import { checkPromptSecurity } from '../utils/promptSecurity';
import { logMessageToFile } from '../utils/messageLogger';
import { isImageDocument } from '../utils/imageDetector';
import { getGamingNftContextForQuestion } from '../knowledge/gaming-nft';
import { languageModeManager } from '../bot/languageMode';
import {
  shouldReply as smartShouldReply,
  recordReply,
} from '../utils/messageTrigger';



const OFFICIAL_CHANNEL_ID = '@EliteForce_Official';
const OFFICIAL_COMMUNITY_GROUP_ID = '@EliteForceCommunity';
const ADMIN_LIST_QUERY = /\b(admins?|administrators?|moderators?)\b/i;
const OWNER_QUERY = /\b(?:who(?:\s+is)?\s+(?:the\s+)?|show\s+(?:me\s+)?(?:the\s+)?|name\s+of\s+(?:the\s+)?|(?:the\s+)?)?(?:owner|founder|proprietor)\b|\b(?:owner|founder|proprietor)(?:'s)?\s+(?:(?:telegram|user|account)\s+)?id\b|\b(?:id|numeric id)\s+of\s+(?:the\s+)?(?:owner|founder|proprietor)\b/i;
const chatReplyQueues = new Map<string, Promise<void>>();

function enqueueChatReply(chatId: number, task: () => Promise<void>): Promise<void> {
  const key = String(chatId);
  const previous = chatReplyQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  const tracked = current.finally(() => {
    if (chatReplyQueues.get(key) === tracked) chatReplyQueues.delete(key);
  });
  chatReplyQueues.set(key, tracked);
  return tracked;
}

async function replyInChatOrder(ctx: Context, text: string, replyToMessage = true): Promise<void> {
  await enqueueChatReply(ctx.chat?.id ?? 0, async () => {
    await safeReply(ctx, text, { replyToMessage });
  });
}

async function syncChannelHistoryWithoutHoldingReply(): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(() => resolve(), 1200);
  });
  try {
    await Promise.race([ensureOfficialChannelHistorySynced().then(() => undefined), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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
  const hasListIntent = /\b(who|what|list|names?|new|added|show|tell|display|find|contact|channel|group|official|team|mod(?:erator)?s?)\b/i.test(lower);
  const isShortAdminQuery = lower.replace(/[^a-z]+/g, ' ').trim().split(/\s+/).filter(Boolean).length <= 3;
  return hasAdmin && (hasListIntent || /[?？]/.test(lower) || isShortAdminQuery);
}

export function isOwnerIdentityQuery(text: string): boolean {
  return OWNER_QUERY.test(text);
}

export function getAdminLookupTarget(_ctx: Context, question: string): string | number {
  if (/\bchannel\b/i.test(question)) return OFFICIAL_CHANNEL_ID;
  return OFFICIAL_COMMUNITY_GROUP_ID;
}

const OWNER_PRIVACY_RESPONSE = "I can't identify the owner or share the owner's ID. I can list the other publicly listed admins.";

/** Blocks suspicious instructions before any user text reaches an AI provider. */
async function rejectUnsafePrompt(ctx: Context, text: string, alreadyQueued = false): Promise<boolean> {
  const result = checkPromptSecurity(text);
  if (!result.isThreat) return false;

  // Never put attacker-controlled text in operational logs: it may contain
  // secrets, personal data, or deliberately crafted log content.
  logger.warn('Prompt security check blocked a suspicious request', {
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
    threatType: result.threatType,
    messageLength: text.length,
    entryPoint: ctx.message?.photo || ctx.message?.document ? 'image_caption' : 'text',
  });

  if (ctx.chat?.type === 'private') {
    if (alreadyQueued) await safeReply(ctx, result.safeResponse);
    else await replyInChatOrder(ctx, result.safeResponse);
  } else {
    try { await ctx.deleteMessage(); } catch { /* bot may not have delete permission */ }
  }
  return true;
}

export async function getOfficialChannelAdmins(
  ctx: Context,
  targetChatId: string | number = OFFICIAL_COMMUNITY_GROUP_ID
): Promise<string> {
  try {
    const admins = await ctx.api.getChatAdministrators(targetChatId);
    const humanAdmins = admins
      .filter((admin) => !admin.user.is_bot && admin.status === 'administrator')
      .map((admin) => {
        const name = [admin.user.first_name, admin.user.last_name].filter(Boolean).join(' ').trim();
        return admin.user.username ? `${name || 'Admin'} (@${admin.user.username})` : name || 'Admin';
      });
    const uniqueAdmins = [...new Set(humanAdmins)];

    // Public Telegram display names/usernames are okay; never include numeric IDs.
    if (uniqueAdmins.length > 0) {
      const scope = targetChatId === OFFICIAL_CHANNEL_ID
        ? 'the official Elite Force Telegram announcement channel'
        : 'the official Elite Force Telegram community group';
      return [
        `Current human administrators of ${scope} (verified live from Telegram):`,
        ...uniqueAdmins.map((name) => `• ${name}`),
        '',
        'This list excludes bots and reflects administrators currently listed by Telegram.',
      ].join('\n');
    }
    return VERIFIED_OFFICIAL_ADMINS_TEXT;
  } catch (error) {
    logger.warn('Could not fetch Telegram admin list', {
      chatId: targetChatId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (targetChatId === OFFICIAL_CHANNEL_ID) return VERIFIED_OFFICIAL_ADMINS_TEXT;
    return "I can't fetch the current admin list for the official community group right now. Please check the Administrators section in the group info.";
  }
}

/**
 * Handles the /start command.
 */
export async function handleStartCommand(ctx: Context): Promise<void> {
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  // If sender is an authorized administrator, register the full admin command menu for their chat
  if (isAdmin(ctx.from?.id) && ctx.chat?.id) {
    try {
      await registerAdminCommandsForUser(ctx.api, ctx.chat.id);
    } catch {
      // Non-fatal
    }
  }

  const message = [
    `*${BOT_CONFIG.introduction}* 👋`,
    `Ask me about Elite Force, E-FORCE, and official updates.`,
    `No sign-up is needed; chat history is not saved.`,
    '',
    `🌐 [Website](https://elite-force.space) • ⏱️ [Timer](https://timer.elite-force.space) • 📢 [Telegram Group](https://t.me/EliteForceCommunity)`,
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

  const isUserAdmin = isAdmin(ctx.from?.id);

  // If sender is an admin, ensure their chat command menu is updated
  if (isUserAdmin && ctx.chat?.id) {
    try {
      await registerAdminCommandsForUser(ctx.api, ctx.chat.id);
    } catch {
      // Non-fatal
    }
  }

  const commandList = PUBLIC_COMMANDS.map((cmd) => `• \`/${cmd.command}\` — ${cmd.description}`).join(
    '\n'
  );

  const adminCommandList = [
    '• `/status` — View server status, latency, and active AI model',
    '• `/reload` — Hot-reload training data and system prompts',
    '• `/sync` — Force sync official channels and refresh knowledge',
    '• `/broadcast <msg>` — Send notification broadcast to active users',
    '• `/users` — View active user conversation stats',
    '• `/off [reason]` — Disable bot responses temporarily or permanently',
    '• `/on` — Re-enable bot responses',
    '• `/time <duration>` — Schedule temporary downtime with auto-reactivation',
    '• `/ban` — Reply to a member to permanently ban them; add `24|48|72` for a temporary ban',
    '• `/limit 24|48|72` — Reply to a member to temporarily mute them',
  ].join('\n');

  const messageParts = [
    `*${BOT_CONFIG.name} — Help & Commands Guide* 💡`,
    '',
    `*Available Public Commands:*`,
    commandList,
  ];

  if (isUserAdmin) {
    messageParts.push(
      '',
      `*🛡️ Special Administrator Commands:*`,
      adminCommandList
    );
  }

  messageParts.push(
    '',
    `*Direct Chat & Image Support:*`,
    `You can chat directly or send photos/screenshots with questions! I will analyze them and reply in clear English.`,
    '',
    `*Official Channels:*`,
    `📢 [Telegram Group](https://t.me/EliteForceCommunity) • [Announcement Channel](https://t.me/EliteForce_Official) • 🐦 [X (Twitter)](https://x.com/EliteForceOFC)`,
    '',
    `*Important Rules:*`,
    `• E-FORCE launch and listing dates are in development and will only be shared via official channels.`,
    `• No price speculation, financial advice, or profit guarantees are provided.`
  );

  await safeReply(ctx, messageParts.join('\n'));
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
    `📢 [Telegram Group](https://t.me/EliteForceCommunity) • [Announcement Channel](https://t.me/EliteForce_Official) • 🐦 [X (Twitter)](https://x.com/EliteForceOFC)`,
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

  if (await rejectUnsafePrompt(ctx, query)) return;

  const walletSafetyResponse = getWalletSafetyResponse(query);
  if (walletSafetyResponse) {
    await replyInChatOrder(ctx, walletSafetyResponse);
    return;
  }

  if (isOwnerIdentityQuery(query)) {
    await replyInChatOrder(ctx, OWNER_PRIVACY_RESPONSE);
    return;
  }

  if (isAdminListQuery(query)) {
    await enqueueChatReply(ctx.chat?.id ?? 0, async () => {
      const admins = await getOfficialChannelAdmins(ctx, getAdminLookupTarget(ctx, query));
      await safeReply(ctx, admins);
    });
    return;
  }

  await enqueueChatReply(ctx.chat?.id ?? 0, async () => {
    await sendTypingAction(ctx);
    const startTime = Date.now();
    const loadingStickerId = await sendLoadingSticker(ctx);

    try {
      await syncChannelHistoryWithoutHoldingReply();
      const response = await generateSupportResponse(
        query,
        getLaunchAnnouncementForQuestion(query),
        getRelevantOfficialChannelContext(query),
        ctx.chat?.type === 'private' ? ctx.from?.id : undefined
      );

      const elapsed = Date.now() - startTime;
      const minDisplayMs = 3000;
      if (elapsed < minDisplayMs) await sleep(minDisplayMs - elapsed);

      await deleteLoadingSticker(ctx, loadingStickerId);
      await safeReply(ctx, response, { replyToMessage: true });
      await showReplyStickerTemporarily(ctx);
    } catch (error) {
      await deleteLoadingSticker(ctx, loadingStickerId);
      logger.error('Error handling /ask command', error);
      await safeReply(ctx, "I'm temporarily experiencing an issue generating an answer. Please try again in a moment.", { replyToMessage: true });
    }
  });
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
export async function handleTextMessage(
  ctx: Context,
  options: { replayingPausedMessage?: boolean } = {}
): Promise<void> {
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  const text = ctx.message?.text?.trim();
  if ((!ctx.from && !ctx.message?.sender_chat) || !text) return;

  // Ignore commands that might have bypassed command routing
  if (text.startsWith('/')) {
    return;
  }

  // ── Smart Trigger Decision ────────────────────────────────────────────────
  const botUsernameRaw = ctx.me?.username || 'Elite_Force_Support_Bot';
  const lowerText = text.toLowerCase();

  const isMention =
    lowerText.includes(`@${botUsernameRaw.toLowerCase()}`) ||
    lowerText.includes('@eliteforcessupportbot') ||
    lowerText.includes('@elite_force_support_bot');

  const isReplyToBot =
    !!ctx.message?.reply_to_message?.from?.id &&
    ctx.message.reply_to_message.from.id === ctx.me?.id;

  const triggerDecision = smartShouldReply({
    text,
    chatType: (ctx.chat?.type as 'private' | 'group' | 'supergroup' | 'channel') || 'private',
    isMention,
    isReplyToBot,
    chatId: ctx.chat?.id ?? 0,
  });

  const replayedRepeat = options.replayingPausedMessage && triggerDecision.reason === 'repeat_spam_guard';
  if (!triggerDecision.shouldReply && !replayedRepeat) {
    logger.debug('Smart trigger: message ignored', {
      reason: triggerDecision.reason,
      chatId: ctx.chat?.id,
      userId: ctx.from?.id,
    });
    return;
  }

  // Clean prompt by removing bot mention tags
  const cleanedText = text
    .replace(new RegExp(`@${botUsernameRaw}`, 'gi'), '')
    .replace(/@elite_force_support_bot/gi, '')
    .trim();

  const queryToProcess = cleanedText || text;
  // Reject prompt overrides before admin lookups or retrieval can use unrelated context.
  if (await rejectUnsafePrompt(ctx, queryToProcess)) return;

  const walletSafetyResponse = getWalletSafetyResponse(queryToProcess);
  if (walletSafetyResponse) {
    await replyInChatOrder(ctx, walletSafetyResponse);
    return;
  }

  if (isOwnerIdentityQuery(queryToProcess)) {
    await replyInChatOrder(ctx, OWNER_PRIVACY_RESPONSE);
    return;
  }

  if (isAdminListQuery(queryToProcess)) {
    await enqueueChatReply(ctx.chat?.id ?? 0, async () => {
      const admins = await getOfficialChannelAdmins(ctx, getAdminLookupTarget(ctx, queryToProcess));
      await safeReply(ctx, admins, { replyToMessage: true });
    });
    return;
  }

  // ── Message Logging (non-admin users only) ────────────────────────────────
  if (!isAdmin(ctx.from?.id)) {
    logMessageToFile({
      userId: ctx.from?.id,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      chatType: ctx.chat?.type || 'unknown',
      chatId: ctx.chat?.id,
      text: queryToProcess,
    });
  }

  await enqueueChatReply(ctx.chat?.id ?? 0, async () => {
    await sendTypingAction(ctx);
    const startTime = Date.now();
    const loadingStickerId = await sendLoadingSticker(ctx);

    try {
      await syncChannelHistoryWithoutHoldingReply();
      const response = await generateSupportResponse(
        queryToProcess,
        getLaunchAnnouncementForQuestion(queryToProcess),
        getRelevantOfficialChannelContext(queryToProcess),
        ctx.chat?.type === 'private' ? ctx.from?.id : undefined,
        isReplyToBot ? ctx.message?.reply_to_message?.text : undefined
      );

      const elapsed = Date.now() - startTime;
      const minDisplayMs = 3000;
      if (elapsed < minDisplayMs) await sleep(minDisplayMs - elapsed);

      await deleteLoadingSticker(ctx, loadingStickerId);
      await safeReply(ctx, response, { replyToMessage: true });
      await showReplyStickerTemporarily(ctx);
      if (ctx.chat?.id) recordReply(ctx.chat.id, queryToProcess);
    } catch (error) {
      await deleteLoadingSticker(ctx, loadingStickerId);
      logger.error('Error handling direct text message', error);
      await safeReply(ctx, "I'm having temporary trouble reaching my AI engine. Please ask your question again shortly.", { replyToMessage: true });
    }
  });
}

/**
 * Handles user-submitted photos and screenshots using multimodal AI vision.
 * Enforces nudity, NSFW, and bad image removal, and provides detailed replies
 * for valid Elite Force and system/interface images.
 */
export async function handlePhotoMessage(ctx: Context): Promise<void> {
  await enqueueChatReply(ctx.chat?.id ?? 0, async () => {
    await processPhotoMessage(ctx);
  });
}

async function processPhotoMessage(ctx: Context): Promise<void> {
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
  } else if (doc) {
    // Accept any document routed here by bot.ts image detection
    fileId = doc.file_id;
    fileSize = doc.file_size || 0;
    defaultMime = doc.mime_type || 'image/jpeg';
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

  // ── Zero-Tolerance Image Sharing Policy in Community Groups ────────────────
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  const isSenderAdmin = ctx.from?.id ? isAdmin(ctx.from.id) : false;

  if (isGroup && GROUP_MEDIA_POLICY.blockAllImagesInGroups && !isSenderAdmin) {
    try {
      await ctx.deleteMessage();
      logger.info('Deleted image from group as per group media policy', {
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
        fromUserId: ctx.from?.id,
      });
    } catch (err) {
      logger.warn('Failed to delete group image (bot may lack delete permissions)', {
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (GROUP_MEDIA_POLICY.sendWarningInGroups) {
      try {
        const warningMsg = await ctx.reply(GROUP_MEDIA_POLICY.warningMessage);
        if (warningMsg?.message_id && GROUP_MEDIA_POLICY.warningAutoDeleteMs > 0) {
          scheduleAutoDelete(ctx, warningMsg.message_id, GROUP_MEDIA_POLICY.warningAutoDeleteMs);
        }
      } catch {
        // Silently swallow reply errors
      }
    }
    return;
  }

  const caption = ctx.message?.caption?.trim();

  if (caption && await rejectUnsafePrompt(ctx, caption, true)) return;
  if (caption) {
    const walletSafetyResponse = getWalletSafetyResponse(caption);
    if (walletSafetyResponse) {
      await safeReply(ctx, walletSafetyResponse, { replyToMessage: true });
      return;
    }
  }

  // If caption has non-English text or bad words, enforce community guidelines
  if (caption) {
    const badCheck = checkBadWords(caption);
    if (badCheck.hasBadWords) {
      try {
        await ctx.deleteMessage();
      } catch {
        // Ignore
      }
      return;
    }

    const langCheck = checkMessageLanguage(caption);
    if (!langCheck.isEnglish && !languageModeManager.isAllLanguagesAllowed()) {
      try {
        await ctx.deleteMessage();
      } catch {
        // Ignore
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
    } else if (filePath.endsWith('.gif')) {
      mimeType = 'image/gif';
    } else if (filePath.endsWith('.bmp')) {
      mimeType = 'image/bmp';
    } else if (filePath.endsWith('.svg')) {
      mimeType = 'image/svg+xml';
    } else if (filePath.endsWith('.avif')) {
      mimeType = 'image/avif';
    } else if (filePath.endsWith('.heic')) {
      mimeType = 'image/heic';
    } else if (filePath.endsWith('.heif')) {
      mimeType = 'image/heif';
    } else if (filePath.endsWith('.ico')) {
      mimeType = 'image/x-icon';
    } else if (filePath.endsWith('.tiff') || filePath.endsWith('.tif')) {
      mimeType = 'image/tiff';
    } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') || filePath.endsWith('.jfif')) {
      mimeType = 'image/jpeg';
    }

    if (!isImageDocument(mimeType, filePath)) {
      await deleteLoadingSticker(ctx, loadingStickerId);
      await safeReply(
        ctx,
        '⚠️ The uploaded file format is not supported for image analysis. Please send a JPG, PNG, GIF, WebP, BMP, TIFF, SVG, HEIC, or AVIF image.',
        { replyToMessage: true }
      );
      return;
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
    const shouldModerate = shouldModerateChat(ctx.chat?.id, isGroup) && !isSenderAdmin;

    if (shouldModerate && isImageModerationAvailable()) {
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
        if (isGroup) {
          try {
            await ctx.deleteMessage();
            logger.info('Deleted inappropriate/nude photo in group', {
              chatId: ctx.chat?.id,
              messageId: ctx.message?.message_id,
              fromUserId: ctx.from?.id,
              reason: moderationReason,
            });
          } catch (delErr) {
            logger.warn('Failed to delete inappropriate photo in group', {
              error: delErr instanceof Error ? delErr.message : String(delErr),
            });
          }
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
    if (caption) await syncChannelHistoryWithoutHoldingReply();
    const contextInfo = caption
      ? [getRelevantOfficialChannelContext(caption), getGamingNftContextForQuestion(caption)].filter(Boolean).join('\n\n') || undefined
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
      if (isGroup) {
        try {
          await ctx.deleteMessage();
          logger.info('Deleted inappropriate/nude photo in group', {
            chatId: ctx.chat?.id,
            messageId: ctx.message?.message_id,
            fromUserId: ctx.from?.id,
          });
        } catch (delErr) {
          logger.warn('Failed to delete inappropriate photo in group', {
            error: delErr instanceof Error ? delErr.message : String(delErr),
          });
        }
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
    await showReplyStickerTemporarily(ctx);
  } catch (error) {
    await deleteLoadingSticker(ctx, loadingStickerId);
    logger.error('Error handling photo message', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    if (/safety|inappropriate|explicit|nude|nsfw|adult|content_filter|blocked|refus/i.test(errMsg)) {
      if (isGroup) {
        try {
          await ctx.deleteMessage();
        } catch {
          // ignore
        }
      }
      await safeReply(
        ctx,
        env.imageModerationWarningMessage,
        { replyToMessage: false }
      );
      return;
    }
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
      `📢 *Telegram Group:* https://t.me/EliteForceCommunity`,
      `📢 *Announcement Channel:* https://t.me/EliteForce_Official`,
      `🐦 *Official X:* https://x.com/EliteForceOFC`,
      '',
      `🛡️ *Safety Reminder:* Official admins will never start a private chat with you. Treat first-contact DMs claiming to be admins as fake, and never share private keys or seed phrases.`,
    ].join('\n');

    await safeReply(ctx, welcome);
  }
}

/**
 * Handles image files sent as documents ("Send as file" / uncompressed).
 *
 * Telegram routes these as `message:document` rather than `message:photo`.
 * This handler ensures ALL image formats (jpg, png, gif, webp, bmp, heic, avif, etc.)
 * are caught and instantly removed from groups — regardless of whether
 * Telegram has set a mime_type on the document or not.
 *
 * In private chats, the image is passed to the AI vision handler for analysis.
 */
export async function handleDocumentAsImage(ctx: Context): Promise<void> {
  if (!botStateManager.isUserFacingActive() && !isAdmin(ctx.from?.id)) {
    return;
  }

  const doc = ctx.message?.document;
  if (!doc) return;

  const messageId = ctx.message?.message_id;
  if (messageId && isMessageAlreadyProcessed(messageId)) return;
  if (messageId) markMessageAsProcessed(messageId);

  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  const isSenderAdmin = ctx.from?.id ? isAdmin(ctx.from.id) : false;

  // ── INSTANT GROUP REMOVAL — fires before any AI processing ─────────────────
  if (isGroup && GROUP_MEDIA_POLICY.blockAllImagesInGroups && !isSenderAdmin) {
    try {
      await ctx.deleteMessage();
      logger.info('Deleted document-image from group (format-agnostic policy)', {
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
        fromUserId: ctx.from?.id,
        fileName: doc.file_name,
        mimeType: doc.mime_type,
      });
    } catch (err) {
      logger.warn('Failed to delete document-image from group (bot may lack delete permissions)', {
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (GROUP_MEDIA_POLICY.sendWarningInGroups) {
      try {
        const warningMsg = await ctx.reply(GROUP_MEDIA_POLICY.warningMessage);
        if (warningMsg?.message_id && GROUP_MEDIA_POLICY.warningAutoDeleteMs > 0) {
          scheduleAutoDelete(ctx, warningMsg.message_id, GROUP_MEDIA_POLICY.warningAutoDeleteMs);
        }
      } catch {
        // Non-fatal
      }
    }
    return;
  }

  // ── Private chat: pass to standard photo/vision handler ────────────────────
  await handlePhotoMessage(ctx);
}

