/**
 * Telegram Rich Text Formatter & Animated Custom Emoji Engine
 *
 * Provides two delivery strategies:
 *
 * Strategy A — HTML Mode (for formatted messages with bold, italic, links, code):
 *   Converts Markdown → Telegram HTML + injects <tg-emoji> animated tags.
 *
 * Strategy B — Entity Mode (for plain text messages):
 *   Keeps raw plain text unchanged, computes MessageEntity[] with type "custom_emoji"
 *   using correct UTF-16 code-unit offsets as required by the Telegram Bot API.
 *
 * Official packs included:
 *   • Elite Force Official: https://t.me/addemoji/EliteForceOFC
 *   • TG iOS & macOS Icons: https://t.me/addemoji/tgmacicons
 */

import { CUSTOM_EMOJI_MAP } from '../config/emoji.config';

// ─── Shared Emoji Regex (built once at module load, sorted longest-first) ─────

const SORTED_EMOJI_KEYS = Object.keys(CUSTOM_EMOJI_MAP).sort(
  (a, b) => b.length - a.length
);

const ESCAPED_EMOJI_PATTERN = SORTED_EMOJI_KEYS.map((k) =>
  k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
).join('|');

const CUSTOM_EMOJI_REGEX = new RegExp(ESCAPED_EMOJI_PATTERN, 'g');

// ─── Telegram MessageEntity type ──────────────────────────────────────────────

export interface TelegramEntity {
  type: 'bold' | 'italic' | 'code' | 'pre' | 'text_link' | 'custom_emoji' | string;
  offset: number;
  length: number;
  url?: string;
  custom_emoji_id?: string;
}

// ─── UTF-16 Utilities (required by Telegram Bot API) ─────────────────────────

/**
 * Returns the UTF-16 length (in code units) of a string.
 * JS strings are already UTF-16 — emoji like 🚀 use surrogate pairs → .length = 2.
 */
function utf16Length(text: string): number {
  return text.length; // JS strings are already UTF-16, so .length IS utf-16 length
}

// ─── Strategy B: Entity-Based Plain Text ──────────────────────────────────────

/**
 * Result from buildMessageWithEntities():
 * - text  : the unchanged plain text (emojis stay as Unicode characters)
 * - entities: MessageEntity[] for Telegram Bot API (type "custom_emoji" entries with
 *             correct UTF-16 offsets)
 */
export interface MessageWithEntities {
  text: string;
  entities: TelegramEntity[];
}

/**
 * Scans a plain text string for registered custom emojis and builds a
 * MessageEntity[] array using correct UTF-16 offsets.
 *
 * The raw text is returned unchanged — Telegram renders the entities
 * on top of it (replacing Unicode emojis with animated custom versions).
 *
 * Use this when the message has no Markdown/HTML formatting.
 *
 * @example
 * const { text, entities } = buildMessageWithEntities("🚀 Welcome to Elite Force!\n💎 E-FORCE coming soon.");
 * await ctx.api.sendMessage(chatId, text, { entities });
 */
