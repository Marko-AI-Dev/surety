# Negotiation with Leverage, Buyer Priority and the Inspector's Second Key (Phase 4d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sourcing deal is paid only when two independent parties agree: the supplier's documents pass Surety Verify, and a person acting as the inspector attests the bill of lading number they read off the shipment. Before that, the buyer's team really negotiates: the negotiator plays anonymised competing offers against each other over several rounds, suppliers answer with code-set prices and delivery trade-offs, committed quotes carry delivery days, and the lead chooses by the buyer's stated priority (price, speed or balanced), with Surety noting any off-priority choice.

**Architecture:**
- **The second key is a new API role, `inspector`, held by a person, never by an agent.** It lists funded sourcing deals and posts one attestation per deal: `{ blNumber, outcome: "attested" | "refused", note }`. Attestations live in a new append-only table.
- **Surety Verify gains the rule `attested`** for deals whose job froze `inspection: "required"` (every sourcing deal from 4d on). It passes only when the deal's attestation is `attested` and its B/L number matches the one in the delivered documents. 4b deals without the flag produce exactly the 12 rules they always did.
- **The worker waits, then fails closed.** A delivered deal that needs inspection and has none stays `DELIVERED`, with no decision and no model call, until the attestation arrives. At the decision cutoff (ledger time) it is held with `inspection_missing` and refunds at the deadline. A refused or mismatched attestation is a rule failure: declined, never paid, refunded at the deadline.
- **The inspector never sees the supplier's B/L number.** Its list shows the order (PO, goods, quantity, port, supplier name), so its attestation is a second, independent reading.
- **Delivery days ride beside the quote, not inside it.** `QuoteForm` gains `deliveryDays`; Surety stores it on the invite. The 4b `SupplierQuote`, its hash and the deal's job are unchanged.
- **Priority is in the brief.** `rankQuotes` orders committed quotes for `price`, `speed` or `balanced` in exact integer arithmetic. The lead sees the ranking (it uses the maximum, so the negotiator never does). An accept that isn't first in the ranking is allowed and recorded as a deal note `off_priority` with the lead's reason.
- **Leverage is real but bounded.** The negotiator's view lists each in-supplier's latest offer (delivered reports and committed quotes only), with no field derived from the maximum. Surety refuses a negotiator message that names another invited supplier, so leverage stays anonymous. Supplier agents parse a competing price or a faster-delivery request and answer by code: beat by $1 above the floor, else hold or trade price for delivery days.

**Tech Stack:** unchanged from 4c. TypeScript, Node 24, pnpm workspace, vitest 5.1.0, zod 4.6.7, postgres 4.1.0, xrpl 5.3.0, local Supabase, Jev (`typesafe/jev-1.14`) via OpenRouter, Paperclip v2026.916.1 (WSL, sandboxed), `openai/gpt-4o-mini` for supplier wording.

**Spec:** Marko's decisions of 9 Nov 2026, late evening: the inspector as a second key ("genius"), the buyer's priority (price, speed or balanced) replacing "the dearer quote" question, negotiation with competitor leverage as the core value, the "ask me" mode dropped unless time is left. `docs/product-brief.md` sections "The deal loop", "Agent team on Paperclip", "Surety Verify" and "Failure mode table"; the UI's expected shapes in PR #5 (`apps/web/src/data/types.ts`, `Inspection`; `apps/web/src/data/timeline.ts`, step `inspected`).

## Global Constraints

- **Network:** XRPL Testnet only. No mainnet, no real funds.
- **Keys:** no key or seed outside `services/signer`; `pnpm check:boundaries` stays green. Never read or print `.env`, `.env.*` or `services/signer/data/`. API tokens (the new `API_TOKEN_INSPECTOR` included) are generated into `.env.api`, never printed, logged or committed.
- **Migrations:** new files only. Never edit `20261109*` to `20261112*`.
- **Money:** integer cents, never floats. Ranking scores are integer cross-products, never divisions.
- **The negotiator never receives `maxUnitCents`:** not in its views, its inbox, any API response for its token, or its instructions. The ranking (which uses the maximum) is lead-only. No negotiator-visible field is derived from the maximum.
- **Chat never moves money.** Only a committed quote, the lead's decision, Surety's checks and, for release, Surety Verify with the inspector's attestation.
- **The inspector is a person.** `API_TOKEN_INSPECTOR` is never given to a Paperclip agent (`scripts/paperclip-team.ts`) or to the supplier agents. The inspector's note is display text only: it is never sent to Jev, the reader or any agent.
- **Test-first on every money-path change:** `trade-rules.ts`, `evaluate.ts`, `deals.ts`, `engine-loop.ts`, the attestation store and the inspector routes. Write the test, watch it fail, then implement.
- **Clocks:** the negotiation time box uses the server clock. Every money deadline (decision cutoff, refund) stays on validated ledger time.
- **Paperclip:** only the "Karoo Solar Imports (demo)" company, on Marko's ChatGPT subscription, agents sandboxed (`filesystemScope: "workspace"`, see `docs/research/07-paperclip-test.md`). Never the AWM plan; never read or reuse other companies.
- **Stack:** no new frameworks or runtime dependencies.
- **Spend:** Jev about $0.00005 per call (single cheap runs pre-approved). Supplier wording capped at 60 OpenRouter calls per process. Each live run in Task 8 is estimated under $0.05; that needs no extra go. Ask Marko before anything estimated above $1. Every paid run gets a spend row in `docs/log.md`.

