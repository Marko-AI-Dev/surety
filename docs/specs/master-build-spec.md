# Agent escrow: master build spec

Version 1.0 | 10 October 2026 | Prototype specification, not production approval

## 1. What we're building and why

The trust layer for the agent economy. Buyer agents hire seller agents to do work. Payment locks in XRPL escrow and settles only after the agreed deliverable passes an off-chain gate. The ledger enforces cryptographic/time conditions; it does not understand work or run Jev. Prove successful payment and safe failure, not perfect AI judgment.

W3NODE runs Thursday 12 to Saturday 14 November 2026 at Parkview Event Space, Woodstock, Cape Town. Official application: https://w3node.io/node-engine . Official materials confirm dates, venue and application route; prior research found free entry and solo/team applications. Agentic Finance, Tether/Ripple sponsorship and UDAX accelerator terms are reported from the DevFest announcement, not confirmed published track/prize rules. Organizer code policy, hacking window, team-size cap, deadline and judging rubric remain unconfirmed. Marko plans to ask hello@w3africa.io. Build throwaway learning spikes now; do not assume rebuilding or code reuse is allowed. Preserve commit history and separate pre-event experiments from event work.

This replaces the earlier concept note. Implementation defaults below are proposed choices, not already-built features or vendor promises. Verify SDK behavior and report conflicts rather than quietly weakening the gate.

## 2. Scope: build the small thing that works

MUST build: one buyer agent, one seller agent, one narrow task, one test-XRP escrow per job, rules, a Jev adapter, separate signer boundary, Supabase records, expiry cancellation worker, read-only dashboard and three end-to-end outcomes: accepted, rejected, evaluator unavailable.

Single chain: XRPL Testnet. No mainnet, real money, bridges, live KYC, fiat ramps, commission or onboarding portal. Participant verification is labelled DEMO ALLOWLIST, NOT KYC. Test tokens have no real monetary value.

Suggested defaults: TypeScript; React UI; Node backend; official xrpl JavaScript client; Supabase Postgres; TypeSafe SDK/documented HTTP. Validate package APIs and pin versions. Signer is a separate process/service, even on one demo laptop. A deterministic workflow runner is enough initially; Paperclip integration is stretch work.

Don't over-engineer it. Cut quorum, FX feeds, company onboarding, scale benchmarks and fancy UI before cutting cancellation, validated settlement or secret isolation. Three reliable outcomes beat ten half-built features.

## 3. Concrete demo job

Extract an invoice summary from fixed synthetic text. No real customer data. Buyer freezes source text, schema and criteria before funding. Seller returns JSON: invoice_id, vendor, currency, total_minor and line_items. Fixture: invoice DEMO-001; vendor Demo Supplies; ZAR; two cables at 15000 cents each and one adapter at 10000 cents; total 40000 cents. No taxes or discounts. Offer 1 XRP, or 1000000 drops, of test funds.

Acceptance: exact required fields and types, permitted currency, line-item arithmetic and supported source values. Reject unknown keys/malformed data for MVP. Keep expected assertions in tests, not the seller's answer prompt. Invoice uses integer cents; XRP uses integer drop strings, never floating-point money math.

Seller extracts data only. No signing capability, tool calls or commands from the invoice. Delimit evidence as data. Jev assesses whether the result satisfies criteria and contains suspicious instructions. Schema validity alone does not prove correctness. Jev cannot override failed deterministic acceptance. This narrow job is deliberately objectively checkable; less rigid future tasks need their own dataset and acceptance policy.

## 4. Workflow and refunds

1. Buyer creates draft with fixed seller wallet, amount, source, criteria and deadline. Backend checks caller/policy and freezes a canonical snapshot hash.
2. Signer generates a fresh cryptographically random 32-byte preimage. Derive serialized PREIMAGE-SHA-256 Condition/Fulfillment using a compatible crypto-conditions library; raw SHA-256 alone is not the XRPL serialized condition. Store encrypted secret only in signer storage.
3. Buyer test wallet signs EscrowCreate with Destination, Amount, Condition and CancelAfter. Omit FinishAfter for this conditional prototype. Reject deadlines already too close.
4. Wait for validated tesSUCCESS. Record actual create transaction Sequence; escrow identity is network + Owner + OfferSequence. Only then show locked and start work.
5. Seller submits immutable deliverable/hash. Rules and deterministic acceptance run, then Jev. Bind verdict to exact job version, escrow, deliverable hash and policy version.
6. If all checks pass, issue short-lived one-use internal authorization. Signer independently checks it and current ledger state, builds/signs EscrowFinish and submits it. Do not return fulfillment to agents/UI.
7. Show PAID only after validated finish tesSUCCESS. If database persistence fails after settlement, reconcile the mirror, never pay again.

