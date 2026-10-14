/**
 * Language Detector for Elite Force Telegram Support Bot
 *
 * Detects:
 * 1. Bengali script (Bangla)
 * 2. Romanized Bengali (Banglish)
 * 3. Non-Latin scripts (Arabic, Cyrillic, Devanagari/Hindi, CJK, etc.)
 * 4. Other non-English languages in Latin script (Spanish, French, Hinglish, Arabic transliteration, etc.)
 * 5. Mixed English / non-English messages (detects and rejects substantial non-English content)
 *
 * Safe Fallbacks:
 * - Does not flag valid English messages containing names, URLs, technical terms, code snippets, or emojis.
 * - For ambiguous short messages (1-2 words), protects legitimate English/technical content.
 */

export interface LanguageCheckResult {
  isEnglish: boolean;
  language: 'english' | 'bangla' | 'banglish' | 'other_non_english';
  isMixed?: boolean;
  reason?: string;
}

// 1. Unicode Range for Bengali Script (\u0980-\u09FF)
export const BANGLA_SCRIPT_REGEX = /[\u0980-\u09FF]/;

// 2. Unicode Ranges for Other Non-Latin Scripts
// Devanagari (Hindi), Arabic/Urdu, Cyrillic, CJK, Thai, Greek, Hebrew, Indic scripts
export const OTHER_NON_LATIN_SCRIPT_REGEX =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F\u0A00-\u0DFF\u0370-\u03FF\u0590-\u05FF]/;

// 3. Banglish Keywords & Tokens (Phonetic Romanized Bengali)
export const BANGLISH_WORDS = new Set([
  // Pronouns & Possessives
  'ami', 'amra', 'amader', 'amake', 'amar',
  'tumi', 'tomra', 'tomader', 'tomake', 'tomar', 'tui', 'tora', 'tor', 'tore',
  'apni', 'apnara', 'apnader', 'apnake', 'apnar',
  'shey', 'tara', 'tader', 'take',
  'eita', 'eta', 'eitar', 'etar', 'oita', 'ota', 'oitar', 'otar', 'egulo', 'ogulo',

  // Question words / Interrogatives
  'kobe', 'kothay', 'kothai', 'kemne', 'kemon', 'keno', 'koto', 'konta', 'konti', 'kader', 'kake', 'ki', 'kee',

  // Common Verbs & Auxiliaries (various tenses/forms)
  'hobe', 'hobena', 'hobar', 'hocche', 'hoche', 'hoise', 'hoyeche', 'holo', 'hoilo', 'hoyni', 'hoini', 'hoba', 'hocen',
  'koro', 'korbo', 'koren', 'korbe', 'korche', 'korchi', 'korsi', 'korse', 'korle', 'kora', 'korechi', 'korechen', 'korlam', 'korte', 'kore', 'koris',
  'bolo', 'bolbo', 'bolen', 'bolbe', 'bolche', 'bolchi', 'bolsi', 'bolle', 'bola', 'bollam', 'bolte', 'bolis',
  'dekho', 'dekhbo', 'dekhen', 'dekhbe', 'dekhche', 'dekhchi', 'dekhsi', 'dekhte', 'dekha', 'dekhlam',
  'shono', 'shonbo', 'shonen', 'shonbe', 'shunte', 'shona', 'shunlam',
  'jano', 'janbo', 'janen', 'janbe', 'jani', 'jante', 'jana', 'janlam',
  'bujho', 'bujhbo', 'bujhen', 'bujhbe', 'bujhi', 'bujhte', 'bujhlam', 'bujchen', 'bujlen',
  'paro', 'parbo', 'paren', 'parbe', 'pari', 'parle', 'parlam', 'para', 'parba',
  'thako', 'thakbo', 'thaken', 'thakbe', 'thaki', 'thakte', 'thakle', 'thaka',
  'asho', 'ashbo', 'ashen', 'ashbe', 'ashlam', 'ashte', 'asha', 'ashe', 'ashis',
  'jabo', 'jachhi', 'jassi', 'jas', 'jawa', 'jaoa', 'jete', 'gelam', 'gelo', 'jaben', 'jao', 'jan',
  'dao', 'dibo', 'den', 'debo', 'dite', 'dilam', 'dilo', 'dawa', 'deya', 'disi', 'diechi', 'diba',
  'neo', 'nebo', 'nen', 'nite', 'nilam', 'nilo', 'neya', 'nesi',
  'lagbe', 'lage', 'lagche', 'laglo', 'lagte',
  'chai', 'chao', 'chan', 'chay', 'chawa',
  'diyo', 'dio', 'kio', 'bolben', 'korben', 'janaben', 'deben', 'asben',

  // Address terms & Social
  'bhai', 'vai', 'bhaiya', 'vaia', 'apu', 'dada', 'bon', 'bondhu',

  // Adjectives, Adverbs, Connectives, Negation
  'bhalo', 'valo', 'kharap', 'shundor', 'sundor',
  'thik', 'thikache', 'thikase', 'thikthak',
  'dhonnobad', 'dhonobad', 'shagotom',
  'shob', 'sob', 'onek', 'ektu', 'aro', 'kom', 'beshi', 'khub',
  'ekhon', 'akhon', 'pore', 'age', 'kokhon',
  'kintu', 'ebong', 'nahole', 'tahole', 'tai', 'tobe',
  'karone', 'jonno', 'jonne', 'shathe', 'sathe',
  'nai', 'nay', 'noy', 'obosshoy', 'obossoi',
  'shotti', 'mittha', 'naki', 'nki',
  'khobor', 'obostha', 'somoy', 'shomoy', 'kotha', 'kaj', 'kaaj',
  'dorkar', 'shomossha', 'somossa', 'kichu', 'kisui',
  'acche', 'ache', 'asen', 'achi', 'aso',
  'bolod', 'pagol', 'boka', 'choda', 'bokachoda', 'baal', 'magi',
]);

