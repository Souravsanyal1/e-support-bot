/**
 * Security utility: detects prompt injection attacks and system extraction attempts.
 *
 * Attackers often try to:
 * - Override the system prompt ("ignore previous instructions")
 * - Extract internal config ("what is your system prompt?")
 * - Impersonate admin or escalate privileges
 * - Exfiltrate admin IDs, tokens, or API keys
 */

/**
 * Patterns that indicate a prompt injection / system extraction attack.
 * Case-insensitive. Any match = potential attack.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  // Classic jailbreak openers
  /\b(ignore|disregard|override|bypass)\s+(all\s+)?(your\s+)?(system|developer)\s+(prompt|instructions?|rules?)\b/i,
  /\b(developer|official\s+developer)\b.{0,60}\b(approved|authorized|gave\s+permission)\b.{0,80}\b(ignore|reveal|disclose|confidential|secret)\b/i,
  /\b(you\s+are\s+authorized|you\s+have\s+permission)\b.{0,80}\b(ignore|reveal|disclose|confidential|secret)\b/i,
  /\b(disclose|reveal|dump|print|send)\b.{0,60}\b(confidential|private|secret|credentials|internal\s+data)\b/i,
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /override\s+(your\s+)?(instructions?|rules?|prompt|system)/i,
  /you\s+are\s+now\s+(an?\s+)?(different|new|jailbreak|evil|unfiltered|DAN)/i,
  /act\s+as\s+(if\s+)?(you\s+are\s+)?(an?\s+)?(different|unfiltered|evil|DAN)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(an?\s+)?(unfiltered|unrestricted|evil|DAN)/i,
  /you\s+have\s+no\s+(restrictions?|limits?|rules?|guidelines?)/i,
  /hypothetically[,\s]+if\s+(you\s+)?(could|were able)\s+(to\s+)?/i,

  // System prompt extraction
  /show\s+(me\s+)?(your|the)\s+system\s+prompt/i,
  /what\s+(is|are)\s+your\s+(system\s+)?instructions?/i,
  /reveal\s+(your|the)\s+(system\s+)?(prompt|instructions?|configuration|config)/i,
  /print\s+(your|the)\s+(system\s+)?(prompt|instructions?)/i,
  /output\s+(your|the)\s+(initial|full|entire|system)\s+(prompt|instructions?)/i,
  /repeat\s+(the\s+)?(first|above|system|initial)\s+(prompt|message|instructions?)/i,
  /repeat\s+(everything|all\s+text)\s+(above|before\s+this)/i,
  /translate\s+(your\s+)?(system\s+)?prompt/i,
  /tell\s+me\s+(your|the)\s+(system\s+)?(prompt|instructions?|config)/i,
  /what\s+(is|are)\s+your\s+(hidden|secret|internal)\s+(instructions?|rules?|prompt)/i,
  /display\s+(your|the)\s+(system\s+)?(prompt|rules?|instructions?)/i,

  // Admin / token / config extraction
  /what\s+(is|are)\s+(your|the)\s+admin\s+(id|ids?|user)/i,
  /who\s+is\s+(the\s+)?admin\s+id/i,
  /show\s+(the\s+)?(admin|owner)\s+(id|token|key)/i,
  /what\s+is\s+(the\s+)?(bot\s+)?(token|api\s+key|secret)/i,
  /reveal\s+(the\s+)?(api\s+key|bot\s+token|secret|admin\s+id)/i,
  /give\s+me\s+(the\s+)?(admin|owner|bot)\s+(id|token|key|access)/i,
  /(telegram|bot)\s+token/i,
  /api\s+key/i,
  /\.env\s+file/i,
  /environment\s+variable/i,
  /process\.env/i,
];

/**
 * Patterns that indicate the user is trying to extract sensitive data about
 * the backend infrastructure, hosting, or developer identity.
 */
const INFRASTRUCTURE_PATTERNS: readonly RegExp[] = [
  /where\s+(is|are)\s+(this\s+)?(bot|server)\s+hosted/i,
  /what\s+server\s+(is\s+this|do\s+you\s+use)/i,
  /server\s+ip\s+address/i,
  /hosting\s+provider/i,
  /render\.com/i,
  /railway\.app/i,
  /heroku/i,
  /source\s+code/i,
  /github\s+(repo|repository|link)/i,
  /who\s+(built|created|made|coded|programmed)\s+(you|this\s+bot)/i,
  /developer('?s?)?\s+(name|telegram|contact|id)/i,
];

export interface SecurityCheckResult {
  /** True if the message is a security threat */
  isThreat: boolean;
  /** Classification of threat type */
  threatType: 'injection' | 'infrastructure_probe' | null;
  /** Safe decline response to send back */
  safeResponse: string;
}

const SAFE_DECLINE =
  "I’ll stick with my role as Elite Force’s AI support assistant. I can help with verified project questions or community support.";

/**
 * Checks a user message for prompt injection or infrastructure extraction attempts.
 * Returns a result indicating whether the message is a threat and what to reply.
 */
export function checkPromptSecurity(message: string): SecurityCheckResult {
  // Normalize compatibility characters and remove invisible separators often
  // used to evade phrase-based checks (for example, "ign​ore instructions").
  const text = message
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/[Сс]/g, 'c')
    .replace(/[Аа]/g, 'a')
    .replace(/[Ее]/g, 'e')
    .replace(/[Оо]/g, 'o')
    .replace(/[Рр]/g, 'p')
    .replace(/[Хх]/g, 'x')
    .replace(/[Іі]/g, 'i')
    .trim();

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        isThreat: true,
        threatType: 'injection',
        safeResponse: SAFE_DECLINE,
      };
    }
  }

  for (const pattern of INFRASTRUCTURE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        isThreat: true,
        threatType: 'infrastructure_probe',
        safeResponse: SAFE_DECLINE,
      };
    }
  }

  return { isThreat: false, threatType: null, safeResponse: '' };
}
