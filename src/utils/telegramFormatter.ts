/**
 * Telegram Rich Text & Animated Custom Emoji Formatter
 *
 * Supports bold, italic, code, links, and animated Telegram custom emojis
 * from the official Elite Force emoji pack: https://t.me/addemoji/EliteForceOFC
 */

export const ELITE_FORCE_CUSTOM_EMOJIS: Record<string, string> = {
  '🧡': '6201987489012394141',
  '🤩': '6201982992181634064',
  '🤴': '6201844956227707404',
  '🤑': '6201954623922644588',
  '🤗': '6201686166991806588',
  '😘': '6201819293798113617',
  '🍒': '6201765327534039799',
  '🎄': '6201737526210732162',
  '😶🌫️': '6201653654089377041',
  '😶‍🌫️': '6201653654089377041',
};

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
 * Converts standard Markdown (bold, italic, code, links) to Telegram-compliant HTML,
 * and wraps custom emojis with <tg-emoji emoji-id="..."> tags for animated display.
 */
export function formatToTelegramHtml(markdownText: string): string {
  if (!markdownText) return '';

  // 1. Escape raw HTML entities first to prevent malformed tags
  let html = escapeHtml(markdownText);

  // 2. Bold: **bold**
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // 3. Italic: *italic* or _italic_
  html = html.replace(/(^|[^\*])\*([^\*\s][^\*]*?[^\*\s]|\S)\*(?!\*)/g, '$1<i>$2</i>');
  html = html.replace(/(^|[^_])_([^_]+?)_(?!_)/g, '$1<i>$2</i>');

  // 5. Monospace code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 6. Links: [label](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2">$1</a>');

  // 7. Inject Telegram custom animated emojis from EliteForceOFC pack
  for (const [emojiChar, customEmojiId] of Object.entries(ELITE_FORCE_CUSTOM_EMOJIS)) {
    if (html.includes(emojiChar)) {
      html = html.split(emojiChar).join(`<tg-emoji emoji-id="${customEmojiId}">${emojiChar}</tg-emoji>`);
    }
  }

  return html;
}

/**
 * Strips <tg-emoji> tags while preserving the fallback emoji character.
 * Used if Telegram API rejects custom emoji IDs for non-premium bots.
 */
export function stripCustomEmojiTags(html: string): string {
  return html.replace(/<tg-emoji emoji-id="[^"]*">(.*?)<\/tg-emoji>/gi, '$1');
}

/**
 * Strips all HTML tags to produce pure plain text.
 * Used as a rock-solid final fallback if HTML parsing fails.
 */
export function stripAllHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
