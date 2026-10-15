/**
 * Smart Message Trigger System — Elite Force AI Support Bot
 *
 * Determines whether a bot reply is warranted for an incoming group message
 * using deterministic keyword/question detection and structured decision logic.
 *
 * Processing order:
 *  1. Bot-mention / reply-to-bot detection  (always trigger)
 *  2. Topic keyword matching                (topic evaluation)
 *  3. Question detection (EN / Bangla / Banglish)
 *  4. Follow-up message detection via conversation history
 *  5. Final shouldReply decision
 */

// ---------------------------------------------------------------------------
// 1. TOPIC KEYWORDS
// ---------------------------------------------------------------------------

const TOPIC_KEYWORDS: string[] = [
  'elite force', 'eliteforce', 'elite-force', 'ecosystem', 'project', 'community',
  'e-force', 'eforce', 'e force',
  'nft', 'nfts',
  'gaming nft', 'game nft', 'nft gaming', 'play-to-earn', 'play to earn',
  'nft rewards', 'nft staking', 'nft utility', 'nft collection', 'nft ownership',
  'nft marketplace', 'nft minting', 'nft claim', 'nft eligibility', 'nft supply',
  'nft benefits',
  'token', 'tokens',
  'launch', 'launching', 'launched',
  'listing', 'listed',
  'airdrop', 'airdrops', 'air drop',
  'whitepaper', 'white paper',
  'roadmap', 'road map',
  'staking', 'stake', 'staked',
  'wallet', 'wallets',
  'contract', 'smart contract',
  'bnb', 'bsc', 'binance',
  'blockchain', 'block chain',
  'web3', 'web 3',
  'celia',
  'support bot',
  'bot help',
  'defi', 'dex', 'cex',
  'presale', 'pre-sale', 'pre sale',
  'whitelist', 'white list',
  'mint', 'minting',
  'eligibility', 'ownership', 'marketplace', 'benefits',
  'maximum supply', 'total supply', 'token supply', 'contract address',
  'website', 'web site', 'site link', 'official link', 'url', 'link',
  'timer', 'countdown', 'telegram', 'channel', 'group', 'twitter', 'x account',
  'help', 'error', 'problem', 'issue', 'not working', 'scam', 'fake link',
  'admin', 'admins', 'administrator', 'moderator',
  'burn', 'burning',
  'liquidity',
  'swap',
  'yield',
  'dao',
  'mainnet', 'testnet',
  'metamask', 'trustwallet', 'trust wallet',
];

// Build a single regex from all keywords (case-insensitive, whole-word aware)
const TOPIC_KEYWORD_REGEX = new RegExp(
  '(?:^|[\\s,!?.;:\'"()-])(' +
    TOPIC_KEYWORDS
      .map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-/ ]/g, '[\\s\\-/]?'))
      .join('|') +
  ')(?:$|[\\s,!?.;:\'"()-])',
  'i'
);

/**
 * Returns true if the text contains at least one Elite Force topic keyword.
 */
export function containsTopicKeyword(text: string): boolean {
  return TOPIC_KEYWORD_REGEX.test(` ${text} `);
}

// ---------------------------------------------------------------------------
// 2. QUESTION DETECTION  (English + Bangla + Banglish)
// ---------------------------------------------------------------------------

// English question starters
const EN_QUESTION_WORDS =
  /\b(when|what|how|why|where|who|which|whose|whom|can|could|should|would|is|are|was|were|do|does|did|will|shall|may|might|have|has|had|please explain|please tell|tell me|explain)\b/i;

// Question marks (any script)
const QUESTION_MARK_RE = /[?？]/;

// Bangla Unicode question words
const BANGLA_QUESTION_WORDS_RE =
  /কী|কে|কেন|কখন|কোথায়|কিভাবে|কীভাবে|কোনটা|হবে কি|পারব কি|আছে কি|কত|কতদিন|বলুন|জানান|বলো|জানাও/u;

// Banglish question word tokens
const BANGLISH_Q_TOKENS = new Set([
  'ki', 'kee', 'keno', 'kokhon', 'kothay', 'kothai',
  'kivabe', 'kemne', 'ke', 'konta', 'konti', 'kobe',
  'koto', 'kader', 'kake', 'bolun', 'bolo', 'jano',
]);

// Banglish pattern (inline)
const BANGLISH_Q_PATTERN = /\b(ki|kee|keno|kokhon|kothay|kothai|kivabe|kemne|kobe|konta|koto)\b/i;

// Short follow-up trigger words
const FOLLOWUP_WORDS =
  /^(why|when|how|what|where|who|really|more|then|and|but|ok|okay|so|continue|go on|explain|তারপর|কেন|কখন|আরো|তাহলে|আচ্ছা|বলো)\??$/i;

/**
 * Detects genuine questions in English, Bangla, or Banglish.
 * Does NOT require a question mark.
 */
