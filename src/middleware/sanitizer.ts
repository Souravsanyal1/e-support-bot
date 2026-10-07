import { Context, NextFunction } from 'grammy';
import { logger } from '../utils/logger';

export const MAX_INPUT_TEXT_LENGTH = 1500;

/**
 * Strips dangerous control characters and null bytes from user input.
 */
export function sanitizeInputString(input: string): string {
  // Remove null characters and non-printable control characters except standard whitespace (\n, \r, \t)
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Middleware that validates and sanitizes incoming user text messages.
 */
export async function sanitizeMessageMiddleware(
  ctx: Context,
  next: NextFunction
): Promise<void> {
  const message = ctx.message ?? ctx.channelPost;
  const rawText = message?.text;

  // If update is not a text message, pass through
  if (!message || rawText === undefined) {
    await next();
    return;
  }

  // Length check to mitigate resource exhaustion
  if (rawText.length > MAX_INPUT_TEXT_LENGTH) {
    logger.warn('Received message exceeding maximum character length', {
      userId: ctx.from?.id,
      length: rawText.length,
    });

    await ctx.reply(
      `⚠️ Your message is too long (maximum ${MAX_INPUT_TEXT_LENGTH} characters). Please send a shorter, more concise question.`
    );
    return;
  }

  // Sanitize message text in place
  message.text = sanitizeInputString(rawText);

  await next();
}
