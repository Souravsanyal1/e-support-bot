import fs from 'fs';
import path from 'path';

export type GamingNftStatus = 'planned' | 'in_development' | 'confirmed' | 'live' | 'cancelled';
export type GamingNftIntent =
  | 'definition' | 'launch' | 'claim' | 'supply' | 'benefits' | 'staking'
  | 'in_game_utility' | 'cost' | 'collection_verification' | 'claim_link_safety' | 'general';

export interface GamingNftFeature {
  featureName: string;
  description: string;
  status: GamingNftStatus;
  officialAnnouncementReference: string | null;
  nftSupply: string | number | null;
  mintingOrClaimEligibility: string | null;
  utilityAndBenefits: string | null;
  lastUpdated: string;
  /** Must be explicitly set by an authorized project editor with official evidence. */
  statusUpdateAuthorized: boolean;
}

interface GamingNftRegistry { features: GamingNftFeature[] }

const REGISTRY_PATH = path.resolve(process.cwd(), 'knowledge/gaming-nft.json');
const STATUSES = new Set<GamingNftStatus>(['planned', 'in_development', 'confirmed', 'live', 'cancelled']);
const NFT_TOPIC_RE = /\b(?:nfts?|gaming\s*nfts?|game\s*nfts?|nft\s*gaming|play[\s-]?to[\s-]?earn|(?:mint|claim|stake|staking|marketplace|collection|ownership|supply|rewards?|benefits?)\b.{0,32}\bnfts?)\b/i;
const INTENT_PATTERNS: Array<[GamingNftIntent, RegExp]> = [
  ['claim_link_safety', /\b(?:is|verify|legit(?:imate)?|safe|real|fake|fraudulent|official)\b.{0,60}\b(?:claim|mint)\s*link\b|\b(?:claim|mint)\s*link\b.{0,60}\b(?:legit|safe|real|fake|official|verify)\b/i],
  ['collection_verification', /\b(?:verify|official|authentic|legitimate)\b.{0,60}\b(?:nft\s*)?collection\b|\bcollection\b.{0,60}\b(?:verify|official|authentic)\b/i],
  ['supply', /\b(?:how many|supply|quantity|number|total)\b.{0,45}\bnfts?\b/i],
  ['launch', /\b(?:when|date|launch|release|go live)\b.{0,45}\b(?:gaming\s*)?nfts?\b|\b(?:gaming\s*)?nfts?\b.{0,45}\b(?:launch|release|available|live|date|when)\b/i],
  ['claim', /\b(?:how|where|when|can|claim|mint|eligible|eligibility)\b.{0,45}\b(?:claim|mint|gaming\s*nft|nft)\b|\b(?:claim|mint)\b/i],
  ['benefits', /\b(?:benefits?|rewards?|perks?|utility)\b.{0,45}\b(?:holders?|nfts?|collection)\b|\b(?:holders?|nfts?)\b.{0,45}\b(?:benefits?|rewards?|perks?)\b/i],
  ['staking', /\b(?:stake|staked|staking|apr|yield)\b.{0,45}\bnfts?\b|\bnfts?\b.{0,45}\b(?:stake|staked|staking|apr|yield)\b/i],
  ['in_game_utility', /\b(?:usable|use|utility|work|play|in[\s-]?game|games?)\b.{0,45}\bnfts?\b|\bnfts?\b.{0,45}\b(?:games?|in[\s-]?game|usable|utility)\b/i],
  ['cost', /\b(?:free|paid|price|cost|how much)\b.{0,45}\bnfts?\b|\bnfts?\b.{0,45}\b(?:free|paid|price|cost)\b/i],
  ['definition', /\bwhat\s+(?:is|are)\b.{0,45}\b(?:elite\s*force\s*)?(?:gaming\s*)?nfts?\b/i],
];

function isOfficialReference(reference: string | null): boolean {
  if (!reference) return false;
  try {
    const url = new URL(reference);
    return url.protocol === 'https:' && (
      (url.hostname === 't.me' && url.pathname.toLowerCase().startsWith('/eliteforce_official')) ||
      (url.hostname === 'x.com' && url.pathname.toLowerCase().startsWith('/eliteforceofc')) ||
      (url.hostname === 'elite-force.space' || url.hostname.endsWith('.elite-force.space'))
    );
  } catch { return false; }
}