Rejected work: keep fulfillment private. REJECTED_AWAITING_EXPIRY -> eligible EscrowCancel -> validated REFUNDED. The model cannot immediately refund conditional escrow before ledger cancellation is permitted. Principal returns; fees do not.

Evaluator outage/malformed response/uncertainty: no release. Bounded retries within decision window; unresolved work waits for expiry and explicit cancellation. Automatic fallback settlement is disabled in the outage demo.

Expiry does NOT auto-refund. The backend cancellation worker owns submitting EscrowCancel and tracking validation. It survives UI closure/restart; overdue cancellation is an error, not 'refunded'. Anyone can submit eligible cancellation, but the application must not leave follow-through to chance.

## 5. Three-layer gate and fail-closed behavior

Rules: authenticated callers, fixed network/asset/payee, amount/daily caps, funds/reserve, lifecycle, expiry, exact approval binding and replay protection. Code, not prompts. Hard failures are never overridden by Jev, an LLM or a persuasive deliverable. Rules are enforced controls, not literally unbreakable: bugs, races and compromised credentials remain risks.

Jev: fast typed off-chain judgment on frozen evidence, invoked per event, not a continuous 24/7 loop. Measure latency, accuracy and calibration on this workload. Typed outputs/probabilities are not guarantees.

LLM: conversation, task execution and explanation. A slower LLM may give a second opinion, but neither opinion nor explanation authorizes payment. Agents cannot submit arbitrary transaction JSON to the signer.

Escalation: rules -> deterministic acceptance -> Jev -> optional slower LLM review -> block or human review. Second opinions cannot override rules. MVP human review is inspect-only; unresolved ambiguity refunds after expiry. A future authenticated manual override needs exact owner approval and a separately designed policy, not a shortcut now.

The wobble zone must not be persuadable. Treat source/deliverable instructions as untrusted data; restrict responses and enforce permissions outside models. Prompt wording alone is not the firewall.

## 6. Policy and DecisionEngine contracts

Prototype configuration: TESTNET_ONLY=true; asset=XRP; per-job cap=2000000 drops; buyer daily locked-principal cap=10000000 drops; no commission. Enforce caps atomically, including reservations/pending creates. Demo cap window is UTC calendar day. Demo wallet allowlist is server configuration, never agent-editable.

Default demonstration expiry: 180 seconds from latest validated ledger close time during preparation. Decision cutoff: CancelAfter minus 30 seconds. Verify adequate remaining time at submit. Short demo deadlines are not production delivery windows.

DecisionEngine.evaluate input: request_id, job_snapshot_hash, deliverable_hash, source, criteria, deterministic results, policy_version and time remaining. No secrets, mutable payout instructions or keys. Bound sizes; reject excess instead of silently truncating criteria/attacks.

Normalized result: decision APPROVE/DECLINE/ESCALATE/UNAVAILABLE; task_satisfaction_score and injection_risk_score in 0..1 or null; provider/model/version; latency_ms; reason_codes; evaluated_at; request_id. Preserve raw score semantics separately. Satisfaction is not automatically calibrated confidence. Never invent missing probabilities or treat written model self-confidence as meaningful calibration.

Illustrative starting policy, NOT validated calibration: approve only if all hard checks pass, satisfaction >= 0.98 and injection risk <= 0.02. Decline for failed deterministic acceptance or injection risk >= 0.50. Otherwise escalate, including missing scores. Test on labelled and held-out examples before enabling live releases. Use explicit tested mapping from vendor probability types. Version threshold changes; do not lower thresholds to rescue a demo.

Adapters: JevDecisionEngine, ConstrainedJsonDecisionEngine with schema-enforced LLM response, FixtureDecisionEngine for tests. Fallback proposes a verdict but cannot auto-release without a separately tested explicit policy. Active mode/provider stays visible. Fixtures never pretend to be live Jev.