// 4. Banglish Multi-Word Phrases
export const BANGLISH_PHRASES = [
  'ki khobor',
  'ki obostha',
  'ki obstha',
  'kemon acho',
  'kemon achen',
  'kemon aso',
  'kemon asen',
  'thik ache',
  'thik ase',
  'kobe launch',
  'kobe listing',
  'kobe hobe',
  'bhai kobe',
  'vai kobe',
  'bhai help',
  'vai help',
  'bhaiya help',
  'vaia help',
  'help koren',
  'help koro',
  'bolo na',
  'kichu bolo',
  'kichu bolen',
  'kotha bolbo',
  'kotha bolte',
  'price koto',
  'dam koto',
  'somoy lagbe',
  'din lagbe',
  'jani na',
  'bujhi na',
  'bujhte parsi',
  'bujhte parchi',
  'bhalo achi',
  'valo achi',
  'shob thik',
  'sob thik',
  'dhonnobad bhai',
  'dhonnobad vai',
];

// 5. Banglish Suffix Patterns (inflected verbs/nouns, only checked on non-English words)
export const BANGLISH_SUFFIX_PATTERNS = [
  /^[a-z]{3,}(?:chen|sen|chis|tesi|techi|gulo|gula)$/, // e.g. bolsen, boltesi, tokengulo
];

// 6. Other Common Foreign (Non-English) Latin Words (Hinglish/Hindi, Arabic transliteration, Spanish, French, etc.)
export const OTHER_FOREIGN_WORDS = new Set([
  // Hindi / Hinglish
  'kya', 'hai', 'hain', 'kaise', 'kahan', 'kab', 'hoga', 'nahi', 'nahin', 'aayega',
  'batao', 'pucho', 'kuch', 'samjha', 'accha', 'achha', 'karna', 'mujhe', 'mera',
  'meri', 'hum', 'aap', 'tum', 'tera', 'kaun', 'kyun', 'chal', 'raha', 'bataiye',
  'namaste', 'shukriya', 'bhaiya', 'kitna', 'paisa', 'karo', 'karein',

  // Arabic Romanized
  'marhaba', 'marhaban', 'shukran', 'habibi', 'inshallah', 'inshaallah', 'alhamdulillah',
  'wallah', 'ahlan', 'kayfa', 'haluk', 'haluka', 'naam', 'laa', 'akhi',

  // Spanish
  'hola', 'como', 'estas', 'gracias', 'buenos', 'dias', 'amigo', 'favor',
  'donde', 'esta', 'adios', 'que', 'por',

  // French
  'bonjour', 'merci', 'comment', 'salut', 'pourquoi',

  // German / Italian / Portuguese / Russian Latin
  'hallo', 'danke', 'ciao', 'grazie', 'ola', 'obrigado', 'privet', 'kak', 'dela',
]);