## Review Focus

1. **A sourcing deal is paid without a matching attestation.** No attestation, a refused one, a different B/L number, an attestation arriving after the cutoff, or a job whose criteria lost `inspection: "required"`: each ends refunded at the ledger deadline, with no `EscrowFinish` ever requested, and the engine is never asked when the rule fails. Pinned in Task 2.
2. **The second key is not independent.** A lead, sourcing, negotiator, view or supplier token can attest; the inspector token can act on any other route; or `paperclip-team.ts` or the supplier agents read `API_TOKEN_INSPECTOR`. Pinned in Task 3.
3. **The inspector just copies the supplier's number.** No inspector response (queue or attestation) contains the B/L number from the supplier's submitted documents. Pinned in Task 3.
4. **The negotiator learns the maximum or held text through the new leverage data.** `negotiatorView.offers` contains a field derived from the maximum, is filtered by it, includes an out supplier, or includes a withheld report. Pinned in Task 6.
5. **A committed quote's delivery days change after the commit.** The same quote with different days is a conflict, not a retry, in both repos; the days live on the invite and the deal's `SupplierQuote` hash is unchanged. Pinned in Task 4.

---

### Task 1: The inspection contract and store

**Files:**
- Create: `packages/contracts/src/inspection.ts`, `packages/contracts/test/inspection.test.ts`, `supabase/migrations/20261113000000_inspections.sql`, `packages/workflow/src/inspection-repo.ts`, `packages/workflow/test/inspection-repo-contract.ts`, `tests/db/inspection.db.test.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/workflow/src/memory-repo.ts`, `packages/workflow/src/pg-repo.ts` (both return `JobsRepo & DealsRepo & SourcingRepo & InspectionRepo`), `packages/workflow/src/index.ts`, `packages/workflow/test/memory-repo.test.ts`, `tests/db/db.ts` (reset `inspections`)

**Interfaces:**
- Produces from `inspection.ts` (contracts):
  - `AttestationFormSchema` / `AttestationForm`: `{ blNumber: string 1..120 (trimmed), outcome: "attested" | "refused", note: string ≤ 280 }`, strict.
  - `INSPECTION_STATES = ["pending", "attested", "refused"] as const`.
  - `Inspection`: `{ state: InspectionState; inspector?: string | null; blNumber?: string | null; note?: string | null; at?: string | null }`, exactly the UI's shape in PR #5.
- **Table `inspections`:** id uuid, deal_id uuid unique references deals, job_id uuid unique references jobs, inspector text (1..120), bl_number text (1..120), outcome check (`attested`, `refused`), note text (≤ 280, default `''`), created_at `clock_timestamp()`. Append-only trigger like `deal_events`; RLS on.
- Produces from `inspection-repo.ts`:
  - `Attestation`: the columns in camelCase, ISO `createdAt`. `NewAttestation`: `{ dealId, jobId, inspector, blNumber, outcome, note }`.
  - `AttestationConflict` (a different attestation for a job that has one) and `InspectionClosed` (the job is not `LOCKED`, `IN_PROGRESS` or `DELIVERED`).
  - `InspectionRepo`:
    - `addAttestation(a: NewAttestation): Promise<Attestation>`: inserts only while the job is `LOCKED`, `IN_PROGRESS` or `DELIVERED`, in one statement (pg: `insert ... select ... where exists (select 1 from jobs where id = $job and state in (...))`), otherwise `InspectionClosed`. The same `{ blNumber, outcome, note }` again returns the stored row; anything different throws `AttestationConflict`.
    - `getAttestation(jobId: string): Promise<Attestation | null>`.

- [ ] **Step 1: Write the failing tests:**
  - Contracts: `an attestation needs a B/L number, an outcome of attested or refused, and a note of at most 280 characters`; `unknown keys are refused`.
  - `describeInspectionRepo` (both repos): `an attestation is stored once and read back by job`; `the same attestation again returns the stored row`; `a different outcome or B/L number throws AttestationConflict`; `a job in PAID, REFUNDED, EVALUATING or REVIEW_REQUIRED throws InspectionClosed and stores nothing`.
  - DB only: `attestations cannot be updated or deleted`; `two different attestations inserted concurrently leave exactly one row`.
- [ ] **Step 2: Run them.** `pnpm exec vitest run packages/contracts packages/workflow` and `pnpm test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** the contract, the migration (`pnpm db:reset`), then both repos.
- [ ] **Step 4: Run** both commands. Expected: PASS, every earlier test unchanged.
- [ ] **Step 5: Commit** `feat(workflow): the inspector's attestations: contract, append-only store, one per deal`.

---

### Task 2: Surety Verify's `attested` rule and the worker's wait (money path, test-first)

