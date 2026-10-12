/**
 * English Bad Words & Profanity Detector for Elite Force Telegram Support Bot
 *
 * Detects:
 * 1. Severe English profanities, vulgarities, and obscenities (fuck, shit, bitch, asshole, etc.)
 * 2. Slurs, hate speech, and harassment (racial, sexual, derogatory slurs)
 * 3. Sexual/NSFW explicit vulgar terms (blowjob, porn, etc.)
 * 4. Multi-word abusive phrases (fuck you, son of a bitch, shut the fuck up, suck my dick, etc.)
 * 5. Obfuscated / Leetspeak profanity (f*ck, f**k, b!tch, a$$hole, sh!t, etc.)
 * 6. Repeated character variations (fuuuuck, shiiit, biiiitch, etc.)
 *
 * Safeguarded against false positives on common words (assistant, asset, pass, password, etc.).
 */

export interface BadWordsCheckResult {
  hasBadWords: boolean;
  detectedWords: string[];
  reason?: string;
}

// 1. Exact Single-Word Bad Words / Profanities (Checked against clean word tokens)
const BAD_WORDS_SET = new Set([
  // F-word family
  'fuck', 'fucks', 'fucker', 'fuckers', 'fucking', 'fucked', 'fuckin',
  'motherfucker', 'motherfuckers', 'motherfucking', 'motherfuckerz',
  'mothafucka', 'mf', 'mfs',

  // S-word family
  'shit', 'shits', 'shitty', 'shitted', 'shat',
  'bullshit', 'horseshit', 'dipshit',

  // B-word family
  'bitch', 'bitches', 'bitching', 'bitchy', 'bitchass',

  // A-word family
  'asshole', 'assholes', 'arsehole', 'arseholes', 'dumbass', 'dumbasses',
  'jackass', 'jackasses', 'asswipe', 'badass', 'arse',

  // Standalone abusive words
  'bastard', 'bastards',
  'dick', 'dicks', 'dickhead', 'dickheads',
  'cock', 'cocks', 'cocksucker', 'cocksuckers',
  'pussy', 'pussies',
  'cunt', 'cunts',
  'whore', 'whores',
  'slut', 'sluts',
  'prick', 'pricks',
  'twat', 'twats',
  'wanker', 'wankers',
  'bollocks',

  // Slurs & Hate Speech
  'nigger', 'niggers', 'nigga', 'niggas',
  'faggot', 'faggots', 'fag', 'fags',
  'retard', 'retards', 'retarded',
  'chink', 'gook', 'kike', 'spic',

  // Explicit / Sexual / Adult
  'blowjob', 'blowjobs', 'handjob', 'handjobs',
  'porn', 'porno', 'pornography',
  'dildo', 'dildos',
  'stfu',
]);

// 2. Multi-Word Abusive Phrases (Matched against normalized lowercase text)
const BAD_PHRASES = [
  'fuck you',
  'fuck u',
  'fck you',
  'fck u',
  'fuck off',
  'f off',
  'go fuck yourself',
  'go to hell',
  'shut the fuck up',
  'shut your fucking mouth',
  'son of a bitch',
  'son of a whore',
  'piece of shit',
  'pile of shit',
  'eat shit',
  'suck my dick',
  'suck my cock',
  'suck my balls',
  'kiss my ass',
  'kiss my arse',
  'get fucked',
];

