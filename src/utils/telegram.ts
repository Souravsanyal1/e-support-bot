import { Context } from 'grammy';
import { logger } from './logger';
import {
  formatToTelegramHtml,
  stripCustomEmojiTags,
  stripAllHtmlTags,
} from './telegramFormatter';

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Splits text into chunks that fit within Telegram's message character limit.
 * Breaks preferentially on double-newlines, single-newlines, or spaces.
 */
export function splitMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try finding paragraph break
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);

    // If not found, try newline
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }

    // If still not found, try space
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }

    // Hard break if no good whitespace break point
    if (splitIndex === -1 || splitIndex === 0) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

/**
 * Safely sends a response message to Telegram with 3-tier fallback:
 * 1. Rich HTML with animated Telegram Custom Emojis (<tg-emoji>) + Bold + Italic.
 * 2. Standard HTML (with fallback emojis) if custom emoji ID is rejected.
 * 3. Plain text if HTML parsing encounters any unclosed tag.
 */
export async function safeReply(
  ctx: Context,
  text: string,
  options?: { replyToMessage?: boolean }
): Promise<void> {
  const formattedHtml = formatToTelegramHtml(text);
  const chunks = splitMessage(formattedHtml);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const replyParameters =
      options?.replyToMessage && i === 0 && ctx.message?.message_id
        ? { message_id: ctx.message.message_id }
        : undefined;

    // Level 1: Attempt rich HTML with animated <tg-emoji>
    try {
      await ctx.reply(chunk, {
        parse_mode: 'HTML',
        reply_parameters: replyParameters,
      });
      continue;
    } catch (emojiHtmlError) {
      logger.debug('HTML with animated custom emoji rejected, attempting standard HTML', {
        error:
          emojiHtmlError instanceof Error
            ? emojiHtmlError.message
            : String(emojiHtmlError),
      });
    }

    // Level 2: Standard HTML without <tg-emoji> tags (retains <b>, <i>, and clean emojis)
    const standardHtmlChunk = stripCustomEmojiTags(chunk);
    try {
      await ctx.reply(standardHtmlChunk, {
        parse_mode: 'HTML',
        reply_parameters: replyParameters,
      });
      continue;
    } catch (standardHtmlError) {
      logger.debug('Standard HTML rejected, falling back to plain text', {
        error:
          standardHtmlError instanceof Error
            ? standardHtmlError.message
            : String(standardHtmlError),
      });
    }

    // Level 3: Rock-solid plain text fallback
    try {
      const plainChunk = stripAllHtmlTags(chunk);
      await ctx.reply(plainChunk, {
        reply_parameters: replyParameters,
      });
    } catch (fallbackError) {
      logger.error('Failed to send message chunk in plain text fallback', fallbackError);
      throw fallbackError;
    }
  }
}

/**
 * Sends a continuous "typing" action in the chat while an async task is running.
 */
export async function sendTypingAction(ctx: Context): Promise<void> {
  try {
    await ctx.replyWithChatAction('typing');
  } catch (error) {
    // Non-critical action, safe to silently log at debug level
    logger.debug('Failed to send typing chat action', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