## 7. XRPL specifics

Use native EscrowCreate/EscrowFinish/EscrowCancel. Testnet: wss://s.altnet.rippletest.net:51233/ . Fund separate buyer/seller/service test wallets through official faucet/client methods. Never reuse test seeds on mainnet. Testnets can reset; no recorded receipt may be shown as a fresh live transaction.

CancelAfter uses Ripple epoch seconds, not Unix seconds. Use SDK conversion and unit tests. Finish/cancel eligibility depends on ledger close time, not laptop time. If adding FinishAfter later, check protocol constraints.

EscrowFinish needs Owner, OfferSequence and matching serialized Condition/Fulfillment. Anyone possessing the fulfillment can attempt to finish. Keep preimage secret until authorized submission. It then becomes public within the on-chain finish transaction: it cannot remain secret forever. Unique secrets and fixed destinations limit reuse; stale authorization/replay checks remain required.

Fees are XRP burned by the protocol, not platform revenue. Ordinary reference transaction cost is commonly 10 drops. Conditional finish uses a 330-drop base plus size-dependent increments at reference fee settings; server load/settings can change cost. Do not hardcode '330 total'. Use SDK/server estimation with a bounded fee policy. Verify account and escrow owner reserves at startup. Reserves are not commissions.

Submission success is not settlement. Require validated tesSUCCESS for lock/pay/refund. A tec failure can burn fees without completing the operation. Persist exact result codes. HTTP 200, local row or Jev approval never means paid.

Ledger is settlement truth; Supabase is a mirror of jobs/reasons/identity bindings. Blockchain shows addresses, not verified ownership or whether work was good. 'Every cent accounted for' is an audit goal, not guaranteed by blockchain alone.

Official RLUSD testnet tokens exist; documented issuer rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV, claim at https://tryrlusd.com/ . Token escrow exists subject to amendments/issuer opt-in. Prior live research on 10 Oct 2026 found allowTrustLineLocking=false at validated ledger 21430148 for that issuer, so native official test-RLUSD escrow was unavailable then. This is a dated prior observation, not a new check here. Recheck validated account_info and amendments before the event. MVP stays XRP; do not label self-issued tokens RLUSD.

## 8. Signer, secrets and custody

Buyer key funds escrow; service key pays finish/cancel fees; seller needs no shared key to receive. The isolated demo signer may hold only narrowly scoped TESTNET seeds. Production custody is unresolved and out of scope.

Internal authenticated signer methods accept job/escrow references and bound authorizations, not arbitrary transactions. Signer reads trusted records and checks network, asset, amount, destination, hashes, expiry, cap reservations, approval freshness and ledger escrow existence. Lock per escrow and serialize account Sequence allocation. DB UUID is not OfferSequence.

Encrypt preimages at rest with keys outside Supabase; DB stores secret_ref only. Seeds/preimages/API keys/service credentials never enter prompts, logs, crash traces, analytics, client bundles or git. Supabase service-role and Jev keys remain backend-only. Redact signed finish blobs before authorized broadcast because they contain fulfillment.

Authorization binding hash includes network, Owner, OfferSequence, amount_drops, destination, job_snapshot_hash, deliverable_hash, policy_version, decision_id and expiration. Authenticate gate-to-signer, expire quickly and consume atomically. This internal permission operates only within testnet limits; it is not a general user-consent system.

A compromised signer/gate can still release incorrectly. State that trust boundary. The ledger verifies condition/time compliance, not honest off-chain judging.

## 9. States, retries and recovery

Happy path: DRAFT -> CREATE_PENDING -> LOCKED -> IN_PROGRESS -> DELIVERED -> EVALUATING -> APPROVED -> FINISH_PENDING -> PAID.

Alternates: REJECTED_AWAITING_EXPIRY or REVIEW_REQUIRED -> EXPIRED_AWAITING_CANCEL -> CANCEL_PENDING -> REFUNDED. CREATE_FAILED requires a conclusive failed/expired create, not a network timeout. UNKNOWN_TX_STATE is a flag, not permission to start over. RECONCILIATION_REQUIRED freezes affected operations.

All transitions server-controlled/guarded and append-only recorded. PAID/REFUNDED cannot be reopened by agents. Ledger evidence wins over stale DB. Duplicate same-hash deliverable returns existing evaluation; changed submissions after delivery are refused for MVP. No source/criteria/payee/amount changes after funding.

