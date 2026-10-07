/**
 * Centralized Telegram Animated Custom Emoji Configuration
 *
 * Map any standard Unicode emoji to its corresponding Telegram Premium
 * animated custom emoji ID.
 *
 * When the bot sends any message containing these emojis, they are
 * automatically transformed into animated custom emojis!
 */

export const CUSTOM_EMOJI_MAP: Record<string, string> = {
  // === Core Action & Highlight Emojis ===
  '🚀': '5280962371207077415', // Rocket / Launch
  '💎': '5280962371207077415', // Diamond / Web3 Gem
  '🔥': '5258152182150077732', // Fire / Hot Announcement
  '📢': '5260268501515377807', // Megaphone / Official News
  '🌐': '5258073068852485953', // Globe / Network / Web3
  '🔐': '5258476306152038031', // Lock with Key / Security
  '🎁': '5258204546391351475', // Gift / Rewards
  '✅': '5260726538302660868', // Checkmark / Verified
  '⚠️': '5258474669769497337', // Warning / Alert
  '⚡️': '5258152182150077732', // Lightning / Fast
  '⚡': '5258152182150077732',
  '🪙': '5258368777350816286', // Coin / E-FORCE Token
  '🤖': '5258093637450866522', // Robot / AI Assistant
  '🔒': '5258476306152038031', // Padlock / Security
  '🛡️': '5258476306152038031', // Shield / Protection
  '🛡': '5258476306152038031',
  '📌': '5258461531464539536', // Pushpin / Pinned
  '✈️': '5258073068852485953', // Airplane / Telegram Channel
  '✈': '5258073068852485953',
  '📈': '5258391025281408576', // Chart / Growth
  '💰': '5258204546391351475', // Money Bag / Rewards
  '👥': '5258513401784573443', // Community / Members
  'ℹ️': '5258503720928288433', // Information
  'ℹ': '5258503720928288433',
  '📝': '5257965174979042426', // Notes / Documentation
  '🔗': '5260730055880876557', // Link / Blockchain
  '⛓': '5260730055880876557',
  '⭐️': '5258185631355378853', // Star
  '⭐': '5258185631355378853',
  '❌': '5258226313285607065', // Cross / Warning

  // === TG iOS & macOS Icons Pack (https://t.me/addemoji/tgmacicons) ===
  '🔢': '5226513232549664618',
  '🖼': '5258050709252743821',
  '👤': '5258362837411045098',
  '📂': '5258514780469075716',
  '📁': '5257965810634202885',
  '⚽️': '5258169263235013408',
  '⚽': '5258169263235013408',
  '🐻': '5258145898612924124',
  '💼': '5258260149037965799',
  '🗓': '5258105663359294787',
  '🤙': '5258337316715373336',
  '📸': '5258205968025525531',
  '📄': '5258477770735885832',
  '🗑': '5258130763148172425',
  '✍️': '5258331647358540449',
  '✍': '5258331647358540449',
  '🎮': '5258508428212445001',
  '🎓': '5258334872878980409',
  '❤️': '5258179403652801593',
  '💡': '5258216851472654189',
  '📍': '5258509201306557640',
  '💬': '5258215846450305872',
  '🔄': '5258420634785947640',
  '💻': '5258423306255604960',
  '⚙️': '5258096772776991776',
  '⚙': '5258096772776991776',
  '🔎': '5429571366384842791',
  '🔍': '5429571366384842791',
  '🏷': '5296348778012361146',

  // === Official Elite Force Community Pack (https://t.me/addemoji/EliteForceOFC) ===
  '🧡': '6201987489012394141', // Orange Heart
  '🤩': '6201982992181634064', // Star-Struck
  '🤴': '6201844956227707404', // Prince / Crown
  '🤑': '6201954623922644588', // Money Face
  '🤗': '6201686166991806588', // Hug
  '😘': '6201819293798113617',
  '🍒': '6201765327534039799',
  '🎄': '6201737526210732162',
  '😶🌫️': '6201653654089377041',
  '😶‍🌫️': '6201653654089377041',
};

/**
 * Registers or updates a single custom emoji mapping.
 *
 * @example
 * registerCustomEmoji('🚀', '5280962371207077415');
 */
export function registerCustomEmoji(emoji: string, customEmojiId: string): void {
  CUSTOM_EMOJI_MAP[emoji] = customEmojiId;
}

/**
 * Registers multiple custom emoji mappings at once.
 *
 * @example
 * registerCustomEmojis({ '🔥': '12345', '💎': '67890' });
 */
export function registerCustomEmojis(mappings: Record<string, string>): void {
  Object.assign(CUSTOM_EMOJI_MAP, mappings);
}

/**
 * Retrieves the custom emoji ID for a given Unicode emoji, if registered.
 */
export function getCustomEmojiId(emoji: string): string | undefined {
  return CUSTOM_EMOJI_MAP[emoji];
}

/**
 * Returns a read-only snapshot of all currently registered custom emoji mappings.
 */
export function getAllCustomEmojis(): Readonly<Record<string, string>> {
  return { ...CUSTOM_EMOJI_MAP };
}