**Files:**
- Create: `packages/workflow/test/inspection-verify.test.ts`
- Modify: `packages/gate/src/trade-rules.ts`, `packages/gate/src/index.ts`, `packages/gate/test/trade-rules.test.ts`, `packages/workflow/src/deals.ts`, `packages/workflow/src/evaluate.ts`, `packages/workflow/src/engine-loop.ts`, `packages/workflow/src/sourcing-deal.ts` (its `dealDeps` sets the flag), `packages/workflow/test/sourcing-deal.test.ts`

**Interfaces:**
- `trade-rules.ts`:
  - `INSPECTION_RULE_ID = "attested"`; `TradeRuleId` becomes `(typeof TRADE_RULE_IDS)[number] | "attested"`. `TRADE_RULE_IDS` stays the 12.
  - `TradeRulesInput.inspection?: { attestation: { outcome: "attested" | "refused"; blNumber: string } | null }`. Absent: no `attested` result at all (4b unchanged). Present: an `attested` result is appended last (`skipped` when earlier rules stopped the run).
  - `normalizeBlNumber(s: string): string` = NFKC, upper case, spaces and hyphens removed.
  - The rule fails with: `no inspector attestation`; `the inspector refused the bill of lading`; or `the inspector read B/L <a>, the documents say <b>`.
- `deals.ts`: `DealDeps.inspection?: "required"`. When set, `dealJob` freezes `criteria: { kind: "trade", intent, quote, inspection: "required" }` and `criteriaText: TRADE_CRITERIA_INSPECTED` (`TRADE_CRITERIA` plus "An independent inspector must attest the bill of lading number before release."). Unset: byte-identical to 4b.
- `evaluate.ts`:
  - `EvaluateDeps.repo: JobsRepo & Pick<InspectionRepo, "getAttestation">`.
  - `tradeTermsOf` returns `{ intent, quote, inspection: "required" | "none" }`; an `inspection` key with any other value is `"invalid"` (held `trade_terms_invalid`).
  - For a `"required"` job in `DELIVERED`, after reading ledger time and before claiming: no attestation and `closeTime < cutoff` returns the job unchanged (no event, no decision, no engine call). No attestation and `closeTime >= cutoff`: claim, then hold `REVIEW_REQUIRED` with `inspection_missing`.
  - With an attestation, `judgeTrade` passes `inspection: { attestation }` to both `runTradeRules` calls, and the rules record carries `inspection: { attestationId, outcome, blNumber }`.
- `engine-loop.ts`: `EngineReport.awaitingInspection: string[]` (jobs left `DELIVERED`); they are not logged as evaluated.
- `sourcing-deal.ts`: every sourcing deal runs `decideQuote` with `inspection: "required"`.

- [ ] **Step 1: Write the failing tests.** Gate, with the 4b honest fixture (B/L `SZXDUR-55120`):
  - `without inspection the results are exactly the 12 trade rules, as before`
  - `an attested SZXDUR-55120 passes attested, and "szxdur 55120" passes too`
  - `SZXDUR-55121 fails attested and the detail names both numbers`
  - `a refused attestation fails attested even with the right number`
  - `no attestation fails attested`
  - `unparseable documents mark attested skipped`

  Workflow (`inspection-verify.test.ts`, memory repo, fake signer, scripted engine counting calls, stub ledger clock):
  - `a delivered sourcing deal with no attestation stays DELIVERED across three engine passes, with no decision and 0 engine calls`
  - `with no attestation at the cutoff it is held REVIEW_REQUIRED with inspection_missing, and at the ledger deadline it is REFUNDED with no finish ever requested` (Review Focus 1)
  - `an attested matching B/L approves and pays $48,000.00`
  - `a mismatched B/L declines with rule:attested, 0 engine calls, never paid, refunded at the deadline` (Review Focus 1)
  - `a refused attestation declines with rule:attested and refunds` (Review Focus 1)
  - `an attestation stored after the cutoff still ends in a refund` (Review Focus 1)
  - `a job whose criteria say inspection "optional" is held trade_terms_invalid` (Review Focus 1)
  - `a 4b deal without the flag freezes { kind, intent, quote } exactly and is judged as before`

  `sourcing-deal.test.ts`: `every job a sourcing deal creates freezes inspection: "required"`; update `end to end in memory` to attest before `runEngineOnce`.
- [ ] **Step 2: Run them.** `pnpm exec vitest run packages/gate packages/workflow`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` and `pnpm test:db`. Expected: PASS, with `calibrate-trade` and every 4b test unchanged.
- [ ] **Step 5: Commit** `feat(verify): the second key: sourcing deals release only on the inspector's matching attestation`.

---

### Task 3: The inspector role, routes and token

**Files:**
- Create: `packages/workflow/src/inspection.ts`, `packages/workflow/test/inspection.test.ts`, `services/api/scripts/inspector-attest.ts`
- Modify: `packages/workflow/src/sourcing.ts` (`SourcingDeps.repo` gains `InspectionRepo`), `packages/workflow/src/index.ts`, `services/api/src/config.ts`, `services/api/src/http.ts`, `services/api/scripts/make-tokens.ts`, `services/api/test/{config,http,make-tokens}.test.ts`, `services/worker/src/*` only if its repo type needs it, `docs/api.md`, root `package.json` (`"inspector:attest": "tsx --env-file=.env.api services/api/scripts/inspector-attest.ts"`), `tests/agent-instructions.test.ts`; `services/api/src/record.ts` if PR #1 is merged by then

