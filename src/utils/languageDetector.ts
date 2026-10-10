/**
 * Language Detector for Elite Force Telegram Support Bot
 *
 * Detects:
 * 1. Bengali script (Bangla)
 * 2. Romanized Bengali (Banglish)
 * 3. Non-Latin scripts (Arabic, Cyrillic, Devanagari/Hindi, CJK, etc.)
 * 4. Other non-English languages in Latin script (Spanish, French, Hinglish, etc.)
 *
 * Strictly permits only English messages.
 */

export interface LanguageCheckResult {
  isEnglish: boolean;
  language: 'english' | 'bangla' | 'banglish' | 'other_non_english';
  reason?: string;
}

// 1. Unicode Range for Bengali Script (\u0980-\u09FF)
const BANGLA_SCRIPT_REGEX = /[\u0980-\u09FF]/;

// 2. Unicode Ranges for Other Non-Latin Scripts
// Devanagari, Arabic/Urdu, Cyrillic, CJK, Thai, Greek, Hebrew, Indic scripts
const OTHER_NON_LATIN_SCRIPT_REGEX =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F\u0A00-\u0DFF\u0370-\u03FF\u0590-\u05FF]/;

// 3. Banglish Keywords & Tokens (Phonetic Romanized Bengali)
const BANGLISH_WORDS = new Set([
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
const BANGLISH_PHRASES = [
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
const BANGLISH_SUFFIX_PATTERNS = [
  /^[a-z]{3,}(?:chen|sen|chis|tesi|techi|gulo|gula)$/, // e.g. bolsen, boltesi, tokengulo
];

// 6. Other Common Foreign (Non-English) Latin Words (Hinglish/Hindi, Spanish, French, etc.)
const OTHER_FOREIGN_WORDS = new Set([
  // Hindi / Hinglish
  'kya', 'hai', 'hain', 'kaise', 'kahan', 'kab', 'hoga', 'nahi', 'nahin', 'aayega',
  'batao', 'pucho', 'kuch', 'samjha', 'accha', 'achha', 'karna', 'mujhe', 'mera',
  'meri', 'hum', 'aap', 'tum', 'tera', 'kaun', 'kyun', 'chal', 'raha', 'bataiye',

  // Spanish
  'hola', 'como', 'estas', 'gracias', 'buenos', 'dias', 'amigo', 'favor',
  'donde', 'esta', 'adios', 'que', 'por',

  // French
  'bonjour', 'merci', 'comment', 'salut', 'pourquoi',

  // German / Italian / Portuguese / Russian Latin
  'hallo', 'danke', 'ciao', 'grazie', 'ola', 'obrigado', 'privet', 'kak', 'dela',
]);

// 7. Core English & Domain Vocabulary Set
const COMMON_ENGLISH_WORDS = new Set([
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
  'holder', 'holders', 'holding', 'hour', 'hours', 'how', 'huge', 'info', 'information',
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

  // Crypto / Brand / Project specific abbreviations & names
  'eforce', 'bnb', 'bsc', 'bep20', 'bep', 'prince', 'sourav', 'krit', 'gm', 'gn',
  'ca', 'ath', 'atl', 'dex', 'cex', 'dapp', 'defi', 'web3', 'ok', 'okay', 'pls', 'plz',
  'thx', 'cool', 'bro', 'sir', 'ai', 'faq', 'telegram', 'twitter', 'x',
]);

/**
 * Normalizes text by removing URLs, crypto contract addresses,
 * user mentions (@username), and digits.
 */
function normalizeText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ') // Strip URLs
    .replace(/t\.me\/\S+/gi, ' ')     // Strip Telegram links
    .replace(/0x[a-fA-F0-9]{40}/g, ' ') // Strip BSC/ETH contract addresses
    .replace(/@\w+/g, ' ')            // Strip mentions
    .replace(/[0-9]+/g, ' ')          // Strip numbers
    .trim();
}

/**
 * Checks whether an incoming message is strictly in English.
 * Returns detailed diagnostic information.
 */
export function checkMessageLanguage(rawText: string): LanguageCheckResult {
  const text = rawText.trim();
  if (!text) {
    return { isEnglish: true, language: 'english' };
  }

  // 1. Check for Bengali Unicode script characters
  if (BANGLA_SCRIPT_REGEX.test(text)) {
    return {
      isEnglish: false,
      language: 'bangla',
      reason: 'Bengali script detected',
    };
  }

  // 2. Check for Other Non-Latin Unicode scripts (Arabic, Cyrillic, Devanagari, CJK, etc.)
  if (OTHER_NON_LATIN_SCRIPT_REGEX.test(text)) {
    return {
      isEnglish: false,
      language: 'other_non_english',
      reason: 'Non-Latin script detected (e.g. Arabic, Cyrillic, Hindi, CJK)',
    };
  }

  const normalized = normalizeText(text).toLowerCase();

  // If text only contained URLs or contract addresses (no words left), consider it neutral/allowed
  if (!normalized) {
    return { isEnglish: true, language: 'english' };
  }

  // 3. Check for multi-word Banglish phrases
  for (const phrase of BANGLISH_PHRASES) {
    if (normalized.includes(phrase)) {
      return {
        isEnglish: false,
        language: 'banglish',
        reason: `Banglish phrase matched: "${phrase}"`,
      };
    }
  }

  // Tokenize into clean alphabetic words
  const words = normalized.match(/[a-z]+/g) || [];
  if (words.length === 0) {
    return { isEnglish: true, language: 'english' };
  }

  // 4. Check for individual Banglish words
  for (const word of words) {
    if (BANGLISH_WORDS.has(word)) {
      return {
        isEnglish: false,
        language: 'banglish',
        reason: `Banglish word matched: "${word}"`,
      };
    }
  }

  // 5. Check for Banglish inflectional suffix patterns on words not in English vocabulary
  for (const word of words) {
    if (COMMON_ENGLISH_WORDS.has(word)) continue;
    for (const pattern of BANGLISH_SUFFIX_PATTERNS) {
      if (pattern.test(word)) {
        return {
          isEnglish: false,
          language: 'banglish',
          reason: `Banglish suffix pattern matched on word: "${word}"`,
        };
      }
    }
  }

  // 6. Check for common other non-English words (Hinglish/Hindi, Spanish, French, etc.)
  for (const word of words) {
    if (OTHER_FOREIGN_WORDS.has(word)) {
      return {
        isEnglish: false,
        language: 'other_non_english',
        reason: `Non-English foreign word matched: "${word}"`,
      };
    }
  }

  // 7. General English ratio validation
  // For multi-word messages, verify that recognized English vocabulary dominates.
  if (words.length >= 2) {
    let recognizedCount = 0;
    for (const word of words) {
      if (COMMON_ENGLISH_WORDS.has(word)) {
        recognizedCount++;
      }
    }

    const recognizedRatio = recognizedCount / words.length;

    // If less than 40% of words are recognized English and not a short message
    if (recognizedRatio < 0.4) {
      return {
        isEnglish: false,
        language: 'other_non_english',
        reason: `Low English word density (${Math.round(recognizedRatio * 100)}% recognized)`,
      };
    }
  } else if (words.length === 1) {
    // Single word: must be in recognized English/domain list or standard greeting
    const singleWord = words[0];
    if (!COMMON_ENGLISH_WORDS.has(singleWord)) {
      return {
        isEnglish: false,
        language: 'other_non_english',
        reason: `Unrecognized single word: "${singleWord}"`,
      };
    }
  }

  return { isEnglish: true, language: 'english' };
}
