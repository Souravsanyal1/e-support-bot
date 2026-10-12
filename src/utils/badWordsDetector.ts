/**
 * English Profanity, Bad Words, Slurs & Insult Detection Engine
 * for Elite Force Telegram Support Bot
 *
 * Capabilities:
 * 1. Comprehensive Lexicon:
 *    - Severe profanities and vulgarities (fuck, shit, bitch, cunt, asshole, bastard, etc.)
 *    - Targeted insults and abusive expressions (fucking idiot, you idiot, dumbass, son of a bitch, etc.)
 *    - Sexual and vulgar expressions (blowjob, handjob, jerk off, dildo, cock, horny, slut, whore, etc.)
 *    - Discriminatory slurs and hate speech
 *
 * 2. Multi-Stage Normalization & Evasion Handling:
 *    - Character spacing collapse ("f u c k", "s h i t", "b i t c h", "c u n t")
 *    - Punctuation & separator removal ("f.u.c.k", "f-u-c-k", "f_u_c_k", "f*u*c*k")
 *    - Character repetition squashing ("fuuuuuck", "shiiit", "biiiiitch")
 *    - Leetspeak & symbol substitution ("f@ck", "f4ck", "sh!t", "sh1t", "b!tch", "b1tch", "a$$hole", "@sshole", "4sshole", "d!ck", "p*ssy", "wh0re", "sl*t")
 *    - Phonetic and masked variations ("fuk", "fucc", "fck", "f*ck", "f**k", "c*nt", "wh*re")
 *
 * 3. Context & False-Positive Protection:
 *    - Strict boundary and whitelist safeguards for innocent words
 *      (assistant, asset, password, classic, glass, hello, ship, bit, bitcoin, cocktail, predict, etc.)
 *    - Recognition of educational / quote / moderation discussion contexts
 *    - Targeted abuse and severity classification
 */

export type ViolationCategory =
  | 'profanity'
  | 'insult'
  | 'harassment'
  | 'sexual_vulgarity'
  | 'slur'
  | 'obfuscated_evasion';

export type SeverityLevel = 'critical' | 'high' | 'medium';

export interface BadWordsCheckResult {
  hasBadWords: boolean;
  detectedWords: string[];
  categories: ViolationCategory[];
  severity?: SeverityLevel;
  isTargetedAbuse?: boolean;
  isObfuscated?: boolean;
  reason?: string;
}

// --------------------------------------------------------------------------
// 1. Core Lexicons
// --------------------------------------------------------------------------

// Severe / High Profanities
const SEVERE_PROFANITIES = new Set([
  'fuck', 'fucks', 'fucker', 'fuckers', 'fucking', 'fucked', 'fuckin',
  'motherfucker', 'motherfuckers', 'motherfucking', 'motherfuckerz',
  'mothafucka', 'mf', 'mfs',
  'shit', 'shits', 'shitty', 'shitted', 'shat', 'bullshit', 'horseshit', 'dipshit',
  'bitch', 'bitches', 'bitching', 'bitchy', 'bitchass',
  'asshole', 'assholes', 'arsehole', 'arseholes',
  'bastard', 'bastards',
  'cunt', 'cunts',
  'dickhead', 'dickheads',
  'cocksucker', 'cocksuckers',
]);

// Slurs & Hate Speech (Critical Severity)
const SLURS_SET = new Set([
  'nigger', 'niggers', 'nigga', 'niggas',
  'faggot', 'faggots', 'fag', 'fags',
  'retard', 'retards', 'retarded',
  'chink', 'gook', 'kike', 'spic',
]);

// Sexual & Explicit Vulgarities
const SEXUAL_VULGARITIES = new Set([
  'blowjob', 'blowjobs',
  'handjob', 'handjobs',
  'dildo', 'dildos',
  'porn', 'porno', 'pornography',
  'slut', 'sluts',
  'whore', 'whores',
  'pussy', 'pussies',
  'horny',
]);

// Moderate Vulgarities & Common Abusive Words (Checked with strict boundary)
const MODERATE_PROFANITIES = new Set([
  'dumbass', 'dumbasses',
  'jackass', 'jackasses',
  'asswipe', 'arse',
  'dick', 'dicks',
  'cock', 'cocks',
  'prick', 'pricks',
  'twat', 'twats',
  'wanker', 'wankers',
  'bollocks',
  'crap',
  'stfu',
]);

