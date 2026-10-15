/**
 * Runtime language mode manager.
 *
 * Controls whether the language filter accepts all languages or English only.
 * State is in-memory only (resets to default on restart).
 * Default: 'english' (strict English-only mode).
 */

export type LanguageMode = 'english' | 'all';

class LanguageModeManager {
  private static instance: LanguageModeManager;
  private mode: LanguageMode = 'english';
  private changedBy?: number;
  private changedAt?: string;

  private constructor() {}

  public static getInstance(): LanguageModeManager {
    if (!LanguageModeManager.instance) {
      LanguageModeManager.instance = new LanguageModeManager();
    }
    return LanguageModeManager.instance;
  }

  /** Returns current language mode */
  public getMode(): LanguageMode {
    return this.mode;
  }

  /** Returns true if all languages are currently allowed */
  public isAllLanguagesAllowed(): boolean {
    return this.mode === 'all';
  }

  /** Sets mode to allow all languages */
  public setAll(adminId?: number): void {
    this.mode = 'all';
    this.changedBy = adminId;
    this.changedAt = new Date().toISOString();
  }

  /** Sets mode to English-only (default) */
  public setEnglishOnly(adminId?: number): void {
    this.mode = 'english';
    this.changedBy = adminId;
    this.changedAt = new Date().toISOString();
  }

  /** Returns status info for admin display */
  public getStatus(): { mode: LanguageMode; changedBy?: number; changedAt?: string } {
    return {
      mode: this.mode,
      changedBy: this.changedBy,
      changedAt: this.changedAt,
    };
  }
}

export const languageModeManager = LanguageModeManager.getInstance();