export const OTHER_FOREIGN_PHRASES = [
  'kya haal', 'kya haal hai', 'kaise ho', 'kaise ho bhai',
  'shukran jazeelan', 'kayfa halak', 'como estas', 'comment ca va',
];

// 7. Core English & Domain Vocabulary Set
export const COMMON_ENGLISH_WORDS = new Set([
  // Pronouns, Articles, Prepositions & Conjunctions
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'all', 'almost', 'alone',
  'along', 'already', 'also', 'although', 'always', 'am', 'among', 'an', 'and', 'another',
  'any', 'anybody', 'anyone', 'anything', 'anywhere', 'are', 'around', 'as', 'at', 'back',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
  'cannot', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'either', 'else',
  'even', 'ever', 'every', 'everyone', 'everything', 'everywhere', 'for', 'from', 'get',
  'gets', 'getting', 'give', 'gives', 'go', 'goes', 'going', 'gone', 'got', 'had', 'has',
  'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'just', 'let', 'like', 'may', 'me', 'might', 'more', 'most', 'much',
  'must', 'my', 'neither', 'never', 'no', 'nobody', 'none', 'nor', 'not', 'nothing', 'now',
  'nowhere', 'of', 'off', 'on', 'once', 'one', 'only', 'onto', 'or', 'other', 'others', 'our',
  'ours', 'out', 'over', 'own', 'same', 'see', 'she', 'should', 'since', 'so', 'some',
  'somebody', 'someone', 'something', 'somewhere', 'still', 'such', 'than', 'that', 'the',
  'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'upon', 'us', 'use', 'very', 'was', 'we', 'well',
  'were', 'what', 'whatever', 'when', 'whenever', 'where', 'wherever', 'which', 'while',
  'who', 'whoever', 'whom', 'whose', 'why', 'will', 'with', 'within', 'without', 'would',
  'yes', 'yet', 'you', 'your', 'yours',

  // Common Nouns, Verbs, Adjectives
  'account', 'action', 'activity', 'add', 'address', 'airdrop', 'allow', 'amount', 'answer',
  'app', 'asset', 'assets', 'available', 'balance', 'base', 'best', 'big', 'block',
  'blockchain', 'bot', 'bought', 'build', 'building', 'buy', 'buyer', 'buying', 'call',
  'card', 'case', 'chain', 'change', 'channel', 'chat', 'check', 'claim', 'clear', 'click',
  'coin', 'coins', 'come', 'coming', 'community', 'confirm', 'connect', 'contact', 'contract',
  'cost', 'create', 'crypto', 'cryptocurrency', 'current', 'daily', 'data', 'date', 'day',
  'days', 'decentralized', 'deposit', 'detail', 'details', 'development', 'dex', 'direct',
  'drop', 'earn', 'easy', 'elite', 'end', 'enough', 'enter', 'error', 'exchange', 'fast',
  'fee', 'fees', 'find', 'first', 'follow', 'force', 'found', 'founder', 'founders', 'free',
  'future', 'gain', 'gas', 'global', 'good', 'great', 'group', 'guide', 'guys', 'handle',
  'happy', 'hard', 'hear', 'help', 'helpful', 'helping', 'hey', 'hi', 'high', 'hold',
  'holder', 'holders', 'holding', 'hour', 'hours', 'huge', 'info', 'information',
  'invest', 'investment', 'issue', 'join', 'keep', 'key', 'know', 'knowledge', 'last',
  'late', 'launch', 'launched', 'launching', 'learn', 'leave', 'legit', 'legitimate', 'life',
  'limit', 'link', 'links', 'liquidity', 'list', 'listed', 'listing', 'live', 'lock',
  'locked', 'long', 'look', 'looking', 'lost', 'lot', 'low', 'made', 'main', 'mainnet',
  'make', 'making', 'many', 'market', 'mean', 'means', 'member', 'members', 'message',
  'messages', 'metamask', 'mine', 'minute', 'minutes', 'money', 'month', 'months', 'morning',
  'move', 'name', 'near', 'need', 'network', 'new', 'news', 'next', 'nice', 'night',
  'node', 'number', 'official', 'online', 'open', 'order', 'page', 'pair', 'part', 'pay',
  'payment', 'people', 'period', 'person', 'phone', 'place', 'plan', 'platform', 'play',
  'please', 'pool', 'pools', 'post', 'posts', 'presale', 'price', 'prices', 'privacy',
  'private', 'problem', 'process', 'project', 'proof', 'provide', 'public', 'pump', 'query',
  'question', 'questions', 'quick', 'rate', 'read', 'ready', 'real', 'really', 'receive',
  'record', 'release', 'reply', 'report', 'request', 'response', 'result', 'reward',
  'rewards', 'right', 'risk', 'road', 'roadmap', 'rule', 'rules', 'run', 'safe', 'safety',
  'say', 'scam', 'scammer', 'scammers', 'scams', 'search', 'second', 'seconds', 'secure',
  'security', 'see', 'seek', 'sell', 'seller', 'selling', 'send', 'sender', 'sending',
  'sent', 'server', 'service', 'set', 'share', 'short', 'show', 'side', 'sign', 'site',
  'smart', 'soon', 'stake', 'staked', 'staking', 'start', 'started', 'starting', 'state',
  'status', 'stay', 'step', 'steps', 'stop', 'store', 'support', 'sure', 'swap', 'system',
  'take', 'talk', 'target', 'tax', 'team', 'tell', 'term', 'terms', 'test', 'thank',
  'thanks', 'thing', 'things', 'think', 'time', 'timer', 'today', 'token', 'tokens',
  'tomorrow', 'top', 'total', 'trade', 'trader', 'trading', 'transaction', 'transfer',
  'true', 'trust', 'trustwallet', 'try', 'turn', 'type', 'understand', 'unit', 'update',
  'updates', 'upgrade', 'user', 'users', 'utility', 'valid', 'value', 'verify', 'verified',
  'version', 'view', 'visit', 'wait', 'waiting', 'wallet', 'wallets', 'want', 'way',
  'website', 'week', 'weeks', 'welcome', 'whitepaper', 'win', 'withdrawal', 'work', 'working',
  'world', 'worth', 'wrong', 'year', 'years', 'yesterday',

  // Crypto / Brand / Project specific abbreviations, technical terms & names
  'eforce', 'bnb', 'bsc', 'bep20', 'bep', 'prince', 'sourav', 'krit', 'celia', 'gm', 'gn',
  'ca', 'ath', 'atl', 'dex', 'cex', 'dapp', 'defi', 'web3', 'ok', 'okay', 'pls', 'plz',
  'thx', 'cool', 'bro', 'sir', 'ai', 'faq', 'telegram', 'twitter', 'x', 'rpc', 'slippage',
  'gwei', 'audit', 'dao', 'vault', 'yield', 'mint', 'burn', 'airdrop', 'whitelist', 'presale',
]);

