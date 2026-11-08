# Surety: Step 1 plan review

2026-11-08. Built from the four reports in `docs/research/` (01 XRPL escrow, 02 ecosystem, 03 Jev and Haiku, 04 event and Paperclip). Facts are verified against official sources or live testnet RPC today unless marked **opinion**. No code written yet.

## 0. What changed since the spec

Event facts, verified on the organiser's BuilderBase page:

- Virtual build 2 to 11 Nov. In-person build 12 to 13 Nov at Park View, Woodstock. Final submission **Fri 13 Nov 23:59 SAST**. Finals 14 Nov.
- **Checkpoint Mon 9 Nov 17:00 SAST**, mandatory, feedback only. Needs: concept (problem, African users, 3 to 5 features), a repo with meaningful commits or an architecture diagram, and a team update.
- Submission: public GitHub repo with README, plus a demo video of at most 3 minutes. Pitch is 5 minutes plus 3 minutes Q&A.
- Rubric out of 90: Product, Technical, Business, 30 each. A local-only demo caps Technical at 9 to 14. A testnet deployment reaches the top band.
- Target track **Agentic Finance (Ripple)**: $2,500 plus a UDAX accelerator fast track. The MVP must have:
  1. at least one testnet transaction executed autonomously by an agent
  2. limits enforced somewhere the agent does not control
  3. a way for a human operator to set those limits outside the agent

  Ripple judges "meaningful use of the XRP Ledger and RLUSD". A real customer pain point and go-to-market are also required.
- Pre-existing code is allowed if disclosed. Projects built mostly on it historically scored lower.

## 1. Smallest plan that proves the three outcomes

Time available: Sunday evening, Mon 9 to Wed 11 (virtual), Thu 12 to Fri 13 (venue).

| Phase | When | Delivers | Evidence |
|---|---|---|---|
| 0. Repo and skeleton | Sun evening | Public repo `Marko-AI-Dev/surety`, pnpm workspace in the spec's layout, `.env.example`, `PRIOR_WORK.md` disclosure, GitHub noreply commit email | First commits |
| 1. Signer and escrow spike | Sun evening to Mon noon | `services/signer`: separate process on localhost, HMAC-authenticated, three operations only (create escrow for a job, finish with a one-use authorization, cancel an expired job). `packages/xrpl-settlement`: hand-rolled PREIMAGE-SHA-256, ripple-time helpers, autofilled fees, validated results only. Script funds three testnet wallets and runs create then finish, and create then expiry then cancel | Testnet tx hashes, escrow present then gone in `account_objects`, unit tests for condition encoding and time conversion |
| 2. Durable state and expiry worker | Mon afternoon to Tue morning | Local Supabase, core migrations, guarded state machine, worker that scans due jobs on boot | Test that restarts the worker before expiry and still sees a validated refund |
| 3. Checks and Jev | Tue | Deterministic validator with pass and fail fixtures. `JevDecisionEngine` (yes/no questions) and `FixtureDecisionEngine`. Labelled set of about 20 examples. Evaluator offline means no release | Tests for pass, fail and evaluator offline |
| 4. Agents and operator limits | Tue afternoon to Wed | Buyer agent (Haiku) proposes and funds a job through the API. Seller agent (Haiku, strict JSON schema). Operator limits (per-job cap, daily cap, wallet allowlist) set through an operator-only endpoint and read by the signer | Agent-initiated EscrowCreate hash, and a refused over-cap attempt in the log |
| 5. Minimal UI | Wed | Dashboard, job receipt, operator limits page, selective port of the reference UI | Jev UI journeys driving all three outcomes, with screenshots |
| 6. Freeze and demo | Thu 12 to Fri 13 | Rehearsal, video of at most 3 minutes, README, deployment decision, submission | Submitted entry |

**Checkpoint target (Mon 17:00):** Phase 0 and Phase 1 commits with real testnet hashes, an architecture diagram, and the concept text.

