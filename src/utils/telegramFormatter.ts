/**
 * Telegram Rich Text & Animated Custom Emoji Formatter
 *
 * Supports bold, italic, code, links, and animated Telegram custom emojis
 * from official packs:
 * 1. Elite Force Official: https://t.me/addemoji/EliteForceOFC
 * 2. TG iOS & macOS Icons: https://t.me/addemoji/tgmacicons
 */

export const ALL_TELEGRAM_CUSTOM_EMOJIS: Record<string, string> = {
  // === Pack 1: Elite Force Official (https://t.me/addemoji/EliteForceOFC) ===
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

  // === Pack 2: TG iOS & macOS Icons (https://t.me/addemoji/tgmacicons) ===
  '✈️': '5258073068852485953',
  '✈': '5258073068852485953',
  '🔢': '5226513232549664618',
  '🖼': '5258050709252743821',
  '👤': '5258362837411045098',
  '⭐️': '5258185631355378853',
  '⭐': '5258185631355378853',
  '📂': '5258514780469075716',
  '📁': '5257965810634202885',
  '❌': '5258226313285607065',
  '⚽️': '5258169263235013408',
  '🐻': '5258145898612924124',
  '📝': '5257965174979042426',
  '🪙': '5258368777350816286',
  '⚡️': '5258152182150077732',
  '⚡': '5258152182150077732',
  '📖': '5258328383183396223',
  '🤖': '5258093637450866522',
  '💼': '5258260149037965799',
  '🗓': '5258105663359294787',
  '🤙': '5258337316715373336',
  '📸': '5258205968025525531',
  '📣': '5260268501515377807',
  '✅': '5260726538302660868',
  '⛓': '5260730055880876557',
  '🔗': '5260730055880876557',
  '📄': '5258477770735885832',
  '👥': '5258513401784573443',
  '🗑': '5258130763148172425',
  '✍️': '5258331647358540449',
  '✍': '5258331647358540449',
  '🎮': '5258508428212445001',
  '🎓': '5258334872878980409',
  '❤️': '5258179403652801593',
  '💡': '5258216851472654189',
  '📍': '5258509201306557640',
  '🔒': '5258476306152038031',
  '🛡️': '5258476306152038031',
  '🛡': '5258476306152038031',
  '💬': '5258215846450305872',
  '📌': '5258461531464539536',
  '🔄': '5258420634785947640',
  '💎': '5280962371207077415',
  '💻': '5258423306255604960',
  'ℹ️': '5258503720928288433',
  'ℹ': '5258503720928288433',
  '📈': '5258391025281408576',
  '💰': '5258204546391351475',
  '⚙️': '5258096772776991776',
  '⚙': '5258096772776991776',
  '🔎': '5429571366384842791',
  '🔍': '5429571366384842791',
  '🏷': '5296348778012361146',
};

// Pre-sorted list of emoji keys by length descending to match composite emojis first
const SORTED_EMOJI_KEYS = Object.keys(ALL_TELEGRAM_CUSTOM_EMOJIS).sort(
  (a, b) => b.length - a.length
);

// Pre-compile regex for single-pass replacement, avoiding nested tag wrapping
const ESCAPED_EMOJI_PATTERN = SORTED_EMOJI_KEYS.map((k) =>
  k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
).join('|');
const CUSTOM_EMOJI_REGEX = new RegExp(ESCAPED_EMOJI_PATTERN, 'g');

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

  // 4. Monospace code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 5. Links: [label](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2">$1</a>');

  // 6. Inject Telegram animated custom emojis in a single pass
  html = html.replace(CUSTOM_EMOJI_REGEX, (match) => {
    const customEmojiId = ALL_TELEGRAM_CUSTOM_EMOJIS[match];
    return customEmojiId
      ? `<tg-emoji emoji-id="${customEmojiId}">${match}</tg-emoji>`
      : match;
  });

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
