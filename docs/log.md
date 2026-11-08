# Surety running log

Decisions, open questions and spend. Runtime spend (what Surety itself costs per job) is kept separate from coding-agent spend (building it).

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-08 | Target the Agentic Finance (Ripple) track | Its MVP rules (agent-executed testnet transaction, limits outside the agent, operator-set limits) match Surety's design |
| 2026-11-08 | Pay in XRP, not RLUSD | The testnet RLUSD issuer has token escrow switched off (checked live at ledger 22165841) |
| 2026-11-08 | Hand-rolled PREIMAGE-SHA-256 conditions | The library in XRPL's samples was last published in 2017; encoding verified against rippled's own test vectors |
| 2026-11-08 | Isolated signer process with three HMAC-authenticated operations | Spec's signer isolation; the only holder of keys |
| 2026-11-08 | OpenRouter for both Jev (`typesafe/jev-1.14`) and the agents (`anthropic/claude-haiku-5.5`) | One key, one $5 cap, one bill |
| 2026-11-08 | Approved additions: operator limits panel, Haiku buyer agent, free-text `summary` field judged by Jev, ledger-linked receipt page, live pipeline view. Stretch: stand-in token escrow, Paperclip-hosted seller | Track requirements and design review |
| 2026-11-08 | UI look rebuilt fresh, not copied from the earlier interface | That interface is employer work |
| 2026-11-08 | Public repo `Marko-AI-Dev/surety`, commits with the GitHub noreply address | Submission requires a public repo |
| 2026-11-08 | Team "Surety - Marko Solo", project "Surety" | Product plus solo build, read cleanly by an MC |
| 2026-11-08 | Phase 2: local Supabase stack (project `surety`, ports 577xx, storage and analytics off) with four tables: jobs, escrows, transactions, job_events | The 7-table cut minus what later phases add; the database mirrors, the ledger decides |
| 2026-11-08 | Backend SQL through `postgres` 4.1.0 as the `postgres` role; RLS on with no policies until the UI phase | No browser access yet, so nothing but the backend can read the tables |
| 2026-11-08 | Deterministic operation ids (name-based UUID from sha256 of job, operation and attempt) | A restarted worker replays at the signer instead of signing a second cancel |
| 2026-11-08 | Expiry worker connects to the ledger on demand inside each sweep | A slow testnet node failed one boot at the 5 s connect timeout; now it costs one logged sweep, not the process |
| 2026-11-08 | `pnpm test:db` empties the local job tables before each test | `job_events` refuses DELETE by design, and the local stack is disposable |

## Open questions

- Who is the first customer, and the African users angle for the checkpoint and the Business score.
- Does the rubric's "testnet deployment" mean a hosted app? Ask at the checkpoint.
- Does an agent acting through a policy-enforcing signer count as "executed autonomously by an agent"? Ask a Ripple mentor.

## Runtime spend (test funds and API calls)

| Date | What | Cost |
|---|---|---|
| 2026-11-08 | Testnet faucet: 3 wallets x 100 test XRP | Free, valueless |
| 2026-11-08 | Two testnet spike runs: fees burned per run (2 creates 12 + finish 423 + cancel 12 drops) | 2 x 459 drops = 0.000918 test XRP |
| 2026-11-08 | OpenRouter smoke test: 3 Jev calls + 1 Haiku call | $0.000266 |
| 2026-11-08 | Restart refund demo on testnet: 1 create + 1 cancel (12 drops each); the 1 test XRP principal came back | 24 drops = 0.000024 test XRP |

## Coding-agent spend

Claude Code; not metered per task here.