**Interfaces:**
- `inspection.ts` (workflow):
  - `INSPECTABLE_JOB_STATES = ["LOCKED", "IN_PROGRESS", "DELIVERED"] as const`.
  - `InspectionNotFound` (the deal is missing, has no job, or did not come from a sourcing).
  - `inspectorQueue(deps: SourcingDeps): Promise<InspectorItem[]>`: sourcing deals whose job is inspectable and has no attestation. `InspectorItem = { dealId, poNumber, goods, quantity, incoterm, port, supplierName, jobState }`. No B/L number, no prices, no wallets.
  - `attest(deps: SourcingDeps, dealId: string, raw: unknown, inspector: string): Promise<Inspection>`.
  - `inspectionOf(deps: SourcingDeps, dealId: string): Promise<Inspection | null>`: `null` when the job doesn't require inspection; `{ state: "pending" }` when it does and none exists; otherwise the attestation as `{ state, inspector, blNumber, note, at }`.
- API:
  - `Role` gains `"inspector"`. `loadApiConfig` requires `API_TOKEN_INSPECTOR` (≥ 32 characters, distinct from every other token) and reads `API_INSPECTOR_NAME` (default `"Port inspector (demo)"`).
  - Routes:

    | Route | Roles | Calls |
    |---|---|---|
    | `GET /inspector/deals` | inspector | `inspectorQueue` |
    | `POST /inspector/deals/:id/attestation` `{blNumber, outcome, note}` | inspector | `attest` with the configured name |

  - Errors: `InspectionNotFound` 404 `not_found`; `AttestationConflict` 409 `conflict`; `InspectionClosed` 409 `closed`.
  - `GET /deals/:id` (lead, view) gains `inspection`. If `services/api/src/record.ts` exists (PR #1 merged), the record gains top-level `inspection` in the UI's shape.
- `make-tokens.ts`: `renderApiEnv` adds `API_TOKEN_INSPECTOR`. New `addMissingTokens(existing: string, token: () => string): { text: string; added: string[] }` and flag `--add-missing`: appends a fresh line for each missing role key, leaves every existing line byte-identical, prints only the added key names. No Paperclip secret needs rotating.
- `inspector-attest.ts <dealId> <blNumber> <attested|refused> [note]`: the CLI stand-in for the phone page. It reads `API_TOKEN_INSPECTOR` from the environment, posts, prints the resulting `Inspection`, and never prints the token.

- [ ] **Step 1: Write the failing tests:**
  - Workflow: `the queue lists a LOCKED sourcing deal with PO, goods, quantity, port and supplier name`; `after the supplier submits B/L SZXDUR-55120, the queue JSON contains neither "SZXDUR" nor "55120"` (Review Focus 3); `a 4b deal never appears and attest on it throws InspectionNotFound`; `inspectionOf goes from pending to attested with inspector, blNumber, note and at`.
  - API: `the inspector token lists and attests`; `the inspector token gets 403 on POST /sourcing, POST /deals/:id/decision, GET /operator/quarantine and POST /supplier/sourcing/:id/quote` (Review Focus 2); `lead, sourcing, negotiator, view and supplier tokens get 403 on both inspector routes` (Review Focus 2); `no inspector response contains the submitted B/L number` (Review Focus 3); `a second different attestation is 409 conflict, and one on a PAID deal is 409 closed`; `GET /deals/:id shows inspection pending, then attested`.
  - Config and tokens: `loadApiConfig refuses a missing, short or duplicated API_TOKEN_INSPECTOR without printing it`; `addMissingTokens appends only API_TOKEN_INSPECTOR and leaves every existing line byte-identical`; `addMissingTokens reports key names only`.
  - `tests/agent-instructions.test.ts`: `neither paperclip-team.ts, the supplier agents nor any instruction file mentions API_TOKEN_INSPECTOR or an /inspector route` (Review Focus 2).
- [ ] **Step 2: Run them.** `pnpm exec vitest run packages/workflow services/api tests/agent-instructions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Document both routes in `docs/api.md`, with the note that the inspector is a person and never sees the supplier's B/L number. Do not add them to `agents/paperclip/surety-api.md`.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck` and `pnpm check:boundaries`. Expected: all green.
- [ ] **Step 5: Ask Marko to run `pnpm api:tokens --add-missing`** (it writes the inspector token without touching the others; nothing is printed). **Commit** `feat(api): the inspector role: a queue without the supplier's B/L number and one attestation per deal`.

---

### Task 4: Delivery days on committed quotes

**Files:**
- Create: `supabase/migrations/20261113010000_quote_delivery_days.sql`
- Modify: `packages/contracts/src/sourcing.ts`, `packages/contracts/test/sourcing.test.ts`, `packages/workflow/src/sourcing-repo.ts`, `memory-sourcing-repo.ts`, `pg-sourcing-repo.ts`, `packages/workflow/test/sourcing-repo-contract.ts`, `packages/workflow/src/sourcing.ts`, `packages/workflow/test/sourcing.test.ts`, `services/api/src/http.ts`, `services/api/test/http.test.ts`, `services/supplier-agents/src/negotiate.ts` (commit sends the days), `tests/db/sourcing.db.test.ts`, `docs/api.md`, `agents/paperclip/surety-api.md`; `services/api/src/record.ts` if PR #1 is merged

**Interfaces:**
- `QuoteFormSchema` gains `deliveryDays: z.number().int().min(1).max(365)`, required.
- Migration: `alter table sourcing_suppliers add column delivery_days integer check (delivery_days between 1 and 365)` and the constraint `delivery_days is null or quote is not null` (4c rows keep a quote with null days).
- `Invite.deliveryDays: number | null`. `SourcingRepo.commitQuote(sourcingId, address, quote, quoteHash, deliveryDays: number)`: the same hash and the same days return the invite unchanged; anything else throws `QuoteConflict`.
- Workflow `commitQuote`: the retry check compares `deliveryDays` too; a difference throws `CommittedQuoteConflict`. The `SupplierQuote` it builds is unchanged (no days key).
- Exposed in: `LeadView.invites[].deliveryDays`; `GET /supplier/sourcing` items gain `committed: { unitCents, deliveryDays } | null` (own quote only); the record's invites if PR #1 is merged.

- [ ] **Step 1: Write the failing tests:**
  - Contracts: `a quote form without deliveryDays, or with 0 or 366, is refused`.
  - Repo contract (both repos): `commitQuote stores the delivery days`; `the same hash with different days throws QuoteConflict` (Review Focus 5).
  - Workflow: `a committed quote's days show in leadView`; `the same form again is a retry; the same price with 14 days instead of 21 throws CommittedQuoteConflict` (Review Focus 5); `the stored SupplierQuote has no deliveryDays key and its hash equals sha256 of its canonical JSON` (Review Focus 5).
  - DB: `a 4c invite with a quote and no delivery days reads back with deliveryDays null`.
  - API: `GET /supplier/sourcing shows a supplier its own committed price and days, never another's`.
- [ ] **Step 2: Run them.** `pnpm exec vitest run packages services/api` and `pnpm test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** (migration, `pnpm db:reset`, repos, workflow, API, the supplier agents' commit).
- [ ] **Step 4: Run** `pnpm test` and `pnpm test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sourcing): committed quotes carry delivery days, kept beside the deal's quote`.

