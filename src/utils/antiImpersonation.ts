/** The only support contact the bot should endorse in safety responses. */
export const OFFICIAL_SUPPORT_USERNAME = 'EliteForceSupportTeam';

export const OFFICIAL_SAFETY_NOTICE =
  'For your safety, contact only the official Elite Force Support Team: @EliteForceSupportTeam. Official admins will never initiate DMs. Do not share passwords, private keys, or seed phrases.';

export interface SuspiciousContactPromotion {
  handleCount: number;
}

/**
 * Finds posts that direct members toward an unapproved account in a support,
 * admin, wallet, payment, verification, claim, or urgent-help context.
 */
export function detectSuspiciousContactPromotion(text: string): SuspiciousContactPromotion | null {
  const targets = new Set<string>();
  for (const match of text.matchAll(/@([A-Za-z][A-Za-z0-9_]{4,31})/g)) {
    targets.add(`telegram:${match[1].toLowerCase()}`);
  }
  for (const match of text.matchAll(/(?:https?:\/\/)?(?:www\.)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})/gi)) {
    targets.add(`telegram:${match[1].toLowerCase()}`);
  }

  const approvedTelegramHandles = new Set([
    OFFICIAL_SUPPORT_USERNAME.toLowerCase(),
    'eliteforce_official',
    'eliteforcecommunity',
  ]);
  const approvedDomains = new Set([
    'elite-force.space', 'timer.elite-force.space', 'x.com', 'www.x.com', 't.me', 'www.t.me',
  ]);
  for (const match of text.matchAll(/https?:\/\/[^\s<>()]+/gi)) {
    const rawUrl = match[0].replace(/[.,!?;:)\]]+$/, '');
    try {
      const url = new URL(rawUrl);
      if (url.hostname === 't.me' || url.hostname === 'www.t.me') {
        const linkedHandle = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
        if (linkedHandle) targets.add(`telegram:${linkedHandle}`);
      } else if (!approvedDomains.has(url.hostname.toLowerCase())) {
        targets.add(`url:${url.hostname.toLowerCase()}`);
      }
    } catch {
      targets.add(`url:${rawUrl.toLowerCase()}`);
    }
  }

  const unapprovedTargets = [...targets].filter((target) => {
    if (!target.startsWith('telegram:')) return true;
    return !approvedTelegramHandles.has(target.slice('telegram:'.length));
  });
  if (!unapprovedTargets.length) return null;

  const directsContact = /\b(dm|direct\s+message|contact|message|reach\s+out|write\s+to|text|pm|telegram|click|visit|open|use|follow|go\s+to|claim|verify|connect)\b/i.test(text);
  const highRiskContext = /\b(official|support|admin|administrator|moderator|urgent|payment|pay|wallet|verify|verification|token|claim|airdrop|account\s+recovery|recovery|unlock|assistance|help|seed\s+phrase|private\s+key)\b/i.test(text);
  if (!directsContact || !highRiskContext) return null;

  return { handleCount: unapprovedTargets.length };
}
