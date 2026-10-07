/**
 * Elite Force Knowledge Base & Ecosystem Reference
 *
 * This configuration holds official ecosystem facts, verified topics,
 * official community links, and strict compliance boundaries.
 * Maintainers can easily update these entries as official details evolve.
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
    'Elite Force is an innovative digital ecosystem and community designed to empower members ' +
    'through modern decentralized technology, community collaboration, and digital utility.',

  corePillars: [
    'Community-First Engagement: Fostering an inclusive, transparent, and active global community.',
    'Decentralized Technology: Exploring cutting-edge blockchain, Web3, and digital utility solutions.',
    'Education & Support: Providing reliable guidance and official documentation for all community members.',
    'Security & Integrity: Emphasizing member safety, verified channels, and protection against scams.',
  ],

  officialGuidelines: [
    'Always verify announcements and links through official pinned channels and verified moderators.',
    'Admins and official team members will NEVER message you first asking for funds, private keys, passwords, or seed phrases.',
    'Beware of copycat accounts, fake bots, and unverified third-party groups.',
  ],

  unconfirmedTopicsWarning:
    'For any topic where unconfirmed or speculative details exist (such as future listings, token prices, audits, or reward mechanics), ' +
    'always consult official announcements or reach out to verified team moderators.',
} as const;

export const SAFETY_BOUNDARIES = [
  'Never fabricate or guess details about unconfirmed roadmap items, tokenomics, contracts, audits, or partnerships.',
  'Strictly avoid giving financial advice, price speculation, return guarantees, or investment recommendations.',
  'If information is unknown, explicitly state: "I don\'t have confirmed official information on that yet. Please check official announcements or ask our community team."',
  'Never request or accept seed phrases, private keys, passwords, or transaction authorizations from users.',
] as const;
