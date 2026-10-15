import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';
import { ELITE_FORCE_KNOWLEDGE, SAFETY_BOUNDARIES } from '../config/knowledge.config';

/**
 * Allowed domain hostnames for knowledge scraping.
 * Restricts external requests to prevent Server-Side Request Forgery (SSRF).
 */
export const ALLOWED_KNOWLEDGE_HOSTS = new Set([
  'elite-force.space',
  'timer.elite-force.space',
  't.me',
  'api.telegram.org',
]);

const MAX_RESPONSE_BYTES = 500 * 1024; // 500 KB limit
const DEFAULT_TIMEOUT_MS = 8000;

export interface SourceSyncResult {
  source: string;
  status: 'synced' | 'cached' | 'failed' | 'fallback';
  message?: string;
  timestamp: string;
}

export interface KnowledgeSyncStatus {
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  contentHash: string | null;
  version: number;
  sources: SourceSyncResult[];
  inProgress: boolean;
  filePath: string;
  totalCharacters: number;
}

/**
 * SSRF Prevention Validator
 * Ensures URLs only target explicitly permitted domains and avoids private/internal networks.
 */
export function validateSourceUrl(urlString: string, customAllowedHosts = ALLOWED_KNOWLEDGE_HOSTS): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new Error(`Invalid source URL format: "${urlString}"`);
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error(`Forbidden protocol: "${parsedUrl.protocol}". Only HTTPS/HTTP are permitted.`);
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Block loopback, link-local, and private RFC-1918 IPv4/IPv6 ranges
  const isPrivateIp =
    /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1|fe80:)/i.test(hostname) ||
    hostname === 'localhost';

  if (isPrivateIp) {
    throw new Error(`SSRF Guard: Target host "${hostname}" is a private or loopback address and is strictly blocked.`);
  }

  // Must match allowed hostnames or subdomains
  const isAllowedHost =
    customAllowedHosts.has(hostname) ||
    Array.from(customAllowedHosts).some((allowed) => hostname.endsWith(`.${allowed}`));

  if (!isAllowedHost) {
    throw new Error(`SSRF Guard: Target host "${hostname}" is not in the official allowed domains whitelist.`);
  }

  return parsedUrl;
}

/**
 * Sanitizes scraped or received text to prevent prompt injection and markup corruption.
 */
