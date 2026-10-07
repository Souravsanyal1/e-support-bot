import { env } from '../config/env.config';
import { logger } from '../utils/logger';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface UserSession {
  userId: number;
  lastActive: number;
  messages: ChatMessage[];
}

class ConversationManager {
  private sessions = new Map<number, UserSession>();
  private allKnownUserIds = new Set<number>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically prune stale sessions every 10 minutes to maintain tiny memory footprint
    this.cleanupTimer = setInterval(() => {
      this.pruneStaleSessions();
    }, 10 * 60 * 1000);

    // Prevent interval timer from keeping Node process alive during graceful shutdown
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Retrieves conversation history for a given user.
   */
  public getHistory(userId: number): ChatMessage[] {
    const session = this.sessions.get(userId);
    if (!session) return [];

    // Check TTL
    const ttlMs = env.sessionTtlMinutes * 60 * 1000;
    if (Date.now() - session.lastActive > ttlMs) {
      this.sessions.delete(userId);
      return [];
    }

    return [...session.messages];
  }

  /**
   * Appends a message to the user's conversation history while maintaining sliding window.
   */
  public addMessage(userId: number, role: 'user' | 'model', text: string): void {
    this.allKnownUserIds.add(userId);

    let session = this.sessions.get(userId);
    const now = Date.now();

    if (!session) {
      session = {
        userId,
        lastActive: now,
        messages: [],
      };
      this.sessions.set(userId, session);
    }

    session.lastActive = now;
    session.messages.push({ role, text });

    // Enforce sliding window (e.g. max 6 user turns = 12 messages)
    const maxMessages = env.maxConversationHistory * 2;
    if (session.messages.length > maxMessages) {
      session.messages = session.messages.slice(session.messages.length - maxMessages);
    }
  }

  /**
   * Clears a specific user's conversation history.
   */
  public clearSession(userId: number): void {
    this.sessions.delete(userId);
  }

  /**
   * Clears all active conversation sessions in memory (useful for admin /reload).
   */
  public clearAllSessions(): number {
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }

  /**
   * Returns telemetry stats for administrative monitoring.
   */
  public getStats(): {
    activeSessions: number;
    totalTrackedUsers: number;
  } {
    return {
      activeSessions: this.sessions.size,
      totalTrackedUsers: this.allKnownUserIds.size,
    };
  }

  /**
   * Returns a copy of all known numeric user IDs for administrative broadcast.
   */
  public getAllKnownUserIds(): number[] {
    return Array.from(this.allKnownUserIds);
  }

  /**
   * Prunes sessions that have exceeded the inactivity TTL.
   */
  private pruneStaleSessions(): void {
    const now = Date.now();
    const ttlMs = env.sessionTtlMinutes * 60 * 1000;
    let prunedCount = 0;

    for (const [userId, session] of this.sessions.entries()) {
      if (now - session.lastActive > ttlMs) {
        this.sessions.delete(userId);
        prunedCount++;
      }
    }

    if (prunedCount > 0) {
      logger.debug(`Pruned ${prunedCount} expired conversation sessions`);
    }
  }

  /**
   * Clean up timer on application shutdown.
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export const conversationManager = new ConversationManager();
