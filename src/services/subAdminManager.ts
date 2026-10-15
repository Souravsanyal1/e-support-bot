import fs from 'fs';
import path from 'path';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

export interface SubAdminEntry {
  userId: number;
  username?: string;
  addedBy: number;
  addedAt: string;
  note?: string;
}

interface SubAdminData {
  subAdmins: SubAdminEntry[];
}

export class SubAdminManager {
  private static instance: SubAdminManager;
  private filePath: string;
  private subAdmins: Map<number, SubAdminEntry> = new Map();

  private constructor(customFilePath?: string) {
    this.filePath =
      customFilePath || path.resolve(process.cwd(), 'data', 'sub_admins.json');
    this.load();
  }

  public static getInstance(customFilePath?: string): SubAdminManager {
    if (!SubAdminManager.instance) {
      SubAdminManager.instance = new SubAdminManager(customFilePath);
    }
    return SubAdminManager.instance;
  }

  /**
   * Resets singleton instance (useful for testing).
   */
  public static resetInstanceForTesting(customFilePath?: string): SubAdminManager {
    SubAdminManager.instance = new SubAdminManager(customFilePath);
    return SubAdminManager.instance;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.save();
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data: SubAdminData = JSON.parse(raw);
      this.subAdmins.clear();
      if (Array.isArray(data.subAdmins)) {
        for (const entry of data.subAdmins) {
          if (entry && typeof entry.userId === 'number') {
            this.subAdmins.set(entry.userId, entry);
          }
        }
      }
    } catch (err) {
      logger.error('Failed to load sub_admins.json, initializing empty map', err);
      this.subAdmins.clear();
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: SubAdminData = {
        subAdmins: Array.from(this.subAdmins.values()),
      };
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      logger.error('Failed to save sub_admins.json', err);
    }
  }

  /**
   * Checks if a user is an active sub-admin.
   */
  public isSubAdmin(userId?: number): boolean {
    if (!userId) return false;
    return this.subAdmins.has(userId);
  }

  /**
   * Checks if a user is a primary admin (defined via environment configuration).
   */
  public isPrimaryAdmin(userId?: number): boolean {
    if (!userId) return false;
    return env.adminUserIds.has(userId);
  }

  /**
   * Adds a new sub-admin.
   */
  public addSubAdmin(
    userId: number,
    addedBy: number,
    note?: string,
    username?: string
  ): { success: boolean; message: string; entry?: SubAdminEntry } {
    if (isNaN(userId) || userId <= 0) {
      return { success: false, message: 'Invalid Telegram User ID provided.' };
    }

    if (this.isPrimaryAdmin(userId)) {
      return {
        success: false,
        message: `User ${userId} is already a Primary Administrator configured via environment.`,
      };
    }

    if (this.subAdmins.has(userId)) {
      return {
        success: false,
        message: `User ${userId} is already a Sub-Admin.`,
      };
    }

    const entry: SubAdminEntry = {
      userId,
      username: username?.replace(/^@/, '') || undefined,
      addedBy,
      addedAt: new Date().toISOString(),
      note: note?.trim() || undefined,
    };

    this.subAdmins.set(userId, entry);
    this.save();

    logger.info('Sub-admin added successfully', { userId, addedBy, note });
    return {
      success: true,
      message: `User ${userId} was successfully added as a Sub-Admin.`,
      entry,
    };
  }

  /**
   * Removes an existing sub-admin.
   */
  public removeSubAdmin(userId: number): { success: boolean; message: string } {
    if (this.isPrimaryAdmin(userId)) {
      return {
        success: false,
        message: `Cannot remove User ${userId} because they are a Primary Administrator configured in environment.`,
      };
    }

    if (!this.subAdmins.has(userId)) {
      return {
        success: false,
        message: `User ${userId} is not in the sub-admin list.`,
      };
    }

    this.subAdmins.delete(userId);
    this.save();

    logger.info('Sub-admin removed successfully', { userId });
    return {
      success: true,
      message: `User ${userId} was removed from the sub-admin list.`,
    };
  }

  /**
   * Returns all current sub-admins.
   */
  public listSubAdmins(): SubAdminEntry[] {
    return Array.from(this.subAdmins.values());
  }

  /**
   * Returns a merged set of all admin IDs (primary admins + sub-admins).
   */
  public getAllAdminIds(): Set<number> {
    const all = new Set<number>(env.adminUserIds);
    for (const id of this.subAdmins.keys()) {
      all.add(id);
    }
    return all;
  }
}

export const subAdminManager = {
  isSubAdmin: (userId?: number): boolean => SubAdminManager.getInstance().isSubAdmin(userId),
  isPrimaryAdmin: (userId?: number): boolean => SubAdminManager.getInstance().isPrimaryAdmin(userId),
  addSubAdmin: (
    userId: number,
    addedBy: number,
    note?: string,
    username?: string
  ) => SubAdminManager.getInstance().addSubAdmin(userId, addedBy, note, username),
  removeSubAdmin: (userId: number) => SubAdminManager.getInstance().removeSubAdmin(userId),
  listSubAdmins: (): SubAdminEntry[] => SubAdminManager.getInstance().listSubAdmins(),
  getAllAdminIds: (): Set<number> => SubAdminManager.getInstance().getAllAdminIds(),
};