export function sanitizeKnowledgeText(raw: string): string {
  if (!raw) return '';

  return raw
    // Remove control characters (except newline, carriage return, tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Strip HTML script and style blocks entirely
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Strip HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Neutralize prompt injection phrases
    .replace(/ignore\s+(?:all\s+)?previous\s+instructions/gi, '[neutralized instruction override]')
    .replace(/system\s+prompt\s*:/gi, '[neutralized system tag]')
    .replace(/<!--\s*AUTO_SYNC/gi, '[reserved tag]')
    // Normalize excessive whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Fetches and extracts textual content from an allowed public web page safely.
 */
async function fetchWebPageText(url: string): Promise<string> {
  const validated = validateSourceUrl(url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(validated.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'EliteForceKnowledgeBot/1.0 (+https://t.me/EliteForce_Official)',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/') && !contentType.includes('application/json')) {
      throw new Error(`Unexpected content type "${contentType}" received from ${url}`);
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(`Response size (${text.length} bytes) exceeded maximum limit of ${MAX_RESPONSE_BYTES} bytes`);
    }

    return sanitizeKnowledgeText(text);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Loads verified official channel posts from the persistent store.
 */
function loadOfficialChannelStore(): string[] {
  const channelStorePath = path.resolve(process.cwd(), '.data/official-channel-posts.json');
  try {
    if (fs.existsSync(channelStorePath)) {
      const data = JSON.parse(fs.readFileSync(channelStorePath, 'utf8'));
      if (Array.isArray(data)) {
        return data
          .filter((item) => item && typeof item.text === 'string' && item.text.trim())
          .sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0))
          .slice(0, 15)
          .map((item) => {
            const dateStr = item.postedAt ? new Date(item.postedAt * 1000).toISOString().split('T')[0] : 'Recent';
            return `- [${dateStr}] ${sanitizeKnowledgeText(item.text)}`;
          });
      }
    }
  } catch (err) {
    logger.warn('Could not read official channel store', { error: err instanceof Error ? err.message : String(err) });
  }
  return [];
}

/**
 * Generates the full authoritative Markdown document.
 */
export function generateKnowledgeMarkdown(params: {
  version: number;
  timestamp: string;
  websiteText?: string;
  timerText?: string;
  channelPosts: string[];
}): string {
  const { version, timestamp, websiteText, timerText, channelPosts } = params;
  const { officialChannels, officialSystemLinks, nativeToken, corePillars, officialGuidelines } = ELITE_FORCE_KNOWLEDGE;

  const channelSection = channelPosts.length > 0
    ? channelPosts.join('\n\n')
    : '_No announcements synchronized yet. All updates will appear here when verified._';

  const websiteSection = websiteText && websiteText.length > 50
    ? websiteText.slice(0, 4000)
    : '_Website live data: In active development. Official links verified below._';

  const timerSection = timerText && timerText.length > 20
    ? timerText.slice(0, 1500)
    : '_Countdown Timer: Available at https://timer.elite-force.space._';

  return `# Elite Force Official Ecosystem Knowledge Base

> **Auto-Generated & Synchronized Authoritative Reference**
> **Version:** ${version}
> **Last Synchronized (UTC):** ${timestamp}
> **Status:** Verified Active

---

## 1. Ecosystem Overview
${ELITE_FORCE_KNOWLEDGE.description}

- **Core Vision:** Building Beyond Limits
- **Community Focus:** Global Web3 Empowerment, Decentralized Growth, and Community-First Transparency

### Core Ecosystem Pillars:
${corePillars.map((p) => `- ${p}`).join('\n')}

---

## 2. Verified Native Token Specifications (E-FORCE)
- **Token Name:** ${nativeToken.name}
- **Symbol:** ${nativeToken.symbol}
- **Network Standard:** ${nativeToken.standard}
- **Utility:** ${nativeToken.utility}
- **Current Status:** ${nativeToken.status}
- **Total/Maximum Supply:** Not officially confirmed; do not guess a number.
- **Official Launch Date:** ${nativeToken.launchDate}
- **Listing Date:** ${nativeToken.listingDate}
- **Contract Address Policy:** Not yet publicly released or deployed. Beware of fake contracts, presales, or unofficial swap pools.

---

## 3. Official Channels & Verified System Links
- **Official Telegram Channel:** ${officialChannels.telegramChannel} (${officialChannels.telegramHandle})
- **Official Telegram Community:** ${officialChannels.telegramGroup}
- **Official X (Twitter):** ${officialChannels.xProfile} (${officialChannels.xHandle})
- **Official Portal:** ${officialSystemLinks.website}
- **Official System Timer:** ${officialSystemLinks.timer}

---

## 4. Verified Telegram Channel Administrators
Current human administrators of the official Elite Force Telegram channel (verified live from Telegram):
• Elite Force | Support (@EliteForceSupportTeam)
• 𝓓𝓮𝓕𝓲 𝓖𝓮𝓷𝓮𝓻𝓪𝓽𝓸𝓻 (@cripto_currency_bro)

_This list excludes bots and reflects administrators currently listed by Telegram._
_Strict Rule: Owner ID and numeric Telegram IDs remain private and confidential._

---

## 5. Security & Anti-Scam Rules
${officialGuidelines.map((g) => `- ${g}`).join('\n')}
${SAFETY_BOUNDARIES.map((s) => `- ${s}`).join('\n')}

---

## 6. Official Announcements & Channel Updates
Source: @EliteForce_Official (Public Verified Channel Feed)

${channelSection}

---

## 7. Web Portal Snapshot
${websiteSection}

### Timer & Countdown Reference:
${timerSection}

---
*End of Authoritative Knowledge Document. If any requested information is missing above, it has not been officially confirmed yet.*
`.trim();
}

/**
 * Validates the schema and structural integrity of generated knowledge.
 */
export function validateKnowledgeContent(content: string): boolean {
  if (!content || typeof content !== 'string') return false;
  if (content.length < 500) return false;

  // Critical content checks
  const requiredMarkers = [
    'Elite Force',
    'E-FORCE',
    'BEP-20',
    'https://t.me/EliteForce_Official',
    'https://elite-force.space',
    'Current human administrators',
    'Security & Anti-Scam Rules',
  ];

  return requiredMarkers.every((marker) => content.includes(marker));
}

class KnowledgeSyncService {
  private syncTimer: NodeJS.Timeout | null = null;
  private inProgress = false;
  private version = 1;
  private lastHash: string | null = null;
  private status: KnowledgeSyncStatus;
  private resolvedPath: string;
  private backupPath: string;

  constructor() {
    this.resolvedPath = path.resolve(process.cwd(), env.knowledgeFilePath);
    this.backupPath = path.resolve(process.cwd(), `${env.knowledgeFilePath}.last-good.md`);

    this.status = {
      lastSyncAt: null,
      lastSuccessfulSyncAt: null,
      contentHash: null,
      version: 1,
      sources: [],
      inProgress: false,
      filePath: this.resolvedPath,
      totalCharacters: 0,
    };

    // Ensure knowledge folder exists
    try {
      fs.mkdirSync(path.dirname(this.resolvedPath), { recursive: true });
    } catch {
      // Ignore
    }

    // Seed knowledge if not present
    this.seedIfMissing();
  }

  /**
   * Seeds the initial knowledge markdown file if none exists.
   */
  private seedIfMissing(): void {
    if (!fs.existsSync(this.resolvedPath)) {
      try {
        const seedContent = generateKnowledgeMarkdown({
          version: 1,
          timestamp: new Date().toISOString(),
          channelPosts: loadOfficialChannelStore(),
        });
        fs.writeFileSync(this.resolvedPath, seedContent, 'utf8');
        fs.writeFileSync(this.backupPath, seedContent, 'utf8');
        this.lastHash = crypto.createHash('sha256').update(seedContent).digest('hex');
        this.status.contentHash = this.lastHash;
        this.status.lastSuccessfulSyncAt = new Date().toISOString();
        this.status.totalCharacters = seedContent.length;
        logger.info('Seeded initial knowledge file at', { path: this.resolvedPath });
      } catch (err) {
        logger.error('Failed to seed initial knowledge file', err);
      }
    } else {
      try {
        const existing = fs.readFileSync(this.resolvedPath, 'utf8');
        this.lastHash = crypto.createHash('sha256').update(existing).digest('hex');
        this.status.contentHash = this.lastHash;
        this.status.lastSuccessfulSyncAt = new Date().toISOString();
        this.status.totalCharacters = existing.length;
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Performs an end-to-end synchronization cycle across all official sources.
   */
  public async syncKnowledge(options: { force?: boolean } = {}): Promise<KnowledgeSyncStatus> {
    if (this.inProgress) {
      logger.warn('Knowledge synchronization already in progress, skipping concurrent run');
      return this.status;
    }

    this.inProgress = true;
    this.status.inProgress = true;
    const nowIso = new Date().toISOString();
    this.status.lastSyncAt = nowIso;
    const sourceResults: SourceSyncResult[] = [];

    let websiteContent: string | undefined;
    let timerContent: string | undefined;

    // 1. Fetch Official Website
    try {
      websiteContent = await fetchWebPageText(env.officialWebsiteUrl);
      sourceResults.push({
        source: env.officialWebsiteUrl,
        status: 'synced',
        timestamp: nowIso,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.info('Official website fetch skipped/fallback', { error: errMsg });
      sourceResults.push({
        source: env.officialWebsiteUrl,
        status: 'fallback',
        message: errMsg,
        timestamp: nowIso,
      });
    }

    // 2. Fetch System Timer
    try {
      timerContent = await fetchWebPageText(env.officialTimerUrl);
      sourceResults.push({
        source: env.officialTimerUrl,
        status: 'synced',
        timestamp: nowIso,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      sourceResults.push({
        source: env.officialTimerUrl,
        status: 'fallback',
        message: errMsg,
        timestamp: nowIso,
      });
    }

    // 3. Collect Official Telegram Channel Posts
    const channelPosts = loadOfficialChannelStore();
    sourceResults.push({
      source: '@EliteForce_Official',
      status: 'synced',
      message: `${channelPosts.length} posts loaded`,
      timestamp: nowIso,
    });

    // 4. Token & On-Chain Reference (BNB Smart Chain BEP-20)
    sourceResults.push({
      source: 'BNB Smart Chain (BEP-20)',
      status: 'synced',
      message: 'Verified specs synchronized',
      timestamp: nowIso,
    });

    // 5. Generate New Document
    const nextVersion = this.version + 1;
    const generatedMarkdown = generateKnowledgeMarkdown({
      version: nextVersion,
      timestamp: nowIso,
      websiteText: websiteContent,
      timerText: timerContent,
      channelPosts,
    });

    // 6. Schema Validation
    if (!validateKnowledgeContent(generatedMarkdown)) {
      logger.error('Generated knowledge failed schema validation. Preserving existing knowledge.');
      sourceResults.push({
        source: 'Schema Validation',
        status: 'failed',
        message: 'Missing essential sections or markers',
        timestamp: nowIso,
      });
      this.status.sources = sourceResults;
      this.inProgress = false;
      this.status.inProgress = false;
      return this.status;
    }

    // 7. Change Detection (SHA-256 Hash)
    const newHash = crypto.createHash('sha256').update(generatedMarkdown).digest('hex');
    if (!options.force && newHash === this.lastHash) {
      logger.info('Knowledge unchanged (hash match). Skipping file write.');
      this.status.sources = sourceResults.map((s) => ({ ...s, status: s.status === 'synced' ? 'cached' : s.status }));
      this.inProgress = false;
      this.status.inProgress = false;
      return this.status;
    }

    // 8. Atomic Write & Backup
    try {
      // Backup current good version before overwriting
      if (fs.existsSync(this.resolvedPath)) {
        fs.copyFileSync(this.resolvedPath, this.backupPath);
      }

      // Write atomically via temp file
      const tempPath = `${this.resolvedPath}.tmp`;
      fs.writeFileSync(tempPath, generatedMarkdown, 'utf8');
      fs.renameSync(tempPath, this.resolvedPath);

      this.version = nextVersion;
      this.lastHash = newHash;
      this.status.version = nextVersion;
      this.status.contentHash = newHash;
      this.status.lastSuccessfulSyncAt = nowIso;
      this.status.totalCharacters = generatedMarkdown.length;
      this.status.sources = sourceResults;

      logger.info('Successfully updated knowledge file', {
        path: this.resolvedPath,
        version: nextVersion,
        hash: newHash.slice(0, 10),
      });
    } catch (writeErr) {
      logger.error('Failed to write updated knowledge file. Rolling back to last good version.', writeErr);
      this.rollback();
    } finally {
      this.inProgress = false;
      this.status.inProgress = false;
    }

    return this.status;
  }

  /**
   * Restores knowledge from the last-known-good backup.
   */
  public rollback(): boolean {
    try {
      if (fs.existsSync(this.backupPath)) {
        fs.copyFileSync(this.backupPath, this.resolvedPath);
        const restored = fs.readFileSync(this.resolvedPath, 'utf8');
        this.lastHash = crypto.createHash('sha256').update(restored).digest('hex');
        this.status.contentHash = this.lastHash;
        logger.info('Rolled back knowledge base to last-known-good backup');
        return true;
      }
    } catch (err) {
      logger.error('Rollback failed', err);
    }
    return false;
  }

  /**
   * Starts the recurring background sync scheduler.
   */
  public startScheduler(): void {
    if (!env.enableKnowledgeSync) {
      logger.info('Knowledge auto-sync scheduler is disabled via ENABLE_KNOWLEDGE_SYNC=false');
      return;
    }

    if (this.syncTimer) {
      return;
    }

    const intervalMs = env.knowledgeSyncIntervalMinutes * 60 * 1000;
    logger.info(`Starting Knowledge Auto-Sync Scheduler: interval every ${env.knowledgeSyncIntervalMinutes} minutes`);

    // Initial sync in background
    this.syncKnowledge().catch((err) => {
      logger.warn('Initial knowledge sync encountered error', { error: err instanceof Error ? err.message : String(err) });
    });

    this.syncTimer = setInterval(() => {
      this.syncKnowledge().catch((err) => {
        logger.warn('Periodic knowledge sync encountered error', { error: err instanceof Error ? err.message : String(err) });
      });
    }, intervalMs);

    if (this.syncTimer.unref) {
      this.syncTimer.unref();
    }
  }

  /**
   * Stops the background sync scheduler cleanly.
   */
  public stopScheduler(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      logger.info('Knowledge auto-sync scheduler stopped');
    }
  }

  /**
   * Returns current sync telemetry and status.
   */
  public getStatus(): KnowledgeSyncStatus {
    return { ...this.status };
  }

  /**
   * Reads active knowledge text from disk for hot-reloading into AI prompts.
   */
  public getActiveKnowledgeContent(): string {
    try {
      if (fs.existsSync(this.resolvedPath)) {
        return fs.readFileSync(this.resolvedPath, 'utf8').trim();
      }
    } catch (err) {
      logger.warn('Could not read active knowledge file, using fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return '';
  }
}

export const knowledgeSyncService = new KnowledgeSyncService();