/**
 * Normalizes text by removing code snippets, URLs, Telegram links, crypto contract
 * addresses, user mentions (@username), crypto tickers ($TOKEN), and emojis.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // Strip multi-line code blocks
    .replace(/`[^`\n]+`/g, ' ')       // Strip inline code
    .replace(/https?:\/\/\S+/gi, ' ') // Strip URLs
    .replace(/t\.me\/\S+/gi, ' ')     // Strip Telegram links
    .replace(/0x[a-fA-F0-9]{40}/g, ' ') // Strip BSC/ETH contract addresses
    .replace(/@\w+/g, ' ')            // Strip mentions
    .replace(/\$[a-zA-Z0-9_]+/g, ' ') // Strip crypto tickers (e.g. $EFORCE)
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]+/gu, ' ') // Strip emojis
    .replace(/[0-9]+/g, ' ')          // Strip numbers
    .trim();
}

/**
 * Checks whether an incoming message is strictly in English.
 * Returns detailed diagnostic information, including whether it is a mixed-language message.
 */
export function checkMessageLanguage(rawText: string): LanguageCheckResult {
  const text = rawText.trim();
  if (!text) {
    return { isEnglish: true, language: 'english' };
  }

  // 1. Check for Bengali Unicode script characters (\u0980-\u09FF)
  if (BANGLA_SCRIPT_REGEX.test(text)) {
    const hasEnglishWords = /[a-zA-Z]{2,}/.test(text);
    return {
      isEnglish: false,
      language: 'bangla',
      isMixed: hasEnglishWords,
      reason: hasEnglishWords ? 'Mixed message containing Bengali script' : 'Bengali script detected',
    };
  }

  // 2. Check for Other Non-Latin Unicode scripts (Arabic, Cyrillic, Devanagari, CJK, etc.)
  if (OTHER_NON_LATIN_SCRIPT_REGEX.test(text)) {
    const hasEnglishWords = /[a-zA-Z]{2,}/.test(text);
    return {
      isEnglish: false,
      language: 'other_non_english',
      isMixed: hasEnglishWords,
      reason: hasEnglishWords ? 'Mixed message containing non-Latin script' : 'Non-Latin script detected (e.g. Arabic, Cyrillic, Hindi, CJK)',
    };
  }

  const normalized = normalizeText(text).toLowerCase();

  // If text only contained URLs, code, or contract addresses (no words left), consider it allowed
  if (!normalized) {
    return { isEnglish: true, language: 'english' };
  }

  // 3. Check for multi-word Banglish phrases
  for (const phrase of BANGLISH_PHRASES) {
    if (normalized.includes(phrase)) {
      const hasEnglishWords = /[a-zA-Z]{3,}/.test(normalized.replace(phrase, ''));
      return {
        isEnglish: false,
        language: 'banglish',
        isMixed: hasEnglishWords,
        reason: `Banglish phrase matched: "${phrase}"`,
      };
    }
  }

  // 3b. Check for other multi-word foreign phrases (Hinglish/Arabic/Spanish/French)
  for (const phrase of OTHER_FOREIGN_PHRASES) {
    if (normalized.includes(phrase)) {
      const hasEnglishWords = /[a-zA-Z]{3,}/.test(normalized.replace(phrase, ''));
      return {
        isEnglish: false,
        language: 'other_non_english',
        isMixed: hasEnglishWords,
        reason: `Foreign phrase matched: "${phrase}"`,
      };
    }
  }

  // Tokenize into clean alphabetic words
  const words = normalized.match(/[a-z]+/g) || [];
  if (words.length === 0) {
    return { isEnglish: true, language: 'english' };
  }

  // Count recognized English words vs non-English words to evaluate mixed messages
  const recognizedEnglishWords: string[] = [];
  const detectedNonEnglishWords: string[] = [];

  for (const word of words) {
    if (BANGLISH_WORDS.has(word)) {
      detectedNonEnglishWords.push(word);
    } else if (OTHER_FOREIGN_WORDS.has(word)) {
      detectedNonEnglishWords.push(word);
    } else if (COMMON_ENGLISH_WORDS.has(word)) {
      recognizedEnglishWords.push(word);
    }
  }

  // 4. Check for individual Banglish words
  if (detectedNonEnglishWords.length > 0) {
    const isMixed = recognizedEnglishWords.length > 0;
    const firstNonEn = detectedNonEnglishWords[0];
    const isBanglish = BANGLISH_WORDS.has(firstNonEn);
    return {
      isEnglish: false,
      language: isBanglish ? 'banglish' : 'other_non_english',
      isMixed,
      reason: isMixed
        ? `Mixed message containing non-English expression: "${firstNonEn}"`
        : `Non-English word matched: "${firstNonEn}"`,
    };
  }

  // 5. Check for Banglish inflectional suffix patterns on words not in English vocabulary
  for (const word of words) {
    if (COMMON_ENGLISH_WORDS.has(word)) continue;
    for (const pattern of BANGLISH_SUFFIX_PATTERNS) {
      if (pattern.test(word)) {
        const isMixed = recognizedEnglishWords.length > 0;
        return {
          isEnglish: false,
          language: 'banglish',
          isMixed,
          reason: `Banglish suffix pattern matched on word: "${word}"`,
        };
      }
    }
  }

  // 6. Ambiguity Safeguard & General English Ratio Validation
  // For short messages (1-2 words), do not reject based on missing dictionary entries.
  // This prevents false positives on technical jargon, abbreviations, user names, or greetings.
  if (words.length <= 2) {
    return { isEnglish: true, language: 'english' };
  }

  // For 3+ words: verify that recognized English vocabulary is present
  const recognizedRatio = recognizedEnglishWords.length / words.length;

  // If 0 recognized English words in a multi-word message, flag as non-English
  if (recognizedEnglishWords.length === 0 && words.length >= 3) {
    return {
      isEnglish: false,
      language: 'other_non_english',
      reason: `No recognizable English vocabulary in message (${words.length} words)`,
    };
  }

  // If less than 25% recognized in a long message (5+ words), flag as low confidence
  if (words.length >= 5 && recognizedRatio < 0.25) {
    return {
      isEnglish: false,
      language: 'other_non_english',
      reason: `Low English word density (${Math.round(recognizedRatio * 100)}% recognized)`,
    };
  }

  return { isEnglish: true, language: 'english' };
}