**Data model, cut from 10 tables to 7 (opinion):** `jobs` (source, criteria, snapshot hash, deliverable payload and hash), `escrows`, `transactions`, `decisions`, `authorizations`, `job_events`, `policy_limits`. Deferred: `reconciliation_findings`; a separate `cap_reservations` table (one atomic SQL check at funding enforces caps); a separate `deliverables` table (one deliverable per job for the MVP); `participants` (the allowlist lives in `policy_limits`).

**Red-team (opinion):** a hand-written adversarial fixture set of 10 to 15 cases in `tests/redteam`. garak and promptfoo become stretch.

## 2. Spec corrections

| Area | Spec says | Current | Source |
|---|---|---|---|
| Jev version | jev-1.13.0 or jev-latest | Pin `typesafe/jev-1.14` (snapshot `typesafe/jev-1.14-20261014`). Alias is `~typesafe/jev-latest` (tilde). Direct id `jev-1.14.0` | 03 |
| Jev route | `/api/alpha/decisions` or `/api/v1/systemone` | Both valid. Decisions is still labelled alpha. Systemone is its SDK-compatible twin | 03 |
| Jev SDK | `@typesafe-ai/sdk` | 0.7.0, needs Node 22 or newer | 03 |
| Jev limits | 100K tokens/s, 80 requests/s | No official source, delete. OpenRouter context 262,144 tokens; text over about 32 KB runs in slower long-context mode | 03 |
| Jev scores | satisfaction 0 to 1 | The score type returns a level index (0 to levels minus 1). Use yes/no (Noul) questions, which return P(yes) | 03 |
| Jev thresholds | approve if injection risk at most 0.02 | Vendor test scored benign messages up to 0.20, so this would escalate nearly every clean job. Vendor gate pattern: approve only if every check is at least 0.9, block if any is at most 0.1, escalate between | 03 |
| Jev errors | timeout, 429, 401, 5xx, malformed | Also handle a `refusal` answer, 402 (out of credit) and a missing answer. All map to ESCALATE or UNAVAILABLE, never approve | 03 |
| Seller model | not specified | `anthropic/claude-haiku-5.5` (snapshot `-20261007`), $0.10 in and $0.50 out per million tokens. `response_format` strict JSON schema plus `provider.require_parameters: true`, otherwise the schema can be silently ignored. `reasoning.effort: "low"` | 03 |
| xrpl.js | unpinned | 5.3.0, CommonJS, Node 20.19 or newer | 01 |
| Ripple time | use SDK conversion | `unixTimeToRippleTime` takes milliseconds and returns seconds | 01 |
| Crypto-conditions | compatible library | `five-bells-condition` was last published in 2017. Hand-roll: condition `A0258020 ‖ SHA256(P) ‖ 810120`, fulfillment `A0228020 ‖ P`, checked against rippled test vectors | 01 |
| Finish fee | 330-drop base plus increments | `reference fee × (33 + floor(fulfillment bytes / 16))`: 350 drops minimum for a 32-byte preimage. Autofill computes 353 | 01 |
| Reserves | verify at startup | Base reserve 1 XRP. Owner reserve 0.2 XRP per open escrow. Same on testnet and mainnet | 01 |
| Escrow rules | (as spec) | Confirmed. CancelAfter is mandatory for a condition-only escrow. Finish is refused once CancelAfter has passed (`tecNO_PERMISSION`). Anyone can finish unless the destination has DepositAuth | 01 |
| Escrow identity | Owner + create Sequence | OfferSequence is the create Sequence, or the TicketSequence if created with a Ticket | 01 |
| RLUSD | locking off on 10 Oct | Still off at validated ledger 22165841. No RLUSD escrow on testnet | 01 |
| Event and track | reported, unconfirmed | Verified, see section 0 | 04 |
| Demo | 4-minute script | Pitch 5 min plus 3 min Q&A. Video at most 3 min | 04 |
| Paperclip | link only | MIT. Latest is 2026.1106.0 with breaking changes; stay on local 916.1. Integration is four calls: create issue, poll, read document, PATCH | 04 |
| Ecosystem | not covered | Privy supports XRPL since 13 Oct, but its policy engine cannot read escrow fields. t54's Agentic Risk Standard is the nearest existing concept | 02 |