function isValidFeature(value: unknown): value is GamingNftFeature {
  if (!value || typeof value !== 'object') return false;
  const f = value as Partial<GamingNftFeature>;
  return typeof f.featureName === 'string' && typeof f.description === 'string' &&
    typeof f.status === 'string' && STATUSES.has(f.status as GamingNftStatus) &&
    (typeof f.officialAnnouncementReference === 'string' || f.officialAnnouncementReference === null) &&
    (typeof f.nftSupply === 'string' || typeof f.nftSupply === 'number' || f.nftSupply === null) &&
    (typeof f.mintingOrClaimEligibility === 'string' || f.mintingOrClaimEligibility === null) &&
    (typeof f.utilityAndBenefits === 'string' || f.utilityAndBenefits === null) &&
    typeof f.lastUpdated === 'string' && typeof f.statusUpdateAuthorized === 'boolean';
}

/** Reads only schema-valid entries; a status needs explicit authorization and an official source. */
export function loadGamingNftRegistry(): GamingNftRegistry {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as GamingNftRegistry).features)) return { features: [] };
    return { features: (parsed as GamingNftRegistry).features.filter(isValidFeature) };
  } catch { return { features: [] }; }
}

export function isGamingNftQuestion(text: string): boolean { return NFT_TOPIC_RE.test(text); }

export function classifyGamingNftIntent(text: string): GamingNftIntent {
  for (const [intent, pattern] of INTENT_PATTERNS) if (pattern.test(text)) return intent;
  return 'general';
}

function confirmedFeatureFacts(feature: GamingNftFeature): string[] {
  if (!feature.statusUpdateAuthorized || !isOfficialReference(feature.officialAnnouncementReference)) return [];
  if (feature.status === 'cancelled') return [`${feature.featureName}: cancelled. ${feature.description}`];
  const facts = [`${feature.featureName} (${feature.status}): ${feature.description}`];
  if (feature.nftSupply !== null) facts.push(`Officially confirmed supply: ${feature.nftSupply}.`);
  if (feature.mintingOrClaimEligibility) facts.push(`Official eligibility: ${feature.mintingOrClaimEligibility}`);
  if (feature.utilityAndBenefits) facts.push(`Official utility/benefits: ${feature.utilityAndBenefits}`);
  return facts;
}

/** Returns only facts backed by an authorized status and an official reference. */
export function getConfirmedGamingNftFacts(): string[] {
  return loadGamingNftRegistry().features.flatMap(confirmedFeatureFacts);
}

export function getGamingNftKnowledgeContext(): string {
  const facts = getConfirmedGamingNftFacts();
  return [
    'GAMING NFT KNOWLEDGE AND SAFETY RULES',
    'A Gaming NFT may represent a digital collectible, in-game item, membership, access right, achievement, or other blockchain utility depending on a project implementation. This is general background, not a claim that Elite Force has implemented any such feature.',
    facts.length ? `Officially supported Elite Force Gaming NFT registry facts:\n${facts.join('\n')}` : 'No Elite Force Gaming NFT features or specifics are currently officially confirmed in the editable registry. Do not infer that any feature is planned, implemented, live, free, paid, claimable, or available.',
    'Never invent or infer NFT prices, supply, rarity, launch or mint dates, claim URLs, rewards, staking APR, eligibility, or game utility. Distinguish planned, in_development, confirmed, live, and cancelled exactly; registry presence alone does not mean a feature is live.',
    'For unconfirmed information, say official details have not yet been confirmed and direct users to https://t.me/EliteForce_Official and https://x.com/EliteForceOFC.',
    'Warn users about fake minting websites and fraudulent claim links. Never ask for or accept a wallet seed phrase or private key. Do not promise profit or financial returns from NFTs.',
  ].join('\n');
}

export function getGamingNftContextForQuestion(question: string): string | null {
  if (!isGamingNftQuestion(question)) return null;
  return `${getGamingNftKnowledgeContext()}\nDetected support intent: ${classifyGamingNftIntent(question)}.`;
}