// 3. Regex Patterns for Obfuscations & Leetspeak (with strict word boundaries)
const OBFUSCATED_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // f*ck, f**k, f***, f_ck, f-ck, fuk, fck, fuking, fckn
  { regex: /\b(f[u*@_#!\-0]+c?k[a-z]*)\b/i, label: 'f*ck variation' },
  { regex: /\b(f+[k*_#!\-]+)\b/i, label: 'fck variation' },
  { regex: /\b(m+o+t+h+e*r+f+[u*@_#!]+c*k*[a-z]*)\b/i, label: 'motherfucker variation' },

  // b*tch, b!tch, b1tch
  { regex: /\b(b[i*!1_#\-]t+c+h+[a-z]*)\b/i, label: 'b*tch variation' },

  // sh*t, s**t, sh!t, s-h-i-t
  { regex: /\b(s[h*!1_\-][i*!1_#\-]t+[a-z]*)\b/i, label: 'sh*t variation' },
  { regex: /\b(b+u+l+l+s+h+[i*!1_#\-]+t+)\b/i, label: 'bullshit variation' },

  // a$$hole, a**hole, a**
  { regex: /\b(a[\$*@]{2,}h+o+l+e*[a-z]*)\b/i, label: 'a$$hole variation' },
  { regex: /\b(a+s+s+h+o+l+e+[a-z]*)\b/i, label: 'asshole variation' },
  { regex: /\b(d+u+m+b+a+s+s+[a-z]*)\b/i, label: 'dumbass variation' },

  // c*nt, c**t
  { regex: /\b(c[u*@_#!]+n+t+[a-z]*)\b/i, label: 'c*nt variation' },

  // d*ck, d!ck
  { regex: /\b(d[i*!1_#\-]+c+k+[a-z]*)\b/i, label: 'd*ck variation' },

  // p*ssy
  { regex: /\b(p[u*@_#!]+s+s+y+[a-z]*)\b/i, label: 'p*ssy variation' },

  // Spaced out swear words: f u c k, b i t c h, s h i t
  { regex: /\bf\s+[u*]\s+c\s+k\b/i, label: 'spaced f u c k' },
  { regex: /\bb\s+[i*!1]\s+t\s+c\s+h\b/i, label: 'spaced b i t c h' },
  { regex: /\bs\s+[h*]\s+[i*!1]\s+t\b/i, label: 'spaced s h i t' },

  // Standalone "ass" when strictly isolated (protecting pass, asset, class, mass, etc.)
  { regex: /\b(a[\$*]{2}|a+s+s+)\b/i, label: 'ass variation' },
];

/**
 * Collapses repeating letters (e.g. "fuuuuck" -> "fuck", "shiiit" -> "shit").
 */
function collapseRepeats(str: string): string {
  return str.replace(/(.)\1{2,}/g, '$1$1');
}

/**
 * Normalizes common leetspeak substitutions to standard Latin alphabets.
 */
function normalizeLeetspeak(str: string): string {
  return str
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/!/g, 'i')
    .replace(/1/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/5/g, 's');
}

/**
 * Checks whether the given text contains any bad words, profanities, or abusive terms in English.
 */
export function checkBadWords(rawText: string): BadWordsCheckResult {
  const text = rawText.trim();
  if (!text) {
    return { hasBadWords: false, detectedWords: [] };
  }

  const detected: string[] = [];
  const lower = text.toLowerCase();

  // 1. Check Multi-Word Abusive Phrases
  for (const phrase of BAD_PHRASES) {
    if (lower.includes(phrase)) {
      detected.push(phrase);
    }
  }

  // 2. Check regex patterns for obfuscations & leetspeak
  for (const { regex, label } of OBFUSCATED_PATTERNS) {
    const match = lower.match(regex);
    if (match) {
      detected.push(match[0] || label);
    }
  }

  // 3. Tokenize into words and check against BAD_WORDS_SET
  // Clean punctuation from word boundaries while preserving internal letters
  const rawWords = lower.match(/[a-z0-9$*!@_\-]+/g) || [];
  for (const rawWord of rawWords) {
    // Strip leading/trailing symbols
    const cleanWord = rawWord.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (!cleanWord) continue;

    if (BAD_WORDS_SET.has(cleanWord)) {
      detected.push(cleanWord);
      continue;
    }

    // Check with collapsed repeated letters (e.g. fuuuuck -> fuck)
    const collapsed = collapseRepeats(cleanWord);
    if (BAD_WORDS_SET.has(collapsed)) {
      detected.push(collapsed);
      continue;
    }

    // Check with normalized leetspeak (e.g. b!tch -> bitch, sh1t -> shit)
    const normalizedLeet = normalizeLeetspeak(collapsed);
    if (BAD_WORDS_SET.has(normalizedLeet)) {
      detected.push(normalizedLeet);
      continue;
    }
  }

  const uniqueDetected = Array.from(new Set(detected));

  if (uniqueDetected.length > 0) {
    return {
      hasBadWords: true,
      detectedWords: uniqueDetected,
      reason: `English bad word(s) detected: ${uniqueDetected.join(', ')}`,
    };
  }

  return {
    hasBadWords: false,
    detectedWords: [],
  };
}
