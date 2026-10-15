# Gaming NFT Support

Status: FINALIZED

## Goal
Add an editable, safe, official-information-driven Gaming NFT topic to the Elite Force AI Community Support Bot.

## Requirements
- Detect Gaming NFT and related gaming, play-to-earn, staking, utility, collection, ownership, marketplace, mint, claim, eligibility, supply, reward, and benefit language.
- Classify the requested Gaming NFT support intent, including definition, launch, claim, supply, benefits, staking, in-game utility, cost, collection verification, and claim-link safety.
- Explain the general NFT concept simply while distinguishing general possibilities from confirmed Elite Force facts.
- Store feature registry entries with name, description, status (`planned`, `in_development`, `confirmed`, `live`, `cancelled`), official reference, supply, eligibility, utility/benefits, and last-updated timestamp.
- Seed no Elite Force NFT features as confirmed or live. Config presence alone must never imply live status.
- Include relevant verified Gaming NFT facts in the existing assistant knowledge context, retaining the existing Gemini conversation pipeline.
- Do not invent dates, supply, prices, rarity, links, rewards, APR, or eligibility; direct users to official channels when details are unknown.
- Warn about fake mint/claim links and never ask for seed phrases or private keys. Never imply guaranteed financial returns.
- Add automated tests for unknown launch dates, unconfirmed rewards, fake claim links, authorized status updates, intent/topic detection, and general Gaming NFT questions.

## Boundaries
- Official information means a populated official announcement reference and an explicitly authorized status/fact update in the local editable registry. Empty/unverified values are unknown.
- This work does not publish NFT features or make any project announcements.
- User questions continue through the existing AI response and conversation-context pipeline with dedicated Gaming NFT evidence and guardrails.

## Verification
- Run the repository typecheck/build and automated test suite; report captured results.
