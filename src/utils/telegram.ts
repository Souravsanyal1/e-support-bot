import { Context } from 'grammy';
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
  const replyParamsBase =
    options?.replyToMessage && ctx.message?.message_id
      ? { message_id: ctx.message.message_id }
      : undefined;

  const isMarkdown = hasMarkdown(text);

  if (!isMarkdown) {
    // ── Tier 1: Entity mode ──────────────────────────────────────────────────
    const { text: rawText, entities } = buildMessageWithEntities(text);
    const chunks = splitWithEntities(rawText, entities);

    let allSent = true;
    for (let i = 0; i < chunks.length; i++) {
      const { text: chunkText, entities: chunkEntities } = chunks[i];
      const replyParameters = i === 0 ? replyParamsBase : undefined;

      try {
        await ctx.reply(chunkText, {
          entities: chunkEntities.length > 0
            ? (chunkEntities as Parameters<typeof ctx.reply>[1] extends { entities?: infer E } ? E : never)
            : undefined,
          reply_parameters: replyParameters,
        } as Parameters<typeof ctx.reply>[1]);
      } catch {
        allSent = false;
        // Fall through to HTML attempt for this chunk
        try {
          await ctx.reply(chunkText, { reply_parameters: replyParameters });
        } catch (err) {
          logger.error('Entity-mode plain text fallback failed', err);
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
    const replyParameters = i === 0 ? replyParamsBase : undefined;

    try {
      await ctx.reply(chunk, {
        parse_mode: 'HTML',
        reply_parameters: replyParameters,
      });
      continue;
    } catch (err1) {
      logger.warn('HTML with <tg-emoji> rejected by Telegram', {
        error: err1 instanceof Error ? err1.message : String(err1),
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
      logger.warn('Standard HTML also rejected by Telegram', {
        error: err2 instanceof Error ? err2.message : String(err2),
      });
    }

    // ── Tier 4: Plain text ────────────────────────────────────────────────
    try {
      await ctx.reply(stripAllHtmlTags(chunk), {
        reply_parameters: replyParameters,
      });
    } catch (err) {
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
 * Sends the official Elite Force loading animated sticker (#6 Trophy 🏆).
 * Pack: https://t.me/addstickers/EliteForceWeb3
 * Returns the sent message ID, or null if sending failed.
 */
export async function sendLoadingSticker(ctx: Context): Promise<number | null> {
  try {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const replyParams =
      isGroup && ctx.message?.message_id
        ? { message_id: ctx.message.message_id }
        : undefined;

    const stickerMsg = await ctx.replyWithSticker(LOADING_STICKER_FILE_ID, {
      reply_parameters: replyParams,
    });
    return stickerMsg.message_id;
  } catch (err) {
    logger.debug('Failed to send loading sticker', {
      error: err instanceof Error ? err.message : String(err),
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
  } catch (err) {
    logger.debug('Failed to delete loading sticker', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