## 3. Three riskiest assumptions

1. **Jev separates clean from poisoned deliverables with thresholds that still let clean jobs pay.** If not, "pay on pass" escalates every time.
   Test (Mon, under $0.01): 20 labelled examples (10 clean, 10 with injections in the free-text field) through `typesafe/jev-1.14`. Look at the score spread, pick thresholds on 14 examples, check them on the 6 held out.
2. **A policy-enforcing signer counts as "executed autonomously by an agent", and XRP-only escrow counts as meaningful XRPL and RLUSD use.** If not, the track fit weakens.
   Test (Mon, free): ask a Ripple mentor on Telegram or at the checkpoint with a two-line description. Supporting evidence: Ripple's own `agentic-mpp-demo` uses policy-bound signing for its buyer agent.
3. **One capped OpenRouter key serves both Jev and Haiku, and the strict schema is really enforced on Haiku.** If not, we need a second key or provider, or the seller returns free-form JSON.
   Test (Sun evening, about $0.001): one Jev call and one Haiku call with `require_parameters: true` and a deliberately tight schema.

Escrow mechanics are well verified by research and exercised end to end in Phase 1, so they are not on this list.

## 4. Where I would challenge the design

1. **Jev has nothing to catch on a fully deterministic job.** (Opinion, based on spec section 3: unknown keys are rejected and values must match the source.) Fix: add one bounded free-text field, `summary`, at most 280 characters, that code cannot verify. Jev asks two yes/no questions about it: is it an accurate summary, and does it contain instructions aimed at the evaluator or payer. The live audience injection goes there.
2. **As written, the thresholds block the happy path.** (Verified vendor data.) Use the vendor gate pattern as policy v1, tune it on the labelled set, and version every change.
3. **The track needs operator-set limits; the spec rules out a settings portal.** (Verified track rule.) Add a minimal operator limits page (per-job cap, daily cap, wallet allowlist) behind an operator secret. The signer reads limits from the trusted store. Agents have no write path.
4. **The buyer must be a real agent.** (Verified track rule; implementation is opinion.) A Haiku buyer agent reads a need and a budget, proposes the job and calls `POST /jobs` and `/fund`. The signer enforces limits. A request over the cap is refused and logged, which is a good demo moment.
5. **RLUSD cannot be escrowed on testnet.** (Verified.) Keep XRP for the MVP. Stretch: make the asset a parameter and demonstrate token escrow with our own clearly labelled stand-in token, framed as "RLUSD-ready the day the issuer enables locking". Ask Ripple mentors whether that is planned.
6. **Ten tables plus garak and promptfoo do not fit.** (Opinion.) Cut to seven tables and a hand-written red-team set, as in section 1.
7. **"Testnet deployment" may mean a hosted app.** (Rubric wording verified; meaning unclear.) Ask at the checkpoint. If it does, host web, API, worker and signer plus a free hosted Supabase project, which needs your deployment approval.
8. **Positioning against t54.** (Verified: t54's Agentic Risk Standard describes escrowed fees released by an independent evaluator, on EVM with USDC.) Pitch: native XRPL escrow with no smart contract, refunds when anything fails, and the XRPL version of x402's missing hold-and-capture scheme.

## 5. Design review: at most three improvements

1. **Free-text `summary` field judged by Jev.** Fits in scope. See 4.1.
2. **Receipt page with one-click ledger proof.** Every hash links to the testnet explorer, with a live countdown to CancelAfter and the full decision trail (rule results, Jev scores, authorization binding). Fits in scope.
3. **RLUSD-ready token escrow with a labelled stand-in token.** Stretch.

A Paperclip-hosted seller agent stays stretch.

## 6. Decisions needed

1. Approve or edit this plan, so Phases 0 and 1 can start tonight.
2. Operator limits page (4.3) and a real buyer agent (4.4).
3. The three design-review items.
4. Create the public repo `Marko-AI-Dev/surety`, with the GitHub noreply address as the commit email.
5. A fresh OpenRouter key with a $5 limit, placed in `.env` by you.
