import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export type BotStatus = 'active' | 'temporary_disabled' | 'permanently_disabled';

export interface BotState {
  status: BotStatus;
  disabledAt?: string;
  reactivateAt?: string;
  durationMinutes?: number;
  disabledBy?: number;
  reason?: string;
  updatedAt: string;
}

export class BotStateManager {
  private static instance: BotStateManager;
  private stateFilePath: string;
  private state: BotState;
  private timer: NodeJS.Timeout | null = null;
  private onReactivateCallback?: () => Promise<void> | void;

  private constructor(customFilePath?: string) {
    this.stateFilePath =
      customFilePath || path.resolve(process.cwd(), 'data', 'bot_state.json');
    this.state = this.loadState();
    this.restoreTimerIfNeeded();
  }

  public static getInstance(customFilePath?: string): BotStateManager {
    if (!BotStateManager.instance) {
      BotStateManager.instance = new BotStateManager(customFilePath);
    }
    return BotStateManager.instance;
  }

  /**
   * Resets singleton instance (primarily for testing).
   */
  public static resetInstanceForTesting(customFilePath?: string): BotStateManager {
    if (BotStateManager.instance) {
      BotStateManager.instance.destroy();
    }
    BotStateManager.instance = new BotStateManager(customFilePath);
    return BotStateManager.instance;
  }

  public setOnReactivateCallback(cb: () => Promise<void> | void): void {
    this.onReactivateCallback = cb;
  }

  /**
   * Checks whether normal user-facing bot operations (AI responses, commands) are enabled.
   */
  public isUserFacingActive(): boolean {
    return this.state.status === 'active';
  }

  public getState(): Readonly<BotState> {
    return { ...this.state };
  }

  /**
   * Disables normal bot operations (temporarily with a timer or permanently).
   */
  public turnOff(options: {
    permanent?: boolean;
    reactivateAt?: Date;
    durationMinutes?: number;
    disabledBy?: number;
    reason?: string;
  }): BotState {
    this.clearTimer();

    const isPermanent = !!options.permanent;
    const nowIso = new Date().toISOString();

    this.state = {
      status: isPermanent ? 'permanently_disabled' : 'temporary_disabled',
      disabledAt: nowIso,
      reactivateAt: !isPermanent && options.reactivateAt ? options.reactivateAt.toISOString() : undefined,
      durationMinutes: options.durationMinutes,
      disabledBy: options.disabledBy,
      reason: options.reason || (isPermanent ? 'Permanent admin shutdown' : 'Temporary admin shutdown'),
      updatedAt: nowIso,
    };

    this.saveState();

    logger.info('Bot state changed to OFF', {
      status: this.state.status,
      reactivateAt: this.state.reactivateAt,
      disabledBy: this.state.disabledBy,
    });

    if (!isPermanent && options.reactivateAt) {
      this.scheduleReactivation(options.reactivateAt);
    }

    return this.getState();
  }

  /**
   * Reactivates the bot immediately and clears any pending timers.
   */
  public turnOn(adminId?: number): BotState {
    this.clearTimer();

    const nowIso = new Date().toISOString();
    this.state = {
      status: 'active',
      disabledAt: undefined,
      reactivateAt: undefined,
      durationMinutes: undefined,
      disabledBy: adminId,
      reason: undefined,
      updatedAt: nowIso,
    };

    this.saveState();

    logger.info('Bot state changed to ACTIVE (ON)', {
      activatedBy: adminId,
    });

    return this.getState();
  }

  /**
   * Cancels a pending scheduled reactivation timer without turning the bot back on.
   */
  public cancelSchedule(adminId?: number): BotState {
    this.clearTimer();

    const nowIso = new Date().toISOString();
    this.state = {
      ...this.state,
      reactivateAt: undefined,
      durationMinutes: undefined,
      reason: 'Scheduled reactivation cancelled by admin',
      updatedAt: nowIso,
    };

    this.saveState();

    logger.info('Bot scheduled reactivation cancelled', {
      cancelledBy: adminId,
      currentStatus: this.state.status,
    });

    return this.getState();
  }

  /**
   * Schedules a timer to reactivate the bot at a specific date.
   */
  private scheduleReactivation(targetDate: Date): void {
    this.clearTimer();

    const delayMs = targetDate.getTime() - Date.now();
    if (delayMs <= 0) {
      // Already expired, reactivate immediately
      this.turnOn();
      return;
    }

    // Node.js setTimeout supports up to ~24.8 days (2147483647 ms)
    const safeDelayMs = Math.min(delayMs, 2147483647);

    this.timer = setTimeout(async () => {
      logger.info('Scheduled timer expired: Automatically reactivating bot now...');
      this.turnOn();
      if (this.onReactivateCallback) {
        try {
          await this.onReactivateCallback();
        } catch (err) {
          logger.error('Error executing onReactivate callback', err);
        }
      }
    }, safeDelayMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Restores scheduled timer or handles expired timer upon startup / restart.
   */
  private restoreTimerIfNeeded(): void {
    if (this.state.status === 'temporary_disabled') {
      if (this.state.reactivateAt) {
        const targetTime = new Date(this.state.reactivateAt).getTime();
        const now = Date.now();

        if (targetTime <= now) {
          logger.warn('Previous scheduled reactivation time has already passed during downtime. Reactivating bot now.');
          this.turnOn();
        } else {
          logger.info('Restoring scheduled reactivation timer from persistent state', {
            reactivateAt: this.state.reactivateAt,
            remainingMinutes: Math.round((targetTime - now) / 60000),
          });
          this.scheduleReactivation(new Date(this.state.reactivateAt));
        }
      }
    }
  }

  private loadState(): BotState {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<BotState>;
        if (
          parsed.status === 'active' ||
          parsed.status === 'temporary_disabled' ||
          parsed.status === 'permanently_disabled'
        ) {
          return {
            status: parsed.status,
            disabledAt: parsed.disabledAt,
            reactivateAt: parsed.reactivateAt,
            durationMinutes: parsed.durationMinutes,
            disabledBy: parsed.disabledBy,
            reason: parsed.reason,
            updatedAt: parsed.updatedAt || new Date().toISOString(),
          };
        }
      }
    } catch (err) {
      logger.warn('Could not read persistent bot state file; initializing active state', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      status: 'active',
      updatedAt: new Date().toISOString(),
    };
  }

  private saveState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed to write persistent bot state file', err);
    }
  }

  public destroy(): void {
    this.clearTimer();
  }
}

export const botStateManager = BotStateManager.getInstance();