export interface ProcessedLanguageResult {
  originalText: string;
  cleanedEnglishText: string;
  isAllowed: boolean;
  hasEnglish: boolean;
  hasNonEnglish: boolean;
  hasSubstantialNonEnglish: boolean;
  isMixed: boolean;
  detectedNonEnglishLanguages: string[];
  removedContent: string[];
  reason?: string;
}

/**
 * Analyzes message language and determines whether it should be permitted or rejected.
 *
 * Rules:
 * - If message is pure English: isAllowed = true, hasNonEnglish = false.
 * - If message contains substantial non-English text (even if mixed with English):
 *   -> isAllowed = false, hasSubstantialNonEnglish = true, isMixed = true.
 * - If message is pure non-English: isAllowed = false, hasEnglish = false.
 */
export function processAndFilterMessageLanguage(rawText: string): ProcessedLanguageResult {
  const originalText = rawText.trim();
  if (!originalText) {
    return {
      originalText,
      cleanedEnglishText: '',
      isAllowed: true,
      hasEnglish: false,
      hasNonEnglish: false,
      hasSubstantialNonEnglish: false,
      isMixed: false,
      detectedNonEnglishLanguages: [],
      removedContent: [],
    };
  }

  const removedContent: string[] = [];
  const detectedNonEnglishLanguages = new Set<string>();

  let workingText = originalText;

  // 1. Detect and extract non-Latin scripts (Bangla, Arabic, Hindi, Cyrillic, CJK, etc.)
  if (BANGLA_SCRIPT_REGEX.test(workingText)) {
    detectedNonEnglishLanguages.add('Bangla');
    const matches = workingText.match(/[\u0980-\u09FF]+/g) || [];
    for (const m of matches) removedContent.push(m);
    workingText = workingText.replace(/[\u0980-\u09FF]+/g, ' ');
  }

  if (OTHER_NON_LATIN_SCRIPT_REGEX.test(workingText)) {
    detectedNonEnglishLanguages.add('Non-Latin Script');
    const matches = workingText.match(new RegExp(OTHER_NON_LATIN_SCRIPT_REGEX.source, 'g')) || [];
    for (const m of matches) removedContent.push(m);
    workingText = workingText.replace(new RegExp(OTHER_NON_LATIN_SCRIPT_REGEX.source, 'g'), ' ');
  }

  // 2. Detect and extract multi-word Banglish phrases
  for (const phrase of BANGLISH_PHRASES) {
    const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
    if (regex.test(workingText)) {
      detectedNonEnglishLanguages.add('Banglish');
      removedContent.push(phrase);
      workingText = workingText.replace(regex, ' ');
    }
  }

  // 2b. Detect and extract other multi-word foreign phrases
  for (const phrase of OTHER_FOREIGN_PHRASES) {
    const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
    if (regex.test(workingText)) {
      detectedNonEnglishLanguages.add('Foreign (Non-English)');
      removedContent.push(phrase);
      workingText = workingText.replace(regex, ' ');
    }
  }

  // 3. Tokenize by words and analyze Latin non-English words
  const rawTokens = workingText.split(/\s+/);
  const preservedTokens: string[] = [];

  for (const token of rawTokens) {
    if (!token) continue;

    // Preserve URLs, Telegram links, mentions, numbers, contract addresses, tickers
    if (
      /^https?:\/\//i.test(token) ||
      /^t\.me\//i.test(token) ||
      /^0x[a-f0-9]{40}$/i.test(token) ||
      /^@\w+/i.test(token) ||
      /^\$[a-zA-Z0-9_]+$/i.test(token) ||
      /^[0-9$€£¥%+\-/*=.,#:]+$/.test(token)
    ) {
      preservedTokens.push(token);
      continue;
    }

    // Clean word for dictionary checking
    const cleanWord = token.toLowerCase().replace(/[^a-z]/g, '');
    if (!cleanWord) {
      preservedTokens.push(token);
      continue;
    }

    // Check if word is known Banglish
    if (BANGLISH_WORDS.has(cleanWord)) {
      detectedNonEnglishLanguages.add('Banglish');
      removedContent.push(token);
      continue;
    }

    // Check if word has Banglish suffix on non-English base
    let hasBanglishSuffix = false;
    if (!COMMON_ENGLISH_WORDS.has(cleanWord)) {
      for (const pattern of BANGLISH_SUFFIX_PATTERNS) {
        if (pattern.test(cleanWord)) {
          hasBanglishSuffix = true;
          break;
        }
      }
    }
    if (hasBanglishSuffix) {
      detectedNonEnglishLanguages.add('Banglish');
      removedContent.push(token);
      continue;
    }

    // Check if word is foreign Latin (Hindi/Spanish/French/Arabic transliteration/etc.)
    if (OTHER_FOREIGN_WORDS.has(cleanWord)) {
      detectedNonEnglishLanguages.add('Foreign (Non-English)');
      removedContent.push(token);
      continue;
    }

    // English word or unrecognized word -> preserve
    preservedTokens.push(token);
  }

  // 4. Reconstruct cleaned English text
  const cleanedEnglishText = preservedTokens
    .join(' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 5. Evaluate remaining English viability
  const remainingWords = cleanedEnglishText.toLowerCase().match(/[a-z]+/g) || [];
  let recognizedEnglishCount = 0;

  for (const word of remainingWords) {
    if (COMMON_ENGLISH_WORDS.has(word)) {
      recognizedEnglishCount++;
    }
  }

  const hasEnglish =
    remainingWords.length > 0 &&
    (recognizedEnglishCount >= 1 || cleanedEnglishText.includes('http') || cleanedEnglishText.includes('0x'));

  const hasNonEnglish = removedContent.length > 0;
  const isMixed = hasEnglish && hasNonEnglish;

  // Substantial non-English: If any non-English tokens/phrases/scripts were removed,
  // or if non-English words make up a significant presence.
  const hasSubstantialNonEnglish =
    hasNonEnglish && (removedContent.length >= 1 || detectedNonEnglishLanguages.size > 0);

  // If there is substantial non-English content in the message, it is rejected
  const isAllowed = !hasSubstantialNonEnglish && (hasEnglish || remainingWords.length <= 2);

  return {
    originalText,
    cleanedEnglishText,
    isAllowed,
    hasEnglish,
    hasNonEnglish,
    hasSubstantialNonEnglish,
    isMixed,
    detectedNonEnglishLanguages: Array.from(detectedNonEnglishLanguages),
    removedContent,
    reason: !isAllowed
      ? `Non-English content detected: ${Array.from(detectedNonEnglishLanguages).join(', ')}`
      : undefined,
  };
}
