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
| 2026-11-09 | Phase 3 gate: deterministic rules, then Jev (two yes/no questions), then a versioned policy; the worker became the job engine (evaluate, settle, refund) | Rules decide facts; Jev judges the free-text summary; nothing pays without a validated `tesSUCCESS` |
| 2026-11-09 | `source_values` compares field by field and line items as a multiset against the parsed source invoice, not substring presence | Substring matching let a deliverable drop a line and report a smaller total while passing every rule |
| 2026-11-09 | `policy-v2`: approve from Jev satisfaction 0.70 (was 0.90); injection and decline thresholds unchanged; `policy-v1` kept | Labelled train split: honest work scored 0.75 and 0.77 and was escalated under v1, while every bad file scored 0.04 or less. No bad file approved on train or holdout. See docs/research/05-jev-calibration.md |
| 2026-11-09 | `policy-v2` kept after a rerun with 8 holdout probes aimed at the 0.70 to 0.89 band (4 honest but awkward, 4 false but polite) | 0 bad files approved in either split; the band held 2 good and 0 bad holdout files, both approved; false-but-polite probes scored 0.01 to 0.02. The calibration script now exits 1 if any bad file is approved under the current policy |
| 2026-11-09 | The job engine resumes jobs left in `EVALUATING` by a dead worker (re-judged if no decision was recorded, otherwise the recorded decision is applied) | A crash between the claim and the verdict no longer costs an honest seller the job. Assumes one worker; a lease comes before scaling out |
| 2026-11-09 | One decision per job and deliverable (database unique constraint); a racing evaluator adopts the winner's verdict. Resumes of an `EVALUATING` job are capped at 3, then `REVIEW_REQUIRED`. Each engine pass refunds first, then judges, then pays | Security review: resuming without a claim lost mutual exclusion, and a job that always failed evaluation was retried every pass ahead of refunds |
| 2026-11-09 | Decision cutoff 30 s before `CancelAfter` by ledger time: no evaluation, no authorization, no finish call after it | A late approval must refund, not race the expiry |
| 2026-11-09 | Settlement retries replay the open authorization's operation id first, even after it expires; only a refusal of an expired one mints the next attempt | A finish the signer already submitted is found by its own id, never replaced |
| 2026-11-09 | Worker `JEV_MODE` is `live` or `fixture`, default live; fixture decisions are labelled `fixture` and the boot line names the mode | Fixtures never pass for live Jev |
| 2026-11-09 | Showcase scenario is now an import purchase, working like a digital letter of credit: the importer's payment is locked and released only when the invoice and bill of lading match the purchase order. See docs/product-brief.md | Marko wants a real, high-value business use case that judges and companies can test themselves. The engine is reused unchanged |
| 2026-11-09 | "Deal" replaces "Job" in all user-facing wording | Marko's call; the user is a business buying goods |
| 2026-11-09 | The primary user is the importer's treasury lead, and the supplier gets its own page | Only the paying side shows an agent spending within limits a person set (the track rule) |
| 2026-11-09 | Pay in tUSD, a self-issued test dollar, through XRPL token escrow. This replaces "Pay in XRP" for deals | Realistic amounts, and the same trust-line mechanism RLUSD would use. A testnet trial proved the lock, the ledger refusing a wrong key, an early refund and a late release, the exact payout and the full refund |
| 2026-11-09 | The token is renamed from tUSD to TESTUSD on the ledger, shown in the app as "$48,000 (test)" | TUSD is the ticker of TrueUSD, a real stablecoin |
| 2026-11-09 | Add a Quote step: the supplier quotes, and the deal agent accepts or declines against the intent and the policy before the lock | The agent, not a person, makes the buying decision (the track rule). Follows the Intent, Policy, Quote, Settlement, Audit loop |
| 2026-11-09 | Three side-by-side panels: Deals (Use), Control room (Control), Attack lab (Attack), plus a failure mode table | Covers the use, control and attack lenses Marko found on the Agentic Payments Hackathon Toronto page |
| 2026-11-09 | Signer change approved: TESTUSD amounts, a daily cap and an open-deal limit | It keeps the same three operations and the same isolation |
| 2026-11-09 | The user-facing name for the gate is "Surety Verify" (rules, then a decision model). The vendor is credited in the README, never claimed as ours, and never called deterministic | Marko's call. A repeat test scored the same input 0.72 to 0.76 across 5 runs |
| 2026-11-09 | Paperclip is built as a native "Ask Surety" chat that can hire permanent agents with operator-approved budgets. The Paperclip runtime appears in the pitch only, or in a Thursday stretch demo | Same user experience without a second system on stage or AWM-plan billing. Hiring becomes a Control feature |
| 2026-11-09 | QR audience attack page (tamper with documents, or talk to the agent), with a live feed, built after the core works | The strongest live moment. Needs a public URL, so it depends on the hosting decision |
| 2026-11-09 | Build with small TESTUSD limits ($2,500 per deal, $25,000 per rolling 24 hours, 5 open deals), and raise them to demo values ($100,000 and $500,000) on Thursday | Marko: keep test values low while building. The amounts cost nothing either way, because TESTUSD is self-issued |
| 2026-11-09 | Limits change instantly through an operator-only signer operation with its own secret, which the worker and agents never hold, and every change is kept in a history file | Marko chose live changes over restart-to-apply. The demo shows the operator lowering a cap and the agent's next deal being refused. The signer becomes three money operations plus one policy update |
| 2026-11-09 | In Phase 4b, Surety Verify re-asks the decision model when a score lands next to a threshold and uses the middle of three answers | Jev's scores move a few hundredths between identical calls (OpenRouter and TypeSafe document this). Only borderline cases cost the two extra calls |

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
| 2026-11-09 | Jev calibration: 20 labelled deliverables, one live call each | $0.000639 |
| 2026-11-09 | Jev calibration rerun: 28 labelled deliverables, one live call each | $0.000894 |
| 2026-11-09 | Outcomes demo: 2 live Jev calls (paid, blocked); the rejected job never called Jev and the offline job hit a dead local endpoint | $0.000064 |
| 2026-11-09 | Outcomes demo on testnet: 4 creates (12 drops each), 1 finish (423), 3 cancels (12 each); 3 test XRP principal came back, 1 test XRP paid to the seller | 507 drops = 0.000507 test XRP |
| 2026-11-09 | tUSD token escrow trial on testnet: 4 throwaway faucet wallets, 12 transactions including 3 escrow finishes | Free faucet; under 0.002 test XRP in fees |
| 2026-11-09 | TESTUSD rerun of the token escrow trial: same 12 transactions, 4 new throwaway wallets | Free faucet; under 0.002 test XRP in fees |
| 2026-11-09 | Jev repeat test: the same input 5 times | $0.000170 |

## Coding-agent spend

Claude Code; not metered per task here.

## Ideas for later (not in the build yet)

| Raised | Idea | Note |
|---|---|---|
| 2026-11-08 | Operator picks a display currency; live XRP to ZAR or USD beside drops and invoice amounts | Test XRP has no value, so any rand figure must be labelled simulated. XRPL's PriceOracle amendment is live on testnet, which could make an on-ledger rate source a nice XRPL touch |
| 2026-11-08 | Hire new specialist agents on request through an agent workforce (Paperclip CEO agent) | After the three core outcomes. Decide what the hired agents run on (not the AWM plan) |
| 2026-11-08 | Two UI modes: a simple user mode and an operator mode, one large 3D glass pane per section with depth or swipe transitions | Now three views: the business view, the supplier page and the Control room. The look leans to the Spatial Desk draft, which isn't locked yet |
