import { Context, NextFunction } from 'grammy';
import { createHmac, randomBytes } from 'node:crypto';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

interface RateLimitRecord {
  timestamps: number[];
}

type RateLimitIdentity = number | { type: 'sender_chat'; id: number };

class RateLimiter {
  // The process-only key prevents raw Telegram IDs from being retained in the
  // in-memory rate-limit map or written to disk.
  private readonly privacyKey = randomBytes(32);
  private records = new Map<string, RateLimitRecord>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Purge expired pseudonymous buckets promptly without running a tight timer.
    const cleanupIntervalMs = Math.max(
      1000,
      Math.min(env.rateLimitWindowSeconds * 1000, 60 * 1000)
    );
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Evaluates if a user has exceeded their rate limit.
   */
  public isRateLimited(identity: RateLimitIdentity): boolean {
    // Exempt administrators from rate limiting
    if (typeof identity === 'number' && env.adminUserIds.has(identity)) {
      return false;
    }

    const identityValue =
      typeof identity === 'number' ? `user:${identity}` : `sender_chat:${identity.id}`;
    const anonymousKey = createHmac('sha256', this.privacyKey)
      .update(identityValue)
      .digest('hex');
    const now = Date.now();
    const windowMs = env.rateLimitWindowSeconds * 1000;
    const record = this.records.get(anonymousKey) || { timestamps: [] };

    // Filter out timestamps outside the active window
    const recent = record.timestamps.filter((t) => now - t < windowMs);

    if (recent.length >= env.rateLimitMaxMessages) {
      this.records.set(anonymousKey, { timestamps: recent });
      return true;
    }

    recent.push(now);
    this.records.set(anonymousKey, { timestamps: recent });
    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    const windowMs = env.rateLimitWindowSeconds * 1000;

    for (const [anonymousKey, record] of this.records.entries()) {
      const active = record.timestamps.filter((t) => now - t < windowMs);
      if (active.length === 0) {
        this.records.delete(anonymousKey);
      } else {
        this.records.set(anonymousKey, { timestamps: active });
      }
    }
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export const rateLimiter = new RateLimiter();

/**
 * Middleware enforcing in-memory rate limiting per user.
 */
export async function rateLimitMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const senderChatId = ctx.message?.sender_chat?.id;
  const identity: RateLimitIdentity | undefined = senderChatId
    ? { type: 'sender_chat', id: senderChatId }
    : ctx.from?.id;

  if (identity === undefined) {
    // Non-user updates (e.g., channel posts) proceed normally
    await next();
    return;
  }

  if (rateLimiter.isRateLimited(identity)) {
    logger.warn('Rate limit exceeded');
    await ctx.reply(
      '⚠️ You are sending messages too quickly. Please wait a few seconds before trying again.'
    );
    return;
  }

  await next();
}