export function detectQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (QUESTION_MARK_RE.test(trimmed)) return true;
  if (BANGLA_QUESTION_WORDS_RE.test(trimmed)) return true;
  if (EN_QUESTION_WORDS.test(trimmed)) return true;
  if (BANGLISH_Q_PATTERN.test(trimmed)) return true;

  const tokens = trimmed.toLowerCase().match(/[a-z]+/g) || [];
  for (const t of tokens) {
    if (BANGLISH_Q_TOKENS.has(t)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// 3. SUPPORT INTENT DETECTION
// ---------------------------------------------------------------------------

const SUPPORT_INTENT_RE =
  /\b(help|support|assist|problem|issue|error|stuck|confused|not working|broken|can'?t|cannot|doesn'?t|won'?t|failed|how do i|how to|what is|what are)\b/i;

/**
 * Returns true if the message signals an explicit support request.
 */
export function detectSupportIntent(text: string): boolean {
  return SUPPORT_INTENT_RE.test(text);
}

// ---------------------------------------------------------------------------
// 4. FOLLOW-UP DETECTION
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: 'user' | 'bot';
  text: string;
  timestamp: number; // Unix ms
}

const FOLLOWUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns true if the message is a short follow-up to a recent bot response.
 */
export function detectFollowUp(text: string, history: ConversationTurn[]): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (FOLLOWUP_WORDS.test(trimmed)) {
    const now = Date.now();
    const lastBotTurn = [...history].reverse().find((t) => t.role === 'bot');
    if (lastBotTurn && now - lastBotTurn.timestamp < FOLLOWUP_TTL_MS) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// 5. REPEAT-SPAM GUARD
// ---------------------------------------------------------------------------

interface RepeatEntry {
  lastText: string;
  count: number;
  lastSeenMs: number;
}

const recentReplies = new Map<string, RepeatEntry>();
const REPEAT_WINDOW_MS = 60_000;
const REPEAT_MAX_COUNT = 2;

/**
 * Returns true when the bot has already answered the same question
 * too many times in this chat within the time window.
 */
export function isRepeatQuestion(chatId: string | number, text: string): boolean {
  const key = String(chatId);
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);
  const entry = recentReplies.get(key);

  if (!entry) return false;
  if (Date.now() - entry.lastSeenMs > REPEAT_WINDOW_MS) {
    recentReplies.delete(key);
    return false;
  }

  return entry.lastText === norm && entry.count >= REPEAT_MAX_COUNT;
}

/**
 * Records that the bot replied to this text in this chat.
 */
export function recordReply(chatId: string | number, text: string): void {
  const key = String(chatId);
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);
  const existing = recentReplies.get(key);

  if (existing && existing.lastText === norm && Date.now() - existing.lastSeenMs < REPEAT_WINDOW_MS) {
    existing.count++;
    existing.lastSeenMs = Date.now();
  } else {
    recentReplies.set(key, { lastText: norm, count: 1, lastSeenMs: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// 6. MAIN shouldReply DECISION
// ---------------------------------------------------------------------------

export interface TriggerDecision {
  shouldReply: boolean;
  reason: string;
  flags: {
    isMention: boolean;
    isReplyToBot: boolean;
    hasTopicKeyword: boolean;
    isQuestion: boolean;
    isSupportIntent: boolean;
    isFollowUp: boolean;
    isRepeat: boolean;
  };
}

export interface ShouldReplyContext {
  text: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  isMention: boolean;
  isReplyToBot: boolean;
  chatId: string | number;
  conversationHistory?: ConversationTurn[];
}

/**
 * Decides whether the bot should reply to an incoming message.
 * Pure deterministic logic — does NOT call Gemini.
 */
export function shouldReply(ctx: ShouldReplyContext): TriggerDecision {
  const {
    text,
    chatType,
    isMention,
    isReplyToBot,
    chatId,
    conversationHistory = [],
  } = ctx;

  const isPrivate = chatType === 'private';
  const hasTopicKeyword = containsTopicKeyword(text);
  const isQuestion = detectQuestion(text);
  const isSupportIntent = detectSupportIntent(text);
  const isFollowUp = detectFollowUp(text, conversationHistory);
  const isRepeat = !isPrivate && isRepeatQuestion(chatId, text);

  const flags = {
    isMention,
    isReplyToBot,
    hasTopicKeyword,
    isQuestion,
    isSupportIntent,
    isFollowUp,
    isRepeat,
  };

  // Private chats always respond (unless repeat spam)
  if (isPrivate && !isRepeat) return { shouldReply: true, reason: 'private_chat', flags };
  if (isPrivate && isRepeat) return { shouldReply: false, reason: 'repeat_private', flags };

  // Direct mention — always reply
  if (isMention) return { shouldReply: true, reason: 'direct_mention', flags };

  // Reply to bot — always reply
  if (isReplyToBot) return { shouldReply: true, reason: 'reply_to_bot', flags };

  // Repeat-spam guard
  if (isRepeat) return { shouldReply: false, reason: 'repeat_spam_guard', flags };

  // Topic keyword + question or support intent
  if (hasTopicKeyword && (isQuestion || isSupportIntent)) {
    return { shouldReply: true, reason: 'topic_keyword_with_question', flags };
  }

  // Topic keyword alone
  if (hasTopicKeyword) return { shouldReply: true, reason: 'topic_keyword', flags };

  // Follow-up to recent bot response
  if (isFollowUp) return { shouldReply: true, reason: 'followup', flags };

  // General question (no topic keyword)
  if (isQuestion) return { shouldReply: true, reason: 'general_question', flags };

  // Support intent alone
  if (isSupportIntent) return { shouldReply: true, reason: 'support_intent', flags };

  return { shouldReply: false, reason: 'not_relevant', flags };
}
