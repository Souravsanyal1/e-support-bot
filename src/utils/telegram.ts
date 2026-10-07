import { Context } from 'grammy';
import { logger } from './logger';

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
 * Safely sends a response message to Telegram.
 * Attempts Markdown format first; if Telegram rejects formatting, falls back to plain text.
 */
export async function safeReply(
  ctx: Context,
  text: string,
  options?: { replyToMessage?: boolean }
): Promise<void> {
  const chunks = splitMessage(text);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const replyParameters =
      options?.replyToMessage && i === 0 && ctx.message?.message_id
        ? { message_id: ctx.message.message_id }
        : undefined;

    try {
      // First attempt with HTML or Markdown formatting
      await ctx.reply(chunk, {
        parse_mode: 'Markdown',
        reply_parameters: replyParameters,
      });
    } catch (markdownError) {
      // If Markdown parsing fails due to unescaped special characters, fall back to plain text
      logger.debug('Markdown formatting rejected by Telegram API, falling back to plain text', {
        error: markdownError instanceof Error ? markdownError.message : String(markdownError),
      });

      try {
        await ctx.reply(chunk, {
          reply_parameters: replyParameters,
        });
      } catch (fallbackError) {
        logger.error('Failed to send message chunk even in plain text fallback', fallbackError);
        throw fallbackError;
      }
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