---

### Task 5: Buyer priority and the ranking

**Files:**
- Create: `packages/workflow/src/sourcing-rank.ts`, `packages/workflow/test/sourcing-rank.test.ts`
- Modify: `packages/contracts/src/sourcing.ts`, `packages/contracts/test/sourcing.test.ts`, `packages/workflow/src/deal-repo.ts`, `memory-repo.ts`, `pg-repo.ts` (`addDealNote`), `packages/workflow/test/deal-repo-contract.ts` (or the file holding the deals contract tests), `packages/workflow/src/pg-sourcing-repo.ts` (parse the stored brief on read), `packages/workflow/src/sourcing.ts`, `packages/workflow/src/sourcing-deal.ts`, both workflow test files, `tests/db/sourcing.db.test.ts`, `docs/api.md`

**Interfaces:**
- Contracts: `PRIORITIES = ["price", "speed", "balanced"] as const`; `SourcingBriefSchema` gains `priority: z.enum(PRIORITIES).default("balanced")` and `latestDeliveryDays: z.number().int().min(1).max(365).optional()`. The pg repo parses the stored brief with the schema, so a 4c brief reads back as `balanced`.
- `sourcing-rank.ts`:
  - `RankedQuote = { supplier: string; unitCents: number; deliveryDays: number | null; eligible: boolean; why: string | null }`.
  - `rankQuotes(brief: SourcingBrief, offers: { supplier: string; status: "in" | "out"; unitCents: number; deliveryDays: number | null }[]): RankedQuote[]`.
  - Eligible: status `in`, `unitCents <= maxUnitCents`, days present, and days `<= latestDeliveryDays` when set. Ineligible quotes come last with `why`: `"out"`, `"above the maximum"`, `"no delivery days"` or `"slower than <n> days"`.
  - Order of eligible quotes: `price` by unitCents then days; `speed` by days then unitCents; `balanced` by `unitCents × minDays + days × minCents` (minimums over eligible quotes; the integer form of price/minPrice + days/minDays), then unitCents. Last tie-break: address.
- `LeadView` gains `ranking: RankedQuote[]`. `NegotiatorView` gains `priority` and `latestDeliveryDays`, never `ranking`.
- `DealsRepo.addDealNote(dealId: string, event: DealEventInput): Promise<DealEvent>`: appends an event whose `from` and `to` are the deal's current state.
- `leadDecision`: on `accept`, ranks the committed quotes; when the chosen supplier isn't the first eligible one, it adds a note before `decideQuote`: actor `surety`, reason code `off_priority`, detail `{ priority, best: { supplier, unitCents, deliveryDays }, chosen: {...}, reason }`. It never blocks. A decline adds no note.