Idempotency keys for job/fund/deliver/evaluate/settle. Unique constraints: one escrow per job, network/Owner/OfferSequence, tx hash, operation id and one-use authorization. Same key with changed body is a conflict.

Persist intent and tx hash before submission, excluding secret payloads from routine logs. Set LastLedgerSequence. After a timeout, lookup original hash and validated ledger state; do not sign a replacement blindly. Re-submit identical blob only as appropriate within validity. After conclusive expiration/absence, rebuild only after checking account Sequence and escrow state. Test crashes before submit, after submit and after validation.

Expiry worker starts on boot, scans due unresolved jobs, takes locks, queries ledger and submits eligible cancel. Finish/cancel share a lock. If another actor already settled, find actual finish/cancel evidence and reconcile. Retry transient errors with bounded backoff and alert on unresolved jobs; never depend on an open browser.

## 10. Data and APIs

Supabase migrations/indexes:
- participants: id, role, verified_demo_wallet, verification_mode, enabled.
- jobs: id, buyer_id, seller_id, source_text, criteria_json, snapshot_hash, policy_version, amount_drops, network, cancel_after, state, version, created_at.
- deliverables: id, job_id unique for MVP, payload_json, payload_hash, received_at.
- escrows: job_id unique, owner, offer_sequence, destination, amount_drops, condition, secret_ref, create_tx_hash, ledger_index, cancel_after, settlement_status.
- decisions: id, job_id, request_id unique, adapter/model_version, normalized_result, provider_score_semantics, input_hash, deliverable_hash, policy_version, latency_ms, decided_at.
- authorizations: decision_id, binding_hash, expires_at, consumed_at; trusted services only.
- transactions: operation_id unique, job_id, type, tx_hash unique, submission_status, validated_result, ledger_index, fee_drops, submitted_at, validated_at.
- job_events: event_id, job_id, previous/next state, actor_id, correlation_id, timestamp, reason_codes.
- reconciliation_findings: job/account, expected, observed, ledger_index, severity, resolved_at.
- cap_reservations: buyer_id, window_id, job_id unique, reserved_drops, disposition; atomically reserve/release on definitive outcomes.

UTC storage; deliberate local display. Canonical hash encoding/sorted keys tested. Safe integer/numeric storage for drops. RLS provides authorized read access; browser writes through authenticated backend. Never allow UI-controlled state patching. Service-role bypass still requires backend checks.

Public API defaults: POST /jobs; POST /jobs/:id/fund; POST /jobs/:id/deliverable; GET /jobs/:id; GET /jobs/:id/receipt; GET /dashboard; GET /health. Evaluate/finish/cancel/reconcile are internal worker actions. No public /release-secret or unrestricted /sign. POSTs require caller authorization, idempotency key, schema and size limit. Pending work returns 202 + operation_id; GET shows current state. Changed idempotent requests return 409. Errors never expose secrets/private vendor payloads.

Repo: apps/web, apps/api, services/signer, packages/contracts, packages/policy, packages/decision-engine, packages/xrpl-settlement, packages/workflow, db/migrations, tests/unit/integration/e2e/redteam, fixtures. Key-bearing modules cannot enter web imports. Include README/run scripts and .env.example with names/placeholders only.

## 11. Jev access

Official docs https://docs.typesafe.ai/introduction/quickstart ; POST https://api.typesafe.ai/v1/systemone . SDKs typesafe-sdk (Python), @typesafe-ai/sdk (JS). jev-1.13.0 or jev-latest; pin and record resolved version.

OpenRouter explicitly offers Jev to anyone with an OpenRouter key, no separate TypeSafe waitlist: https://openrouter.ai/docs/guides/community/jev . Routes: POST https://openrouter.ai/api/alpha/decisions or SDK-compatible https://openrouter.ai/api/v1/systemone . Not ordinary chat completions. Direct TypeSafe admission and a paid call were not tested; obtaining a key/smoke test remains a task.

Checked 10 Oct 2026: $0.042 per million input tokens, output free; official limits 100K tokens/sec and 80 requests/sec, subject to change. Official budget 64K total request, 32K state plus longest question. OpenRouter guide has a 32K shorthand; obey provider's actual constraints and test. Meter actual tokens/cost; no 'free forever' claim.

