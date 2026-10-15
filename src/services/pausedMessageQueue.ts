import { Context } from 'grammy';
import { logger } from '../utils/logger';

const MAX_PAUSED_MESSAGES = 100;
const pendingMessages: Context[] = [];
const seenUpdateIds = new Set<number>();

/** Keep a bounded in-memory copy of text updates received while user replies are paused. */
export function queuePausedMessage(ctx: Context): boolean {
  const message = ctx.message;
  const text = message?.text?.trim();
  const updateId = ctx.update.update_id;
  if (!message || !text || text.startsWith('/') || !ctx.chat || seenUpdateIds.has(updateId)) return false;

  seenUpdateIds.add(updateId);
  if (pendingMessages.length >= MAX_PAUSED_MESSAGES) {
    const dropped = pendingMessages.shift();
    if (dropped) seenUpdateIds.delete(dropped.update.update_id);
    logger.warn('Paused message queue is full; dropped the oldest pending message', {
      maxQueuedMessages: MAX_PAUSED_MESSAGES,
    });
  }
  pendingMessages.push(ctx);
  logger.info('Queued a message received while bot replies were paused', {
    chatId: ctx.chat.id,
    messageId: message.message_id,
    queuedCount: pendingMessages.length,
  });
  return true;
}

/** Replay queued messages one by one in Telegram update arrival order. */
export async function replayPausedMessages(
  processMessage: (ctx: Context) => Promise<void>
): Promise<number> {
  let processed = 0;
  while (pendingMessages.length > 0) {
    const ctx = pendingMessages.shift()!;
    seenUpdateIds.delete(ctx.update.update_id);
    try {
      await processMessage(ctx);
      processed += 1;
    } catch (error) {
      logger.error('Could not replay a queued message after bot reactivation', {
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return processed;
}

export function getPausedMessageQueueSize(): number {
  return pendingMessages.length;
}