- [ ] **Step 1: Write the failing tests:**
  - Contracts: `a brief without priority parses as balanced`; `priority must be price, speed or balanced`; `latestDeliveryDays must be 1 to 365`.
  - Rank: `price puts $109.00 in 21 days first`; `speed puts $118.00 in 14 days first`; `balanced prefers $118.00 in 14 days over $109.00 in 21 days, and $109.00 in 21 days over $118.00 in 20 days`; `an out supplier, a quote above $120.00, one without days and one slower than 30 days are ranked last with their reasons`; `an exact tie on the score breaks on price, then address`.
  - Deals repo contract (both repos): `addDealNote appends an event from and to the current state and changes nothing else`.
  - Workflow: `leadView carries the ranking`; `negotiatorView carries priority and latestDeliveryDays and no ranking`; `accepting the second-ranked quote for speed locks it and records off_priority with both quotes and the lead's reason`; `accepting the first-ranked quote records no note`; `a decline records no note`.
  - DB: `a brief stored before 4d reads back with priority balanced`.
- [ ] **Step 2: Run them.** `pnpm exec vitest run packages` and `pnpm test:db`. Expected: FAIL.
- [ ] **Step 3: Implement.** Document `priority`, `latestDeliveryDays` and `ranking` in `docs/api.md`.
- [ ] **Step 4: Run** `pnpm test` and `pnpm test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sourcing): the buyer's priority, Surety's ranking, and a note when the lead picks off-priority`.

---

### Task 6: Leverage on the buyer's side and the team's instructions

**Files:**
- Create: `packages/workflow/src/leverage.ts`, `packages/workflow/test/leverage.test.ts`
- Modify: `packages/workflow/src/sourcing.ts`, `packages/workflow/test/sourcing.test.ts`, `services/api/test/http.test.ts`, `agents/paperclip/negotiator.md`, `agents/paperclip/lead.md`, `agents/paperclip/surety-api.md`, `tests/agent-instructions.test.ts`, `docs/api.md`