Only use official vendor origins. Prior research found jevmodel.net/docs uses its own nonofficial endpoint. Never enter a TypeSafe key there or treat it as official. This is provenance caution, not proof of malicious intent.

Smoke test a tiny typed decision; inspect response shape/score semantics. Test timeout, 429, 401, 5xx, malformed values. At most two transient retries within cutoff; no endless auth retries. Bounded concurrency/backoff; no secrets in telemetry. Fixture demos must be labelled, not advertised as live Jev.

## 12. Dashboard, receipts and reconciliation

Read-only dashboard: job/escrow state, immutable amount/payee, owner/sequence, countdown, validation status, verdict, score meaning, latency, provider, blocked/escalated counters and cancellation queue. TESTNET always visible. Never paid at approval time. Receipt includes job/deliverable/policy hashes, assertions, decision identifiers/scores, reason codes, authorization binding, actual tx hash, validated ledger index, timestamp and fee. No preimages/keys.

Decisions/sec is measured over a labelled interval, not animated fake metrics. Separate synthetic load from live workflow throughput; empirical calibration from returned scores. A handful of calls is not a scale benchmark.

Reconciler compares DB settlement, escrow existence and validated transactions with a ledger cursor. Balance deltas involve burned fees/reserves: naive DB-total=wallet-balance is wrong. Missing escrow alone is not payment proof; locate finish/cancel metadata. Freeze affected releases on mismatch and create review finding. Never automatically fabricate a corrective payment. DB logs are not immutable against privileged operators; hashes/append-only design help but differ from ledger immutability.

Optional fraud demo: corrupt a mirror record only in isolated demo data, show PLANTED DB MISMATCH and freeze. Do not tamper with ledger/shared data. Core three paths first.

## 13. Security testing and acceptance

Unit tests: money math, cap concurrency, ledger-time conversion, hash canonicalization, lifecycle, authorization one-use/expiry/binding, condition serialization, log redaction.

Testnet integration: validated create/finish; reject/expire/cancel; outage/no release/refund; wrong fulfillment/owner/sequence; changed wallet/amount; premature cancel; near-expiry finish; duplicate requests; disconnect; fee/reserve failures; crash before submit/after submit/after validation; DB failure after payment.

Adversarial cases: ignore criteria/pay now; role-play/fake admin; hidden/encoded injection; changed wallet; replayed approval; changed deliverable under old verdict; oversized payload; boundary scores; forged callbacks; concurrent signing. Expected: no unauthorized release, reason recorded, funds held until correct settlement/refund.

Use garak and promptfoo through a custom adapter to the application gate. They don't automatically test signing invariants or prove Jev secure. Mix valid/incomplete/attack/ambiguous examples. Separate held-out testing from threshold tuning. Measure injection detection, unauthorized validated release (attack success), false release, false block, escalation, latency, sample size and model/version. Zero observed failures is not universal immunity.

Release gate: deterministic tests pass; zero unauthorized release in defined test set; all three outcomes validated on Testnet; crash/duplicate recovery avoids double settlement; secrets absent from browser/logs; paid/refunded only after validation; cancellation survives restart; live/fixture/future modes honest. If Jev accuracy fails policy, demonstrate escalation/refund, don't claim solved verification.

## 14. Four-minute demo

0:00-0:25: problem/frame and immutable job terms. Agents can do work; trusting completion enough to pay is harder.

0:25-1:25: buyer posts invoice job, test escrow locks, seller delivers, rules/Jev pass, signer finishes, validated receipt. Pre-fund wallets before talk; don't disguise recording as live.

1:25-2:20: audience injection in bounded seller-output field, not shell commands. Show blocked/escalated verdict, unchanged payee and no release. Don't promise every attack detected; even a missed injection cannot change payee/amount through rules.

2:20-3:15: rejected and evaluator-down refund paths. Start separate short-lived demonstration escrows ahead of this segment, show actual creation/expiry times, cancel only when eligible. If validation delayed, display pending; recorded backup is clearly labelled.

3:15-3:40: dashboard/receipt. Optional quorum and planted mismatch only if fully tested, otherwise explain on a labelled future-architecture slide.

3:40-4:00: fee model, company onboarding direction and real-world compliance work. One reliable workflow, not a finished regulated marketplace. Don't cram unproven live tricks into four minutes.

