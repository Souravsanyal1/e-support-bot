import { Context, NextFunction } from 'grammy';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

interface RateLimitRecord {
  timestamps: number[];
}

class RateLimiter {
  private records = new Map<number, RateLimitRecord>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired buckets every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Evaluates if a user has exceeded their rate limit.
   */
  public isRateLimited(userId: number): boolean {
    // Exempt administrators from rate limiting
    if (env.adminUserIds.has(userId)) {
      return false;
    }

    const now = Date.now();
    const windowMs = env.rateLimitWindowSeconds * 1000;
    const record = this.records.get(userId) || { timestamps: [] };

    // Filter out timestamps outside the active window
    const recent = record.timestamps.filter((t) => now - t < windowMs);

    if (recent.length >= env.rateLimitMaxMessages) {
      this.records.set(userId, { timestamps: recent });
      return true;
    }

    recent.push(now);
    this.records.set(userId, { timestamps: recent });
    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    const windowMs = env.rateLimitWindowSeconds * 1000;

    for (const [userId, record] of this.records.entries()) {
      const active = record.timestamps.filter((t) => now - t < windowMs);
      if (active.length === 0) {
        this.records.delete(userId);
      } else {
        this.records.set(userId, { timestamps: active });
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
  const userId = ctx.from?.id;

  if (!userId) {
    // Non-user updates (e.g., channel posts) proceed normally
    await next();
    return;
  }

  if (rateLimiter.isRateLimited(userId)) {
    logger.warn('Rate limit exceeded');
    await ctx.reply(
      '⚠️ You are sending messages too quickly. Please wait a few seconds before trying again.'
    );
    return;
  }

  await next();
}