**Interfaces:**
- `leverage.ts`:
  - `leverageOffers(messages: SourcingMessage[], invites: Invite[]): Offer[]`, where `Offer = { supplier: string; unitCents: number; deliveryDays: number | null; source: "committed" | "reported"; at: string }`. One per supplier that is `in`: its committed quote if any, otherwise its latest delivered report. Withheld reports, quarantined messages and out suppliers never count. No filtering or flag based on the maximum: an offer above it still appears.
  - `namesOtherSupplier(text: string, others: { address: string; name: string }[], allowed: string[]): string | null`: the matched address or name word. Name words are those of 6 or more letters, minus `limited`, `trading`, `energy`, `company`, `solar` and any word in `allowed` (the brief's goods and port). Case-insensitive, on the NFKC text.
- `NegotiatorView` gains `offers: Offer[]`.
- `postNegotiatorMessage` refuses, with `SourcingRefused("a message must not name another supplier")` and storing nothing, any text where `namesOtherSupplier` matches a different invited supplier. The recipient's own name is allowed.
- **Instructions** (prose; pinned by the test):
  - `negotiator.md`: read `priority`, `latestDeliveryDays` and `offers` from `GET /sourcing/<id>`. Over several rounds, tell each supplier the best competing offer for the buyer's priority as "another approved supplier offered $X per panel with N days delivery". Only cite offers from `offers`. Never name or hint at the other supplier. Never invent an offer. Never quote, repeat or ask about a withheld message. For `speed`, lead with delivery days. Stop pushing a supplier after it holds twice. Final call at 30 seconds or less, as before.
  - `lead.md`: put the operator's priority and latest delivery days in the brief. Give the negotiator the target and the priority. Choose `ranking[0]` among eligible quotes unless there is a reason; if you choose another, say why in the decision reason, because Surety records it.
  - `surety-api.md`: the brief body gains `priority` and `latestDeliveryDays`; the quote form shown to suppliers gains `deliveryDays`. No inspector routes.

- [ ] **Step 1: Write the failing tests:**
  - Leverage: `offers list each in supplier's committed quote, or else its latest delivered report`; `a withheld report, a quarantined message and an out supplier never appear` (Review Focus 4); `an offer above the maximum still appears and no offer has an eligible, withinBudget or max field` (Review Focus 4); `namesOtherSupplier finds "Sunpeak", "sunpeak" and Sunpeak's address in a message to Brightway, and not "Durban" or "solar"`.
  - Workflow: `negotiatorView JSON contains neither maxUnitCents nor 12000 with offers present` (Review Focus 4, with no fixture offer at exactly 12000); `a message to Brightway naming Sunpeak is refused and stored nowhere`; `"another approved supplier offered $114.00 with 14 days" is delivered`.
  - API: `every response to the negotiator token lacks maxUnitCents and its value`, re-run with offers and priority present.
  - `tests/agent-instructions.test.ts`: `the negotiator is told to use anonymised competing offers from offers` (`/another approved supplier/i`, `/`offers`/`, `/never name/i`); `the negotiator is told never to quote a held message` (`/never (quote|repeat)[^.]*withheld/i`); `the lead is told to follow the ranking or give its reason` (`/ranking/`, `/reason/`); the existing maximum pins still pass.
- [ ] **Step 2: Run them.** `pnpm exec vitest run packages/workflow services/api tests/agent-instructions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the code and the three instruction files, then re-apply them to the agents with `pnpm exec tsx scripts/paperclip-team.ts` (instructions only; tokens unchanged, sandbox settings kept).
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): the negotiator plays anonymised competing offers; the lead follows the buyer's priority`.

---

### Task 7: Supplier agents that negotiate over several rounds

**Files:**
- Modify: `services/supplier-agents/src/personas.ts`, `negotiate.ts`, `wording.ts`, `main.ts`, `services/supplier-agents/test/negotiate.test.ts`, `services/supplier-agents/test/wording.test.ts`

**Interfaces:**
- `Persona` gains `stepCents`, `slow?: { days: number; discountCents: number }` and `rush?: { days: number; premiumCents: number }`. `deliveryDays` stays the standard option.
  - Brightway: open 11800 / 21 days, floor 10900, step 100, slow 35 days at 300 off (never below 10600), rush 16 days at +400.
  - Sunpeak: open 12600 / 14 days, floor **11600** (was 12100, so it can win on speed), step 100, slow 21 days at 400 off (never below 11200), rush 10 days at +500.
  - Coastline: unchanged (script, 18 days).
- `readLeverage(text: string): { competitorCents?: number; competitorDays?: number; askCents?: number; askDays?: number; wantsFaster: boolean; final: boolean }`. Amounts: `$114`, `$114.00`, `USD 114`, `114.00 USD`. A sentence with `another`, `other supplier`, `competing`, `competitor` or `offered` gives competitor values; otherwise ask values. `wantsFaster`: `faster`, `sooner`, `quicker`, `earlier`, or asked or competitor days below the current days.
- `AgentState` becomes `{ priceCents, deliveryDays, counters, traded, scriptIndex, committed }`. `MAX_COUNTERS = 2`.
- `nextMove` keeps its signature. `SayMove.intent` adds `"beat"` and `"trade"`. Order of answers to a negotiator message:
  1. `final`: commit at the current price and days.
  2. A competing price below the current one: if `c − step ≥ floor`, offer `c − step` (`beat`); if `floor ≤ c < floor + step`, offer the floor; if `c < floor`, offer the slow option once (`trade`), then hold at the floor.
  3. `wantsFaster` with a rush option not yet offered: offer it once (`trade`).
  4. An ask below the current price, or any other follow-up: counter halfway toward `max(ask, floor)` in whole dollars, at most twice, then hold.
- The crook rule stays: it commits only after its whole script. Every committed `QuoteForm` carries the last offer's `deliveryDays`.
- Wording: templates for `beat` ("We can beat that: $113.00 per panel, delivery in 21 days.") and `trade` ("If 35 days' delivery works for you, we can do $106.00 per panel."). Model text is used only if it has exactly one dollar amount, equal to the code's price, and every `N days` / `N-day` number equals the code's days; `open` and `trade` must state the days. The prompt tells the model never to repeat the buyer's or a competitor's price.
- `main.ts` logs `shipped on B/L <number>` when it submits the settlement (the stand-in for the paper the inspector reads at the port).

- [ ] **Step 1: Write the failing tests:**
  - `readLeverage reads $114, $114.00, USD 114 and 114.00 USD`; `it tells "another approved supplier offered $114.00" from "can you do $110?"`.
  - `Brightway beats a competing $114.00 with $113.00 at 21 days`
  - `told of $105.00, Brightway offers $106.00 at 35 days once, then holds at $109.00`
  - `asked for faster delivery, Sunpeak offers 10 days at its price plus $5.00, once`
  - `without leverage a supplier counters halfway twice in whole dollars, then holds`
  - `no sequence of 200 seeded random negotiator messages takes a supplier below its floor at standard or rush days, or below floor minus the slow discount`
  - `"final" commits at the current price and days, and the form carries those days`
  - `Coastline still commits only after its script`
  - Wording: `a model text saying 14 days when the code says 21 falls back to the template`; `a model text that repeats the competitor's $114.00 falls back to the template`; `a trade text with no days number falls back to the template`.
- [ ] **Step 2: Run them.** `pnpm exec vitest run services/supplier-agents`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(suppliers): several rounds: beat a competing price, trade price for delivery, never below the floor`.

---

### Task 8: Live testnet runs: a negotiated, inspected payment and an inspector's refusal

**Files:**
- Modify: `scripts/sourcing-checks.ts`, `scripts/sourcing-evidence.ts`, `tests/sourcing-evidence.test.ts`, `docs/log.md`

**Interfaces:**
- `sourcingChecks(e: SourcingEvidence, expect: "paid" | "refunded")`. `SourcingEvidence` gains `brief` (priority and limits), `invites[].deliveryDays`, `reports` (supplier, unitCents, deliveryDays, at), `negotiatorMessages` (supplier, text), `notes` (deal notes), `attestation` (outcome, blNumber, at) and `deliveredBl` (from the stored documents), `paidAt`, and `decisionReasonCodes`.
- Checks kept: `crookOut`, `quarantinedNeverInInbox`, `maxNeverShownToNegotiator`, `strangerSuggestedNotInvited`, `everyLeadDecisionHasReason`.
- `winnerIsCheapestValidCommitted` becomes `winnerBestForPriorityOrNoted`: the winner is first in `rankQuotes`, or an `off_priority` note with a non-empty reason exists.
- New: `negotiationMovedPrice` (the winner's committed price is below its first reported price); `leverageCitedAnonymously` (a negotiator message states another supplier's reported price, and none names another supplier); `committedQuotesCarryDeliveryDays`.
- `expect: "paid"`: `paidFinishValidated`, `treasuryDownByExactlyTotal`, and `inspectionAttestedBeforePaid` (outcome attested, normalised B/L equal to `deliveredBl`, attestation before `paidAt`).
- `expect: "refunded"`: `refusedAttestationRefunded` (reason codes include `rule:attested`, job `REFUNDED`, cancel `tesSUCCESS`, no finish) and `treasuryBackToBefore`.

- [ ] **Step 1: Update `tests/sourcing-evidence.test.ts`** (all true for a good run in each mode; each new check false for its broken case). Run it and expect FAIL, then implement and expect PASS.
- [ ] **Step 2: Run A, the paid path** (estimated under $0.05). Start `pnpm db:start`, the signer, the worker (`JEV_MODE=live`), the API and the supplier agents; clear Coastline with `pnpm supplier:clear`. Give the Lead: "400 Monocrystalline solar panel 550 W, target $110, max $120, priority balanced, latest delivery 30 days, CIF Durban, deadline 420 s, negotiation 120 s". When the supplier agents log `shipped on B/L <n>`, attest with `pnpm inspector:attest <dealId> <n> attested "400 cartons counted, seal intact"`. Then `pnpm evidence:sourcing <sourcingId> --before <cents> --expect paid`. Expected: all checks true, exit 0.
- [ ] **Step 3: Run B, the refusal.** Same setup, negotiation 90 s, deadline 240 s. Attest with `refused "Seal broken, 380 cartons counted"`. Wait past the deadline, then run the evidence with `--expect refunded`. Expected: all checks true, exit 0.
- [ ] **Step 4: Stop every service** and confirm ports 4100 and 4200 are free (check for orphaned node processes by command line, as before). Add spend rows to `docs/log.md` (Jev, OpenRouter wording; the ChatGPT subscription costs nothing extra).
- [ ] **Step 5: Commit** `feat: testnet evidence: a negotiated, inspector-attested payment and a refusal that refunds`.

---

### Task 9: Docs

**Files:**
- Modify: `README.md`, `docs/architecture.md`, `docs/product-brief.md`, `docs/log.md`, `docs/api.md` (final check)

- [ ] **Step 1: README:** a section "Phase 4d: negotiation with leverage, the buyer's priority and the inspector's second key", with both evidence tables, the run commands (`inspector:attest`, `api:tokens --add-missing`) and the new test count.
- [ ] **Step 2: Architecture:** the inspector role as an independent second key (never an agent, never shown the supplier's B/L number), the `attested` rule, the wait-then-refund path on ledger time, and how leverage stays anonymous and free of the maximum.
- [ ] **Step 3: Product brief:**
  - The "Who" table gains "Inspector (a person)".
  - The failure table gains "Supplier confirms its own shipping documents | Held until an independent inspector attests the B/L number; refused, mismatched or missing refunds | Proven (Run B evidence link)".
  - The paragraph on the strongest future upgrade says the demo now has a person's second key, with carrier-signed electronic B/Ls still the upgrade.
- [ ] **Step 4: Log:** Marko's decisions of 9 Nov late evening, plus these plan decisions: one attestation per deal (no corrections); the inspector never sees the submitted B/L number; delivery days are recorded beside the quote and not checked by Verify; Sunpeak's floor moved to $116.00; the phone page for the inspector belongs to the web app.
- [ ] **Step 5: Run** `pnpm test && pnpm test:db && pnpm typecheck && pnpm check:boundaries`. Expected: all green. **Commit** `docs: Phase 4d: negotiation, the buyer's priority and the inspector's second key`.

---

## Hand-off to the web app (PR #5)

Not part of this plan's tasks; tell Fable once Tasks 3 to 5 are merged:
- The supplier seat's quote form must send `deliveryDays`; the brief form gains `priority` and `latestDeliveryDays`; the lead view can show `ranking` and any `off_priority` note.
- The inspector phone page: `GET /inspector/deals` and `POST /inspector/deals/:id/attestation` with the inspector token (kept out of the URL sent to the server, for example in the fragment). It shows the order, never a B/L number, and asks for the number read off the shipment.
- `record.inspection` is now live in the exact `Inspection` shape the UI already reads.