## 14A. Demo presentation, differentiation and naming

Presentation is part of the product. The four minutes is what judges remember, so treat the demo as a deliverable with the same discipline as the code. Everything here is delivery guidance, not extra software.

Backup video: once the full flow works, record the complete demo (create, finish, rejection refund, evaluator-down refund, dashboard) as a screen capture with voice-over. Venue wifi is the most common demo killer. If the network fails, play the video, say it is a recording, and keep talking. Label it as recorded, never as live. Re-record after any significant UI or flow change.

Rehearsal: rehearse out loud at least ten times with a timer, ideally in front of someone. Target 3:45 so there is slack. Know exactly what to say if a step is slow or fails. Pre-fund wallets and start the short-lived demonstration escrows before going on stage.

Scope freeze: the day the core flow works end to end (create, finish, cancel, Jev verdict, dashboard), freeze scope. After that, only fixes, polish, receipts, copy and demo reliability. Quorum, marketplace browser and Paperclip stay stretch items and are not started after the freeze. Polish beats features.

Differentiation versus a clone. Many teams will show 'escrow plus an AI judge'. Stand apart by doing these: (1) demo the failure paths, not only the happy path: a rejected deliverable that refunds the buyer, and an evaluator-offline case that fails closed and refunds after expiry. (2) Invite a live audience injection attack against the seller-output field and show it blocked or escalated with payee and amount unchanged. (3) Show a decision receipt on demand: for any job, the criteria, verdict, confidence, rule checks, timestamps and ledger transaction hashes. (4) Show live dashboard numbers: cost per decision, decisions per second, blocked count. Use only figures actually measured; do not quote pricing or throughput as measured results unless measured. (5) Use one concrete job type, the synthetic invoice flow, rather than an abstract marketplace. (6) Deliver it rehearsed, with the backup video ready.

Naming: pick a product name before building, because it forces the one-line story ('the trust layer for the agent economy') that judges repeat to each other. Do not use 'Jev' in the product name: it is a third-party model (trademark and confusion risk), and the product is the trust layer, not the model. Directions discussed, undecided and awaiting the user's pick: Surety, Covenant, Vouch, Arbiter, Bonded. Do a quick check for existing products, domains and trademarks with the chosen name before committing. Until chosen, use the working title 'Agent Escrow' and keep the name in one config constant so it can change in one place.

## 15. Scale later

Paperclip planned orchestration: https://github.com/paperclipai/paperclip . Verify actual integration before adopting. Orchestrator routes/hire-schedules agents on demand; no keys, secrets or settlement override. It recommends work, not payments. Keyless orchestration still needs cost/abuse quotas.

Later: durable queues, partitioned jobs, stateless policy services, per-account sequence control, backpressure, reconciliation cursors and budgets. Ledger throughput/settlement latency differ from Jev decisions/sec. Do not promise millions of payments from model rates.

Quorum: multiple structured checks with explicit aggregation/veto policy. Same-model/evidence votes have correlated errors; majority is not automatic safety. Large-transaction threshold/policy needs testing. MVP caps never expand just because three votes approve. Optional demo quorum uses test amounts within caps and is labelled prototype.

Accounting: record asset quantity, fees, event/ledger timestamp/index, ZAR valuation, rate source/pair, quote timestamp and methodology for relevant events. Event-driven rate capture, no 24/7 FX watcher. Stablecoins do not eliminate USD/ZAR exposure/depeg risk/tax valuation. Executed conversion and reference valuation are different fields. Missing rate is flagged and queued for sourced backfill, never invented. An SA accountant determines applicable timing/treatment. Test XRP has no real ZAR tax valuation; illustrative dashboard values must be labelled simulated.

## 16. Business model and SA regulation

Talk track: possible 5% fee per completed job, not implemented pricing. Native escrow has one destination. Choose no commission for demo. Future choices: seller receives gross then explicitly authorizes separate fee payment; or buyer funds separate seller/fee escrows with disclosed terms. Multi-transaction splits can partially complete; don't call them atomic unless proven. Disclose fees/refund terms before locking.

Company onboarding later: policy, budgets, approved identity/wallets, task systems and dashboards. No settings portal now. KYC/wallet ownership is not proven by a checkbox/allowlist.

