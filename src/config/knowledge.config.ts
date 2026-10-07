/**
 * Elite Force Knowledge Base & Ecosystem Reference
 *
 * This configuration holds official ecosystem facts, verified topics,
 * official community links, and strict compliance boundaries.
 */

export interface KnowledgeItem {
  readonly topic: string;
  readonly summary: string;
  readonly details: string;
}

export const ELITE_FORCE_KNOWLEDGE = {
  ecosystemName: 'Elite Force',
  assistantName: 'Elite Force AI',
  description:
    'Elite Force is an innovative decentralized digital ecosystem and community designed to empower ' +
    'members through blockchain utility, Web3 innovations, and community-driven growth.',

  officialChannels: {
    telegramChannel: 'https://t.me/Elite_Force_Official',
    telegramHandle: '@Elite_Force_Official',
    xProfile: 'https://x.com/EliteForceOFC',
    xHandle: '@EliteForceOFC',
  },

  officialSystemLinks: {
    website: 'https://elite-force.space',
    timer: 'https://timer.elite-force.space',
  },

  nativeToken: {
    name: 'E-FORCE',
    symbol: 'E-FORCE',
    standard: 'BEP-20 (BNB Smart Chain)',
    utility: 'Native utility and governance asset for the decentralized Elite Force ecosystem.',
    status: 'In active development (Pre-launch).',
    launchDate: 'Not yet officially announced. Will be revealed exclusively on official channels.',
    listingDate: 'Not yet officially confirmed. Will be announced exclusively on official channels.',
  },

  corePillars: [
    'Community-First Engagement: Fostering an inclusive, transparent, and active global community.',
    'Decentralized Technology: Exploring cutting-edge blockchain, Web3, and digital utility solutions.',
    'Native E-FORCE Token: The core utility and governance pillar powering the ecosystem.',
    'Education & Support: Providing reliable guidance and official documentation for all community members.',
    'Security & Integrity: Emphasizing member safety, verified channels, and protection against scams.',
  ],

  officialGuidelines: [
    'Always verify announcements and links through official pinned channels and verified moderators.',
    'Official Telegram Channel: https://t.me/Elite_Force_Official',
    'Official X (Twitter): https://x.com/EliteForceOFC',
    'Admins and official team members will NEVER message you first asking for funds, private keys, passwords, or seed phrases.',
    'Beware of copycat accounts, fake bots, and unverified third-party groups.',
  ],

  unconfirmedTopicsWarning:
    'For launch dates, listing dates, token prices, contract addresses, audits, or reward mechanics, ' +
    'never present unconfirmed rumors. Direct community members to official announcements on https://t.me/Elite_Force_Official and https://x.com/EliteForceOFC.',
} as const;

export const SAFETY_BOUNDARIES = [
  'Never fabricate or guess details about unconfirmed roadmap items, launch dates, exchange listings, tokenomics, contracts, audits, or partnerships.',
  'Strictly avoid giving financial advice, price speculation, return guarantees, or investment recommendations.',
  'If information is unknown, explicitly state that it has not been officially announced yet and invite the user to check official channels.',
  'Never request or accept seed phrases, private keys, passwords, or transaction authorizations from users.',
] as const;