// --------------------------------------------------------------------------
// 2. Abusive & Insulting Expressions (Multi-Word Phrases)
// --------------------------------------------------------------------------
interface AbusivePhraseRule {
  phrase: string;
  category: ViolationCategory;
  severity: SeverityLevel;
  targeted: boolean;
}

const ABUSIVE_PHRASES: AbusivePhraseRule[] = [
  // Targeted Attacks & Insults
  { phrase: 'fuck you', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'fuck u', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'fck you', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'fck u', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'fuck off', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'f off', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'fucking idiot', category: 'insult', severity: 'high', targeted: true },
  { phrase: 'you idiot', category: 'insult', severity: 'medium', targeted: true },
  { phrase: 'u idiot', category: 'insult', severity: 'medium', targeted: true },
  { phrase: 'stupid asshole', category: 'insult', severity: 'high', targeted: true },
  { phrase: 'dumb asshole', category: 'insult', severity: 'high', targeted: true },
  { phrase: 'piece of shit', category: 'insult', severity: 'high', targeted: true },
  { phrase: 'pile of shit', category: 'insult', severity: 'high', targeted: true },
  { phrase: 'son of a bitch', category: 'insult', severity: 'high', targeted: true },
  { phrase: 'son of a whore', category: 'insult', severity: 'critical', targeted: true },
  { phrase: 'shut the fuck up', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'shut your fucking mouth', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'go to hell', category: 'harassment', severity: 'medium', targeted: true },
  { phrase: 'go fuck yourself', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'eat shit', category: 'insult', severity: 'high', targeted: true },
  { phrase: 'suck my dick', category: 'sexual_vulgarity', severity: 'critical', targeted: true },
  { phrase: 'suck my cock', category: 'sexual_vulgarity', severity: 'critical', targeted: true },
  { phrase: 'suck my balls', category: 'sexual_vulgarity', severity: 'critical', targeted: true },
  { phrase: 'kiss my ass', category: 'insult', severity: 'medium', targeted: true },
  { phrase: 'kiss my arse', category: 'insult', severity: 'medium', targeted: true },
  { phrase: 'get fucked', category: 'harassment', severity: 'high', targeted: true },
  { phrase: 'jerk off', category: 'sexual_vulgarity', severity: 'medium', targeted: false },
  { phrase: 'jerking off', category: 'sexual_vulgarity', severity: 'medium', targeted: false },
  { phrase: 'damn you', category: 'harassment', severity: 'medium', targeted: true },
  { phrase: 'damn it', category: 'profanity', severity: 'medium', targeted: false },
];