Orientation, not legal advice: CASP licensing may apply to relevant SA crypto-asset advisory/intermediary activity depending on business model. Custody, AML/FIC, customer safeguards and SARB exchange control need review before real-money/cross-border flows. SARS applies normal tax rules; facts determine income versus capital gains. ZAR records help but don't ensure compliance.

This isolated testnet prototype uses valueless tokens/synthetic data; it is not a real-money CASP launch. Do not claim the entire future business has no obligations because the demo uses Testnet. Speak to an SA fintech lawyer/accountant before real funds, custody or customers. This spec authorizes no production launch.

## 17. Build order and done

A. Organizer rules; official Jev key; repo/fixtures/testnet wallets. Keep rules clarification independent of coding. Write contracts/invariants first.

B. Escrow spike without agents: fresh secret, create/validate, finish/validate, expire/cancel/validate; redacted receipts. Stop if settlement fails; UI polish won't fix it.

C. Jev spike: response mapping, timeout/malformed behavior, labelled dataset, tested thresholds. No release until gate tests pass.

D. Narrow workflow + signer + Supabase. Add idempotency/caps/cancellation/crash recovery. Three outcomes headless first.

E. Minimal UI/receipts/counters; bounded audience input; red-team harness; restart/race tests.

F. Rehearse, then stretch Paperclip/quorum/reconciliation fixture. Cut flaky features. Recheck vendor/network/event settings before November.

Done: fresh checkout can apply migrations, set backend secrets, fund test wallets, run tests and demonstrate three validated outcomes. README explains supported task, trust boundaries, live/fixture modes, known limits, recovery and why real funds aren't supported.

## 18. Claude handoff

Build the testnet-only prototype in this document. First restate MVP scope, identify current API conflicts and propose phased implementation. Implement settlement spike/tests before agents/UI. Verify installed SDK schemas/imports/response types; don't invent APIs. Maintain the state machine/invariants. Never silently remove signer isolation, validation, cap concurrency, replay protection, cancellation, recovery or secret hygiene.

Use proposed stack/defaults unless a verified incompatibility needs a change. Clearly label fixtures. No mainnet/real funds, arbitrary signing, real KYC, unapproved spending, organizer emails, eligibility claims or secret exposure. Ask before changing core trust boundaries/scope. Deliver runnable code, migrations, placeholder .env.example, tests, README, redacted receipts and known limitations. Keep scale/business/legal material as documentation, not extra software.

## 19. Sources and open items

Reviewed 10 Oct 2026. Dynamic prices, limits, issuer flags and terms need recheck. Design choices are recommendations; prior RLUSD flag observation is explicitly dated. No mainnet or paid API call performed for this spec.

- Event/application: https://w3node.io/ ; https://w3node.io/node-engine
- EscrowCreate: https://xrpl.org/docs/references/protocol/transactions/types/escrowcreate
- EscrowFinish: https://xrpl.org/docs/references/protocol/transactions/types/escrowfinish
- EscrowCancel: https://xrpl.org/docs/references/protocol/transactions/types/escrowcancel
- Escrow model: https://xrpl.org/docs/concepts/payment-types/escrow
- Fees: https://xrpl.org/docs/concepts/transactions/transaction-cost
- Token escrow: https://xrpl.org/docs/tutorials/payments/send-fungible-token-escrows
- RLUSD setup: https://docs.ripple.com/products/stablecoin/developer-resources/rlusd-on-the-xrpl
- TypeSafe: https://docs.typesafe.ai/introduction/quickstart ; https://docs.typesafe.ai/models
- OpenRouter access/routes: https://openrouter.ai/docs/guides/community/jev
- Paperclip: https://github.com/paperclipai/paperclip
- garak: https://docs.garak.ai/
- promptfoo: https://www.promptfoo.dev/docs/red-team/
- SARS: https://www.sars.gov.za/individuals/crypto-assets-tax/
- FSCA official licensing update: https://www.fsca.co.za/_api/cr3ad_newses%28cec3c818-bbdb-f011-8544-7ced8d771a24%29/cr3ad_document/%24value . Application to this business remains undetermined.

Organizer questions: pre-event prototypes/code/assets/AI-generated code; exact hacking window; team cap; deadline/selection; track requirements; sponsor/prize/UDAX terms; judging rubric; internet/power/testnet expectations. No organizer email has been sent in this task.
