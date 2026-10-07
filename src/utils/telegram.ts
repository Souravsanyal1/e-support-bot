import fs from 'fs';
import path from 'path';
import { Context, InputFile } from 'grammy';
import { logger } from './logger';
import {
  buildMessageWithEntities,
  formatToTelegramHtml,
  stripCustomEmojiTags,
  stripAllHtmlTags,
  TelegramEntity,
} from './telegramFormatter';
import { LOADING_STICKER_FILE_ID } from '../config/bot.config';

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Detects whether text contains Markdown formatting syntax.
 */
function hasMarkdown(text: string): boolean {
  return /\*\*|(?<![*])\*(?![*])|_[^_]+_|`[^`]+`|\[[^\]]+\]\(https?:/.test(text);
}

/**
 * Splits a plain text string into chunks ≤ maxLength characters.
 * Also adjusts entity offsets per chunk for multi-part messages.
 */
export function splitMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex === 0) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

/**
 * Splits text and adjusts entity offsets for each chunk.
 */
function splitWithEntities(
  text: string,
  entities: TelegramEntity[],
  maxLength = 4000
): Array<{ text: string; entities: TelegramEntity[] }> {
  if (text.length <= maxLength) return [{ text, entities }];

  const results: Array<{ text: string; entities: TelegramEntity[] }> = [];
  let pos = 0;

  while (pos < text.length) {
    const end = Math.min(pos + maxLength, text.length);
    let splitAt = end;
    if (splitAt < text.length) {
      const sub = text.slice(pos, end);
      const nlnl = sub.lastIndexOf('\n\n');
      const nl = sub.lastIndexOf('\n');
      const sp = sub.lastIndexOf(' ');
      if (nlnl > maxLength / 2) splitAt = pos + nlnl;
      else if (nl > maxLength / 2) splitAt = pos + nl;
      else if (sp > maxLength / 2) splitAt = pos + sp;
    }

    const chunkText = text.slice(pos, splitAt).trim();
    const chunkEntities = entities
      .filter((e) => e.offset >= pos && e.offset + e.length <= splitAt)
      .map((e) => ({ ...e, offset: e.offset - pos }));

    results.push({ text: chunkText, entities: chunkEntities });
    pos = splitAt;
  }

  return results;
}

/**
 * Safely sends a Telegram message with animated custom emojis and rich formatting.
 *
 * Delivery order (four tiers):
 *   1. Entity-based (plain text + MessageEntity[], type: "custom_emoji") — for plain text messages.
 *   2. HTML with <tg-emoji> + <b>/<i>/<code>/<a> — for Markdown-formatted messages.
 *   3. HTML with standard emojis (strips <tg-emoji> tags) — if animated emojis are rejected.
 *   4. Plain text — rock-solid last resort.
 */
export async function safeReply(
  ctx: Context,
  text: string,
  options?: { replyToMessage?: boolean }
): Promise<void> {
  const sourceMessageId = ctx.message?.message_id ?? ctx.channelPost?.message_id;
  const replyParamsBase =
    options?.replyToMessage && sourceMessageId
      ? { message_id: sourceMessageId }
      : undefined;

  const isMarkdown = hasMarkdown(text);

  if (!isMarkdown) {
    // ── Tier 1: Entity mode ──────────────────────────────────────────────────
    const { text: rawText, entities } = buildMessageWithEntities(text);
    const chunks = splitWithEntities(rawText, entities);

    let allSent = true;
    for (let i = 0; i < chunks.length; i++) {
      const { text: chunkText, entities: chunkEntities } = chunks[i];
      let replyParameters = i === 0 ? replyParamsBase : undefined;

      try {
        await ctx.reply(chunkText, {
          entities: chunkEntities.length > 0
            ? (chunkEntities as Parameters<typeof ctx.reply>[1] extends { entities?: infer E } ? E : never)
            : undefined,
          reply_parameters: replyParameters,
        } as Parameters<typeof ctx.reply>[1]);
      } catch (errTier1) {
        // If reply_parameters failed (e.g. user deleted message), retry without reply_parameters
        let retryOk = false;
        if (replyParameters) {
          try {
            replyParameters = undefined;
            await ctx.reply(chunkText, {
              entities: chunkEntities.length > 0
                ? (chunkEntities as Parameters<typeof ctx.reply>[1] extends { entities?: infer E } ? E : never)
                : undefined,
            } as Parameters<typeof ctx.reply>[1]);
            retryOk = true;
          } catch {
            retryOk = false;
          }
        }

        if (!retryOk) {
          allSent = false;
          // Fall through to HTML attempt for this chunk
          try {
            await ctx.reply(chunkText, { reply_parameters: replyParameters });
          } catch (err) {
            logger.error('Entity-mode plain text fallback failed', err);
          }
        }
      }
    }
    if (allSent) return;
  }

  // ── Tier 2: HTML mode with <tg-emoji> ────────────────────────────────────
  const formattedHtml = formatToTelegramHtml(text);
  const htmlChunks = splitMessage(formattedHtml);

  for (let i = 0; i < htmlChunks.length; i++) {
    const chunk = htmlChunks[i];
    let replyParameters = i === 0 ? replyParamsBase : undefined;

    try {
      await ctx.reply(chunk, {
        parse_mode: 'HTML',
        reply_parameters: replyParameters,
      });
      continue;
    } catch (err1) {
      const errMsg1 = err1 instanceof Error ? err1.message : String(err1);
      if (replyParameters && (errMsg1.includes('reply') || errMsg1.includes('message to be replied not found'))) {
        replyParameters = undefined;
        try {
          await ctx.reply(chunk, { parse_mode: 'HTML' });
          continue;
        } catch {
          // Proceed to Tier 3
        }
      }
      logger.warn('HTML with <tg-emoji> rejected by Telegram', {
        error: errMsg1,
      });
    }

    // ── Tier 3: HTML without <tg-emoji> ──────────────────────────────────
    try {
      await ctx.reply(stripCustomEmojiTags(chunk), {
        parse_mode: 'HTML',
        reply_parameters: replyParameters,
      });
      continue;
    } catch (err2) {
      const errMsg2 = err2 instanceof Error ? err2.message : String(err2);
      if (replyParameters && (errMsg2.includes('reply') || errMsg2.includes('message to be replied not found'))) {
        replyParameters = undefined;
        try {
          await ctx.reply(stripCustomEmojiTags(chunk), { parse_mode: 'HTML' });
          continue;
        } catch {
          // Proceed to Tier 4
        }
      }
      logger.warn('Standard HTML also rejected by Telegram', {
        error: errMsg2,
      });
    }

    // ── Tier 4: Plain text ────────────────────────────────────────────────
    try {
      await ctx.reply(stripAllHtmlTags(chunk), {
        reply_parameters: replyParameters,
      });
    } catch (err) {
      // Last-resort fallback: retry purely plain text with no reply_parameters
      if (replyParameters) {
        try {
          await ctx.reply(stripAllHtmlTags(chunk));
          continue;
        } catch (retryErr) {
          logger.error('Plain text delivery without reply_parameters failed', retryErr);
        }
      }
      logger.error('All message delivery tiers failed', err);
      throw err;
    }
  }
}

/**
 * Sends a typing indicator while the AI generates a response.
 */
export async function sendTypingAction(ctx: Context): Promise<void> {
  try {
    await ctx.replyWithChatAction('typing');
  } catch (err) {
    logger.debug('Failed to send typing action', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Helper utility to pause execution for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cache uploaded sticker file_id after the first upload for super-fast delivery
let cachedStickerFileId: string | null = null;
const LOCAL_STICKER_PATH = path.resolve(
  process.cwd(),
  'public/Hot Copperhead #6 (1).tgs'
);

/**
 * Sends the official Elite Force loading animated sticker (#6 Trophy 🏆).
 * Uses the local public/Hot Copperhead #6 (1).tgs file.
 * Caches the uploaded file_id after the first send for maximum speed.
 * Returns the sent message ID, or null if sending failed.
 */
export async function sendLoadingSticker(ctx: Context): Promise<number | null> {
  try {
    let stickerSource: string | InputFile;

    if (cachedStickerFileId) {
      stickerSource = cachedStickerFileId;
    } else if (fs.existsSync(LOCAL_STICKER_PATH)) {
      stickerSource = new InputFile(LOCAL_STICKER_PATH);
    } else {
      stickerSource = LOADING_STICKER_FILE_ID;
    }

    const stickerMsg = await ctx.replyWithSticker(stickerSource);

    // Save the uploaded file_id returned by Telegram for future instant sends
    if (stickerMsg.sticker?.file_id && !cachedStickerFileId) {
      cachedStickerFileId = stickerMsg.sticker.file_id;
      logger.info('Cached uploaded sticker file_id', { fileId: cachedStickerFileId });
    }

    logger.info('Animated loading sticker sent to chat', {
      messageId: stickerMsg.message_id,
      chatId: ctx.chat?.id,
    });
    return stickerMsg.message_id;
  } catch (err) {
    logger.warn('Failed to send animated loading sticker', {
      error: err instanceof Error ? err.message : String(err),
      chatId: ctx.chat?.id,
    });
    return null;
  }
}

/**
 * Deletes the loading sticker cleanly when the response is ready.
 */
export async function deleteLoadingSticker(
  ctx: Context,
  messageId: number | null
): Promise<void> {
  if (!messageId || !ctx.chat?.id) return;
  try {
    await ctx.api.deleteMessage(ctx.chat.id, messageId);
    logger.info('Animated loading sticker removed from chat', {
      messageId,
      chatId: ctx.chat.id,
    });
  } catch (err) {
    logger.debug('Failed to delete loading sticker (might already be deleted)', {
      error: err instanceof Error ? err.message : String(err),
      messageId,
    });
  }
}