// --------------------------------------------------------------------------
// 3. Obfuscation & Evasion Regex Patterns
// --------------------------------------------------------------------------
const EVASION_PATTERNS: Array<{
  regex: RegExp;
  cleanName: string;
  category: ViolationCategory;
  severity: SeverityLevel;
}> = [
  // F-word obfuscations: f*ck, f**k, f.u.c.k, f-u-c-k, f_u_c_k, f u c k, f@ck, f4ck, fuk, fucc, fuuuuck
  { regex: /\b(f[\s.\-_*@4u!]+c?k[a-z]*)\b/i, cleanName: 'fuck (obfuscated)', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\bf\s*[u*@4]\s*c\s*k\b/i, cleanName: 'f u c k (spaced)', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\b(f[u*@4]+c{2,})\b/i, cleanName: 'fucc variation', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\b(f[u*@4]+k+)\b/i, cleanName: 'fuk variation', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\b(f+[k*_#!@4\-]+)\b/i, cleanName: 'fck variation', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\b(m+o+t+h+e*r+f+[u*@_#!4]+c*k*[a-z]*)\b/i, cleanName: 'motherfucker variation', category: 'obfuscated_evasion', severity: 'critical' },

  // S-word obfuscations: sh!t, sh1t, sh*t, s h i t, s.h.i.t, s-h-i-t
  { regex: /\b(s[h*!1_\-.][i*!1_#\-.]t+[a-z]*)\b/i, cleanName: 'shit (obfuscated)', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\bs\s*[h*!1]\s*[i*!1]\s*t\b/i, cleanName: 's h i t (spaced)', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\b(b+u+l+l+s+h+[i*!1_#\-.]+t+)\b/i, cleanName: 'bullshit (obfuscated)', category: 'obfuscated_evasion', severity: 'high' },

  // B-word obfuscations: b!tch, b1tch, b*tch, b i t c h, b.i.t.c.h
  { regex: /\b(b[i*!1_#\-.][t*!1_#\-.]c+h+[a-z]*)\b/i, cleanName: 'bitch (obfuscated)', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\bb\s*[i*!1]\s*t\s*c\s*h\b/i, cleanName: 'b i t c h (spaced)', category: 'obfuscated_evasion', severity: 'high' },

  // A-word obfuscations: a$$, a$$hole, @sshole, 4sshole
  { regex: /\b([a@4][\$*@s]{2,}h+o+l+e*[a-z]*)\b/i, cleanName: 'asshole (obfuscated)', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\b([@4]s+s+h+o+l+e+[a-z]*)\b/i, cleanName: 'asshole (leetspeak)', category: 'obfuscated_evasion', severity: 'high' },
  { regex: /\b(d+u+m+b+[a@4][\$*@s]{2,})\b/i, cleanName: 'dumbass (obfuscated)', category: 'obfuscated_evasion', severity: 'high' },
  // Standalone a$$ or @ss (using non-alphanumeric boundaries since $ is not a word character)
  { regex: /(?:^|[^a-z0-9])([a@4][\$*]{2,}|[@4]s{2})(?:$|[^a-z0-9])/i, cleanName: 'ass (obfuscated)', category: 'obfuscated_evasion', severity: 'medium' },

  // C-word obfuscations: c*nt, c u n t, c.u.n.t
  { regex: /\b(c[u*@_#!.\-]+n+t+[a-z]*)\b/i, cleanName: 'cunt (obfuscated)', category: 'obfuscated_evasion', severity: 'critical' },
  { regex: /\bc\s*[u*@]\s*n\s*t\b/i, cleanName: 'c u n t (spaced)', category: 'obfuscated_evasion', severity: 'critical' },

  // D-word obfuscations: d!ck, d1ck, d*ck
  { regex: /\b(d[i*!1_#\-.]+c+k+[a-z]*)\b/i, cleanName: 'dick (obfuscated)', category: 'obfuscated_evasion', severity: 'high' },

  // P-word obfuscations: p*ssy, p@ssy, p1ssy
  { regex: /\b(p[u*@_#!1]+s+s+y+[a-z]*)\b/i, cleanName: 'pussy (obfuscated)', category: 'obfuscated_evasion', severity: 'high' },

  // W-word obfuscations: wh0re, wh*re
  { regex: /\b(w+h+[0*o]+r+e*[a-z]*)\b/i, cleanName: 'whore (obfuscated)', category: 'sexual_vulgarity', severity: 'high' },

  // S-word: sl*t
  { regex: /\b(s+l+[*u0!1]+t+[a-z]*)\b/i, cleanName: 'slut (obfuscated)', category: 'sexual_vulgarity', severity: 'high' },
];

// --------------------------------------------------------------------------
// 4. False-Positive Whitelist (Innocent words containing substrings)
// --------------------------------------------------------------------------
const INNOCENT_SAFE_WORDS = new Set([
  // Words containing "ass"
  'asset', 'assets', 'assistant', 'assist', 'assists', 'assisted', 'assisting',
  'pass', 'passed', 'passing', 'passenger', 'passport', 'password', 'passwords',
  'glass', 'glasses', 'grass', 'mass', 'massive', 'class', 'classes', 'classic', 'classical',
  'compass', 'bypass', 'harass', 'harassment', 'ambassador',
  'assume', 'assumed', 'assuming', 'assumption', 'assessment', 'assess',
  'association', 'associate', 'associated',

  // Words containing "tit"
  'title', 'titles', 'titled', 'entity', 'entities', 'attitude', 'quantity', 'quantities',
  'constitution', 'institute', 'institution',

  // Words containing "hell"
  'hello', 'shell', 'shells', 'helm', 'helmet',

  // Words containing "shit"
  'ship', 'ships', 'shipping', 'shift', 'shifts', 'shifted', 'sheet', 'sheets', 'shirt', 'shirts',

  // Words containing "bitch"
  'bit', 'bits', 'bitcoin', 'bitcoins', 'bite', 'bites', 'arbitrum', 'bitchain',

  // Words containing "dick"
  'predict', 'predicted', 'predicting', 'prediction', 'addict', 'addiction',
  'addicted', 'dictionary', 'dictation', 'verdict',

  // Words containing "cock"
  'cocktail', 'cocktails', 'peacock',

  // Words containing "crap" / "damn"
  'scrap', 'scraps', 'scrapped', 'damage', 'damages', 'damaged',

  // Words containing "horny"
  'horn', 'horns', 'hornet',

  // Community & Crypto Domain Terms
  'scam', 'scams', 'scammer', 'scammers', 'report', 'reported',
]);

// --------------------------------------------------------------------------
// 5. Normalization Helpers
// --------------------------------------------------------------------------

/**
 * Collapses repeating letters beyond 2 repeats (e.g. "fuuuuck" -> "fuuck", "shiiit" -> "shiit").
 */
function collapseRepeats(str: string): string {
  return str.replace(/(.)\1{2,}/g, '$1$1');
}

/**
 * Single-collapse to check single instance words (e.g. "fuuck" -> "fuck").
 */
function collapseToSingle(str: string): string {
  return str.replace(/(.)\1+/g, '$1');
}

/**
 * Normalizes common leetspeak substitutions.
 */
function normalizeLeetspeak(str: string): string {
  return str
    .replace(/[@4]/g, 'a')
    .replace(/[\$5]/g, 's')
    .replace(/[!1|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/\+/g, 't');
}

/**
 * Unwraps single characters separated by spaces or punctuation
 * (e.g. "f u c k" -> "fuck", "f.u.c.k" -> "fuck", "s-h-i-t" -> "shit").
 */
function unwrapSpacedLetters(text: string): string {
  // Matches 3 or more single letters separated by space or dot/dash/underscore
  return text.replace(/\b([a-z0-9$*!@])(?:[\s.\-_*]+([a-z0-9$*!@])){2,}\b/gi, (match) => {
    return match.replace(/[\s.\-_*]/g, '');
  });
}

/**
 * Checks if the context is an educational, quotation, or reporting question
 * without abusive intent directed at anyone.
 */
function isEducationalOrReportingContext(text: string): boolean {
  const lower = text.toLowerCase();

  // If text contains direct abusive phrases directed at "you", "u", "all", it is NOT educational
  if (
    lower.includes('fuck you') ||
    lower.includes('fucking idiot') ||
    lower.includes('you idiot') ||
    lower.includes('stupid asshole') ||
    lower.includes('shut up') ||
    lower.includes('stfu')
  ) {
    return false;
  }

  // Educational patterns (e.g. asking definition or moderation question)
  const educationalPatterns = [
    /what does (?:the word )?["']?(\w+)["']? mean/i,
    /definition of ["']?(\w+)["']?/i,
    /why is ["']?(\w+)["']? (?:blocked|filtered|banned)/i,
    /someone (?:called me|messaged me|sent me) /i,
    /how to report /i,
  ];

  return educationalPatterns.some((pattern) => pattern.test(text));
}

// --------------------------------------------------------------------------
// 6. Main Bad Words & Profanity Detector
// --------------------------------------------------------------------------

/**
 * Checks whether the given text contains English profanity, bad words, slurs,
 * offensive insults, sexual vulgarity, or evasion attempts.
 */
export function checkBadWords(rawText: string): BadWordsCheckResult {
  const text = rawText.trim();
  if (!text) {
    return { hasBadWords: false, detectedWords: [], categories: [] };
  }

  // Context check: If strictly educational or user reporting an abusive incident
  if (isEducationalOrReportingContext(text)) {
    return {
      hasBadWords: false,
      detectedWords: [],
      categories: [],
      reason: 'Educational or reporting context detected without abusive intent',
    };
  }

  const detected: string[] = [];
  const categories = new Set<ViolationCategory>();
  let highestSeverity: SeverityLevel = 'medium';
  let isTargetedAbuse = false;
  let isObfuscated = false;

  const updateSeverity = (level: SeverityLevel) => {
    if (level === 'critical') highestSeverity = 'critical';
    else if (level === 'high' && highestSeverity !== 'critical') highestSeverity = 'high';
  };

  const lower = text.toLowerCase();

  // Stage 1: Multi-Word Abusive Expressions (Direct Harassment & Insults)
  for (const rule of ABUSIVE_PHRASES) {
    if (lower.includes(rule.phrase)) {
      detected.push(rule.phrase);
      categories.add(rule.category);
      updateSeverity(rule.severity);
      if (rule.targeted) isTargetedAbuse = true;
    }
  }

  // Stage 2: Obfuscation & Evasion Regex Matching
  for (const rule of EVASION_PATTERNS) {
    const match = lower.match(rule.regex);
    if (match) {
      detected.push(match[0] || rule.cleanName);
      categories.add(rule.category);
      updateSeverity(rule.severity);
      isObfuscated = true;
    }
  }

  // Stage 3: Spaced / Punctuated Letter Collapse (e.g. "f u c k" -> "fuck")
  const unwrappedText = unwrapSpacedLetters(lower);

  // Stage 4: Token-Level Analysis (Clean Words, Normalized Leetspeak, Squashed Repeats)
  // Tokenize both original lower text and unwrapped text
  const tokensToCheck = new Set<string>();

  const extractTokens = (str: string) => {
    const words = str.match(/[a-z0-9$*!@_\-]+/g) || [];
    for (const w of words) {
      // Strip outer punctuation without stripping leetspeak symbols like $, *, @, !
      const clean = w.replace(/^[.,;:?()[\]{}'"~\\/]+|[.,;:?()[\]{}'"~\\/]+$/g, '');
      if (clean) tokensToCheck.add(clean);
    }
  };

  extractTokens(lower);
  extractTokens(unwrappedText);

  for (const token of tokensToCheck) {
    // 4a. False Positive Whitelist Check
    if (INNOCENT_SAFE_WORDS.has(token)) {
      continue;
    }

    // 4b. Direct match against lexicons
    if (SLURS_SET.has(token)) {
      detected.push(token);
      categories.add('slur');
      updateSeverity('critical');
      continue;
    }

    if (SEVERE_PROFANITIES.has(token)) {
      detected.push(token);
      categories.add('profanity');
      updateSeverity('high');
      continue;
    }

    if (SEXUAL_VULGARITIES.has(token)) {
      detected.push(token);
      categories.add('sexual_vulgarity');
      updateSeverity('high');
      continue;
    }

    if (MODERATE_PROFANITIES.has(token)) {
      detected.push(token);
      categories.add('profanity');
      updateSeverity('medium');
      continue;
    }

    // 4c. Normalized Leetspeak & Squashed Repeated Characters
    const collapsed = collapseRepeats(token);
    const singleCollapsed = collapseToSingle(token);
    const leetCollapsed = normalizeLeetspeak(collapsed);
    const leetSingle = normalizeLeetspeak(singleCollapsed);

    const variations = [collapsed, singleCollapsed, leetCollapsed, leetSingle];

    for (const v of variations) {
      if (INNOCENT_SAFE_WORDS.has(v)) break;

      if (SLURS_SET.has(v)) {
        detected.push(token);
        categories.add('slur');
        categories.add('obfuscated_evasion');
        updateSeverity('critical');
        isObfuscated = true;
        break;
      }

      if (SEVERE_PROFANITIES.has(v)) {
        detected.push(token);
        categories.add('profanity');
        categories.add('obfuscated_evasion');
        updateSeverity('high');
        isObfuscated = true;
        break;
      }

      if (SEXUAL_VULGARITIES.has(v)) {
        detected.push(token);
        categories.add('sexual_vulgarity');
        categories.add('obfuscated_evasion');
        updateSeverity('high');
        isObfuscated = true;
        break;
      }

      if (MODERATE_PROFANITIES.has(v)) {
        detected.push(token);
        categories.add('profanity');
        categories.add('obfuscated_evasion');
        updateSeverity('medium');
        isObfuscated = true;
        break;
      }

      if (v === 'ass' || v === 'asses') {
        detected.push(token);
        categories.add('profanity');
        categories.add('obfuscated_evasion');
        updateSeverity('medium');
        isObfuscated = true;
        break;
      }
    }

    // 4d. Standalone "ass" check (guarded by whitelist above)
    if (token === 'ass' || token === 'asses') {
      detected.push(token);
      categories.add('profanity');
      updateSeverity('medium');
    }
  }

  // Deduplicate detected words
  const uniqueDetected = Array.from(new Set(detected));

  if (uniqueDetected.length > 0) {
    const categoriesArray = Array.from(categories);
    return {
      hasBadWords: true,
      detectedWords: uniqueDetected,
      categories: categoriesArray,
      severity: highestSeverity,
      isTargetedAbuse,
      isObfuscated,
      reason: `Prohibited English expression(s) detected: ${uniqueDetected.join(', ')} [Categories: ${categoriesArray.join(', ')}]`,
    };
  }

  return {
    hasBadWords: false,
    detectedWords: [],
    categories: [],
  };
}