export function buildMessageWithEntities(plainText: string): MessageWithEntities {
  const entities: TelegramEntity[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  CUSTOM_EMOJI_REGEX.lastIndex = 0;

  while ((match = CUSTOM_EMOJI_REGEX.exec(plainText)) !== null) {
    const matchedEmoji = match[0];
    const customEmojiId = CUSTOM_EMOJI_MAP[matchedEmoji];

    if (!customEmojiId) continue;

    // match.index is the JS char-index into the UTF-16 string.
    // For Telegram we use match.index directly as offset because JS strings
    // ARE UTF-16 internally, so match.index is already a UTF-16 code unit offset.
    const offset = match.index;
    const length = utf16Length(matchedEmoji); // JS .length = UTF-16 code units

    entities.push({
      type: 'custom_emoji',
      offset,
      length,
      custom_emoji_id: customEmojiId,
    });
  }

  return { text: plainText, entities };
}

/**
 * Parses a Markdown-formatted text and extracts formatting entities
 * (bold, italic, code, text_link) along with custom emoji entities.
 *
 * Returns the stripped plain text and combined entities array for
 * Telegram Bot API delivery (no parse_mode needed).
 *
 * Markdown supported: **bold**, *italic*, _italic_, `code`, [label](url)
 */
export function buildFormattedMessageWithEntities(markdownText: string): MessageWithEntities {
  const entities: TelegramEntity[] = [];
  let plainText = '';
  let utf16Cursor = 0; // tracks current UTF-16 position in plainText

  // Tokenizer: split by markdown patterns
  const tokenPattern =
    /\*\*(.+?)\*\*|(?<![*])\*([^*\s][^*]*?[^*\s]|\S)\*(?![*])|_([^_]+?)_(?!_)|`([^`]+?)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gs;

  let lastIndex = 0;

  let m: RegExpExecArray | null;
  tokenPattern.lastIndex = 0;

  while ((m = tokenPattern.exec(markdownText)) !== null) {
    // Append any plain segment before this match
    const before = markdownText.slice(lastIndex, m.index);
    if (before) {
      plainText += before;
      utf16Cursor += utf16Length(before);
    }

    if (m[1] !== undefined) {
      // **bold**
      const inner = m[1];
      entities.push({ type: 'bold', offset: utf16Cursor, length: utf16Length(inner) });
      plainText += inner;
      utf16Cursor += utf16Length(inner);
    } else if (m[2] !== undefined) {
      // *italic*
      const inner = m[2];
      entities.push({ type: 'italic', offset: utf16Cursor, length: utf16Length(inner) });
      plainText += inner;
      utf16Cursor += utf16Length(inner);
    } else if (m[3] !== undefined) {
      // _italic_
      const inner = m[3];
      entities.push({ type: 'italic', offset: utf16Cursor, length: utf16Length(inner) });
      plainText += inner;
      utf16Cursor += utf16Length(inner);
    } else if (m[4] !== undefined) {
      // `code`
      const inner = m[4];
      entities.push({ type: 'code', offset: utf16Cursor, length: utf16Length(inner) });
      plainText += inner;
      utf16Cursor += utf16Length(inner);
    } else if (m[5] !== undefined && m[6] !== undefined) {
      // [label](url)
      const label = m[5];
      const url = m[6];
      entities.push({
        type: 'text_link',
        offset: utf16Cursor,
        length: utf16Length(label),
        url,
      });
      plainText += label;
      utf16Cursor += utf16Length(label);
    }

    lastIndex = m.index + m[0].length;
  }

  // Append remaining text after last match
  const tail = markdownText.slice(lastIndex);
  if (tail) {
    plainText += tail;
    utf16Cursor += utf16Length(tail);
  }

  // Now scan the assembled plainText for custom emojis and add entities
  CUSTOM_EMOJI_REGEX.lastIndex = 0;
  let emojiMatch: RegExpExecArray | null;
  while ((emojiMatch = CUSTOM_EMOJI_REGEX.exec(plainText)) !== null) {
    const emoji = emojiMatch[0];
    const customEmojiId = CUSTOM_EMOJI_MAP[emoji];
    if (!customEmojiId) continue;

    entities.push({
      type: 'custom_emoji',
      offset: emojiMatch.index,
      length: utf16Length(emoji),
      custom_emoji_id: customEmojiId,
    });
  }

  // Sort entities by offset so Telegram receives them in order
  entities.sort((a, b) => a.offset - b.offset);

  return { text: plainText, entities };
}

// ─── Strategy A: HTML Mode helpers (retained for formatted messages) ──────────

/**
 * Escapes characters that have special meaning in Telegram HTML.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Converts Markdown to Telegram HTML and wraps registered emojis with
 * <tg-emoji emoji-id="..."> tags for animated display.
 *
 * Use when the message contains Markdown formatting (bold, italic, links, code).
 */
export function formatToTelegramHtml(markdownText: string): string {
  if (!markdownText) return '';

  // 1. Protect URLs by replacing them with unique placeholders
  const urlPlaceholders: string[] = [];
  let text = markdownText.replace(/(https?:\/\/[^\s\)]+)/g, (url) => {
    urlPlaceholders.push(url);
    return `___URL_TOKEN_${urlPlaceholders.length - 1}___`;
  });

  // 2. Escape raw HTML entities
  let html = escapeHtml(text);

  // 3. Bold: **bold**
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // 4. Italic: *italic* or _italic_ (only on word boundaries)
  html = html.replace(/(^|[^*])\*([^*\s][^*]*?[^*\s]|\S)\*(?!\*)/g, '$1<i>$2</i>');
  html = html.replace(/\b_([^_]+?)_\b/g, '<i>$1</i>');

  // 5. Code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 6. Markdown Links: [label](url-placeholder)
  html = html.replace(/\[([^\]]+)\]\((___URL_TOKEN_(\d+)___)\)/g, (_m, label, _full, idx) => {
    const rawUrl = urlPlaceholders[Number(idx)];
    return `<a href="${rawUrl}">${label}</a>`;
  });

  // 7. Restore remaining URLs
  html = html.replace(/___URL_TOKEN_(\d+)___/g, (_m, idx) => {
    return urlPlaceholders[Number(idx)];
  });

  // 8. Animated custom emojis: single-pass replacement
  CUSTOM_EMOJI_REGEX.lastIndex = 0;
  html = html.replace(CUSTOM_EMOJI_REGEX, (match) => {
    const id = CUSTOM_EMOJI_MAP[match];
    return id ? `<tg-emoji emoji-id="${id}">${match}</tg-emoji>` : match;
  });

  return html;
}

/**
 * Strips <tg-emoji> tags, keeping the fallback Unicode emoji character.
 */
export function stripCustomEmojiTags(html: string): string {
  return html.replace(/<tg-emoji emoji-id="[^"]*">(.*?)<\/tg-emoji>/gi, '$1');
}

/**
 * Strips all HTML tags to produce pure plain text (final fallback).
 */
export function stripAllHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
