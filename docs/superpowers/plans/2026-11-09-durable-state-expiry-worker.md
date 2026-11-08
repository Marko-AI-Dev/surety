# Durable State and Expiry Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jobs live in Supabase with a guarded, append-only state machine, and a worker refunds every expired escrow by ledger time, even when it was stopped and restarted before expiry.

**Architecture:** A local Supabase stack (own ports 577xx) holds the mirror: jobs, escrows, transactions, job_events. `packages/workflow` owns the state machine, deterministic operation ids, a `JobsRepo` interface with Postgres and in-memory implementations, `fundJob` and `runExpirySweep`. `services/worker` runs the sweep on boot and every few seconds. The signer (Phase 1, unchanged) stays the only key holder; the workflow reaches it only through `@surety/signer-client`. The ledger is settlement truth; the database is a mirror.

**Tech Stack:** As Phase 1, plus Supabase CLI 2.101.0 (local, Docker), `postgres` 4.1.0 (porsager) for backend SQL.

**Spec:** `docs/specs/master-build-spec.md` sections 4, 9, 10; `docs/step1-plan-review.md` section 1 (Phase 2 row, 7-table cut). Phase 1 code: `services/signer`, `packages/signer-client`, `packages/contracts`, `packages/xrpl-settlement`.

## Global Constraints

- Everything from `docs/superpowers/plans/2026-11-08-signer-escrow-spike.md` Global Constraints still holds (testnet only, keys only in the signer, drops as integer strings, validated `tesSUCCESS` only, no em-dashes in prose, noreply commits).
- Do not modify `services/signer/src/*` except to fix a bug proven by a failing test; record it as a ruling.
- Supabase project dir `supabase/` at repo root, `project_id = "surety"`. Ports: api 57721, db 57722, shadow 57720, studio 57723, inbucket 57724, analytics 57727, pooler 57729. Never touch the other running stacks (ot-practice, silvertree-replica, mip-v2, crm-postgres).
- Start with `supabase start -x studio,imgproxy,logflare,vector,edge-runtime,storage-api` (confirm names with `supabase start --help`; keep db, rest, realtime, auth, kong). `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:57722/postgres` appended to root `.env` and listed in `.env.example`.
- Drops stored as `numeric(20,0)`; returned to TypeScript as strings. Ripple time stored as `integer` seconds.
- Ledger time decides due-ness: the worker reads the validated ledger close time with a read-only xrpl `Client` (`getValidatedCloseTime`), never `Date.now()`.
- All state changes go through one guarded transition that checks the allowed-transition map, updates `WHERE id = $id AND state = $from`, bumps `version`, and inserts a `job_events` row in the same database transaction.
- `job_events` is append-only, enforced by a trigger. `PAID`, `REFUNDED`, `CREATE_FAILED` are terminal.
- Operation ids sent to the signer are deterministic per job and operation, so a restarted worker replays instead of re-signing.
- RLS enabled on every table with no policies yet (browser access comes in Phase 5); the backend connects as `postgres`.
- Unit tests (`pnpm test`) must not need Docker. Database tests live in `tests/db/` and run with `pnpm test:db` against the local stack.

## Review Focus

1. Worker stopped before expiry and restarted after it. Expected: the first sweep on boot refunds; nothing depended on memory. Tests in Task 4 (in-memory) and Task 5 (Postgres), evidence in Task 6 (testnet, real process kill).
2. Laptop clock ahead of or behind ledger time. Expected: a job is due only when validated ledger close time is past its escrow `cancel_after`. Test in Task 4.
3. Signer unreachable or returning `op_pending` / `ledger_failure` mid-sweep. Expected: the job stays `CANCEL_PENDING`, no event claims a refund, the next sweep retries with the same operation id. Test in Task 4.
4. Escrow already gone when the worker cancels (finished elsewhere or by someone else). Expected: `RECONCILIATION_REQUIRED` with a reason code, never `REFUNDED`. Test in Task 4.
5. Two sweeps racing on the same job. Expected: one guarded transition wins, the other is a no-op; the signer sees one operation id. Test in Task 5 (Postgres, `Promise.all` of two sweeps).

---

### Task 1: Local Supabase and core schema

**Files:**
- Create: `supabase/config.toml` (via `supabase init`, then edit ports and `project_id`), `supabase/migrations/20261109000000_core.sql`, `tests/db/schema.db.test.ts`, `vitest.db.config.ts`
- Modify: `package.json` (scripts `db:start`, `db:stop`, `db:reset`, `test:db`; devDependency `postgres@4.1.0` at root), `vitest.config.ts` (exclude `tests/db/**`), `.env.example` (`DATABASE_URL`), root `.env` (append `DATABASE_URL`, never print the file)

Schema (exact):
- `jobs`: `id uuid pk default gen_random_uuid()`, `ref text unique not null check (ref ~ '^[A-Za-z0-9._:-]{1,64}$')`, `network text not null default 'testnet' check (network = 'testnet')`, `buyer_address text not null`, `seller_address text not null`, `amount_drops numeric(20,0) not null check (amount_drops > 0)`, `source_text text not null`, `criteria jsonb not null`, `snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$')`, `policy_version text not null`, `cancel_after_seconds integer not null check (cancel_after_seconds between 60 and 86400)`, `state text not null default 'DRAFT' check (state in (<the 16 states of Task 2>))`, `version integer not null default 0`, `created_at`, `updated_at timestamptz not null default now()`.
- `escrows`: `job_id uuid pk references jobs(id)`, `network text not null check (network = 'testnet')`, `owner text not null`, `offer_sequence integer not null`, `destination text not null`, `amount_drops numeric(20,0) not null`, `condition text not null`, `cancel_after integer not null` (Ripple seconds), `create_tx_hash text not null unique`, `create_ledger_index integer not null`, `unique (network, owner, offer_sequence)`.
- `transactions`: `id bigint generated always as identity pk`, `operation_id uuid not null unique`, `job_id uuid not null references jobs(id)`, `type text not null check (type in ('create','finish','cancel'))`, `tx_hash text unique`, `status text not null check (status in ('pending','validated','failed'))`, `result text`, `ledger_index integer`, `fee_drops numeric(20,0)`, `submitted_at timestamptz not null default now()`, `validated_at timestamptz`.
- `job_events`: `id bigint generated always as identity pk`, `job_id uuid not null references jobs(id)`, `from_state text`, `to_state text not null`, `actor text not null`, `reason_codes text[] not null default '{}'`, `correlation_id text`, `detail jsonb`, `created_at timestamptz not null default now()`; trigger `job_events_append_only` raising on UPDATE or DELETE.
- Indexes: `jobs(state)`, `escrows(cancel_after)`, `job_events(job_id, id)`. RLS enabled on all four tables.

- [ ] **Step 1:** `supabase init` (non-interactive), set ports and `project_id`, write the migration, `pnpm db:start`. Expected: stack up on 577xx, other stacks untouched (`docker ps` still lists them).
- [ ] **Step 2: Failing tests** `tests/db/schema.db.test.ts` (connects with `DATABASE_URL`): insert a valid job; `amount_drops = 0` rejected; `network = 'mainnet'` rejected; unknown `state` rejected; two escrows for one job rejected; same `(network, owner, offer_sequence)` twice rejected; UPDATE and DELETE on `job_events` raise `append-only`. Run `pnpm test:db` before the migration exists (or against an empty schema) and see it fail, then apply.
- [ ] **Step 3:** `pnpm db:reset`, `pnpm test:db`. Expected: all pass. `pnpm test` still passes without touching the database.
- [ ] **Step 4:** Commit `feat(db): local Supabase stack and core job schema`.

### Task 2: State machine and operation ids (`packages/workflow`)

**Files:**
- Create: `packages/workflow/{package.json,src/states.ts,src/operation-id.ts,src/index.ts}`, `packages/workflow/test/{states,operation-id}.test.ts`

**Interfaces:**
- Produces: `JOB_STATES` (readonly tuple of the 16 states: `DRAFT, CREATE_PENDING, LOCKED, IN_PROGRESS, DELIVERED, EVALUATING, APPROVED, FINISH_PENDING, PAID, REJECTED_AWAITING_EXPIRY, REVIEW_REQUIRED, EXPIRED_AWAITING_CANCEL, CANCEL_PENDING, REFUNDED, CREATE_FAILED, RECONCILIATION_REQUIRED`); `type JobState`; `TERMINAL_STATES = [PAID, REFUNDED, CREATE_FAILED]`; `CANCELLABLE_STATES` = every non-terminal state from `LOCKED` onward except `RECONCILIATION_REQUIRED`; `canTransition(from: JobState, to: JobState): boolean`; `assertTransition(from, to): void` throwing `TransitionError { from, to }`; `operationId(jobId: string, op: "create" | "finish" | "cancel", attempt = 0): string`.
- Allowed transitions (exact): `DRAFT→CREATE_PENDING`; `CREATE_PENDING→LOCKED|CREATE_FAILED|RECONCILIATION_REQUIRED`; `LOCKED→IN_PROGRESS|EXPIRED_AWAITING_CANCEL`; `IN_PROGRESS→DELIVERED|EXPIRED_AWAITING_CANCEL`; `DELIVERED→EVALUATING|EXPIRED_AWAITING_CANCEL`; `EVALUATING→APPROVED|REJECTED_AWAITING_EXPIRY|REVIEW_REQUIRED|EXPIRED_AWAITING_CANCEL`; `APPROVED→FINISH_PENDING|EXPIRED_AWAITING_CANCEL`; `FINISH_PENDING→PAID|RECONCILIATION_REQUIRED|EXPIRED_AWAITING_CANCEL`; `REJECTED_AWAITING_EXPIRY→EXPIRED_AWAITING_CANCEL`; `REVIEW_REQUIRED→EXPIRED_AWAITING_CANCEL`; `EXPIRED_AWAITING_CANCEL→CANCEL_PENDING`; `CANCEL_PENDING→REFUNDED|RECONCILIATION_REQUIRED`. Nothing leaves `PAID`, `REFUNDED`, `CREATE_FAILED`, `RECONCILIATION_REQUIRED`.
- `operationId`: first 16 bytes of `sha256("surety:" + jobId + ":" + op + ":" + attempt)`, version nibble set to 5, RFC 4122 variant bits set, formatted as a lowercase UUID; must pass `z.uuid()`.

- [ ] **Step 1: Failing tests.** Every listed transition allowed; `PAID→REFUNDED`, `REFUNDED→LOCKED`, `DRAFT→LOCKED`, `LOCKED→PAID` rejected; every terminal state has no outgoing transition; `assertTransition` throws `TransitionError`. `operationId` is stable across calls, differs by job, op and attempt, and parses with `z.uuid()` from zod.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Tests and typecheck pass.
- [ ] **Step 5:** Commit `feat(workflow): job state machine and deterministic operation ids`.

### Task 3: Jobs repository (Postgres and in-memory)

**Files:**
- Create: `packages/workflow/src/{repo.ts,memory-repo.ts,pg-repo.ts,snapshot.ts}`, `packages/workflow/test/memory-repo.test.ts`, `tests/db/pg-repo.db.test.ts`

**Interfaces:**
- Consumes: Task 2 states and `assertTransition`; `canonicalJson`, `sha256Hex` from `@surety/contracts`.
- Produces: `interface Job { id; ref; network: "testnet"; buyerAddress; sellerAddress; amountDrops: string; sourceText; criteria: unknown; snapshotHash; policyVersion; cancelAfterSeconds: number; state: JobState; version: number }`; `interface EscrowRow { jobId; owner; offerSequence: number; destination; amountDrops: string; condition; cancelAfter: number; createTxHash; createLedgerIndex: number }`; `interface JobsRepo { createJob(input: NewJob): Promise<Job>; getJob(id): Promise<Job | null>; getEscrow(jobId): Promise<EscrowRow | null>; transition(jobId, from: JobState, to: JobState, event: { actor: string; reasonCodes: string[]; correlationId?: string; detail?: unknown }): Promise<Job>; attachEscrow(row: EscrowRow): Promise<void>; recordPendingTx(t: { operationId; jobId; type }): Promise<void>; completeTx(operationId, r: { txHash; status: "validated" | "failed"; result; ledgerIndex?; feeDrops? }): Promise<void>; listDueForCancel(ledgerCloseTime: number): Promise<{ job: Job; escrow: EscrowRow }[]>; listEvents(jobId): Promise<JobEvent[]>; close(): Promise<void> }`; `interface JobEvent { id: number; jobId: string; fromState: JobState | null; toState: JobState; actor: string; reasonCodes: string[]; correlationId: string | null; detail: unknown; createdAt: string }`; `NewJob` = `Job` minus `id, network, snapshotHash, state, version`; `snapshotHash(input: NewJob): string` = `sha256Hex(canonicalJson({ ref, buyerAddress, sellerAddress, amountDrops, sourceText, criteria, policyVersion, cancelAfterSeconds }))`; `class TransitionConflict extends Error` (row not in `from` state). `createMemoryRepo(): JobsRepo`; `createPgRepo(databaseUrl: string): JobsRepo`.
- `transition` calls `assertTransition` first, then (Postgres) runs `UPDATE ... WHERE id AND state = from RETURNING *` plus the event insert inside `sql.begin`; zero rows throws `TransitionConflict`. `recordPendingTx` is idempotent on `operation_id` (insert, do nothing on conflict). `listDueForCancel` returns jobs in `CANCELLABLE_STATES` joined to an escrow with `cancel_after < ledgerCloseTime`.

- [ ] **Step 1: Failing tests**, the same behavioural suite run against both implementations (shared test factory `describeRepo(name, make)` in `packages/workflow/test/repo-contract.ts`, imported by the memory test and the db test): create computes snapshot hash and starts `DRAFT`; valid transition bumps version and appends one event; disallowed transition throws `TransitionError` and writes nothing; stale `from` throws `TransitionConflict`; `listDueForCancel` includes a `LOCKED` job past `cancel_after`, excludes one not yet due, excludes `PAID` and `REFUNDED`; `recordPendingTx` twice with one operation id keeps one row.
- [ ] **Step 2:** Run both, expect FAIL. **Step 3:** Implement. **Step 4:** `pnpm test` and `pnpm test:db` pass.
- [ ] **Step 5:** Commit `feat(workflow): jobs repository with guarded transitions`.

### Task 4: Funding and the expiry sweep

**Files:**
- Create: `packages/workflow/src/{fund.ts,expiry.ts}`, `packages/workflow/test/{fake-signer.ts,fund.test.ts,expiry.test.ts}`

**Interfaces:**
- Consumes: `JobsRepo`, `operationId`, `SignerClient` and `SignerClientError` from `@surety/signer-client`.
- Produces: `fundJob(deps: { repo; signer: SignerClient; actor: string }, jobId: string): Promise<Job>`; `runExpirySweep(deps: { repo; signer: SignerClient; ledgerCloseTime: () => Promise<number>; log?: (line: string) => void }): Promise<SweepReport>` with `SweepReport = { closeTime: number; refunded: string[]; pending: string[]; reconciliation: string[] }`.
- `fundJob`: job must be `DRAFT` (transition to `CREATE_PENDING`) or already `CREATE_PENDING` (resume). `recordPendingTx` with `operationId(job.id, "create")`, call `signer.createEscrow({ opId, jobRef: job.ref, destination: job.sellerAddress, amountDrops: job.amountDrops, cancelAfterSeconds: job.cancelAfterSeconds })`. Success: `attachEscrow`, `completeTx(validated)`, transition to `LOCKED` with reason `validated_tesSUCCESS` and the tx hash in `detail`. Signer refusal codes `destination_not_allowed`, `amount_over_cap`, `cancel_window_invalid`, `bad_request`: `completeTx(failed)` and transition to `CREATE_FAILED` with the code as reason. Anything else (`ledger_failure`, `op_pending`, network error): stay `CREATE_PENDING`, rethrow; calling `fundJob` again resumes with the same operation id.
- `runExpirySweep`: read `ledgerCloseTime()` once; for each due job, walk it to `EXPIRED_AWAITING_CANCEL` (reason `ledger_time_past_cancel_after`) then `CANCEL_PENDING`, `recordPendingTx(operationId(job.id, "cancel"))`, call `signer.cancelEscrow`. Validated: `completeTx`, transition to `REFUNDED`. `cancel_not_yet_eligible`, `op_pending`, `ledger_failure`, network errors: leave `CANCEL_PENDING`, add to `pending`. `escrow_not_found`, `escrow_mismatch`: transition to `RECONCILIATION_REQUIRED` with that code. A `TransitionConflict` (another sweep moved it) skips the job. One failing job never stops the sweep.

- [ ] **Step 1: Failing tests** with `createMemoryRepo` and a `FakeSigner` implementing `SignerClient` (records calls by opId, configurable per-call outcome, throws real `SignerClientError`):
  - `fundJob` locks a draft job, stores the escrow, records the create tx validated, events `DRAFT→CREATE_PENDING→LOCKED`.
  - `fundJob` on `amount_over_cap` ends `CREATE_FAILED`; on `ledger_failure` stays `CREATE_PENDING`, and a second call reuses the same opId and reaches `LOCKED`.
  - sweep with ledger close time before `cancel_after` does nothing, even with `Date.now` faked to year 2099; after it (with `Date.now` faked to 2001) refunds: state `REFUNDED`, events through `EXPIRED_AWAITING_CANCEL` and `CANCEL_PENDING` (Review Focus 2).
  - restart: sweep A runs before expiry; a brand-new sweep (new deps object, same repo) after expiry refunds, and the signer saw exactly one cancel opId (Review Focus 1).
  - signer throws `op_pending`, then `ledger_failure`, then a `TypeError` (unreachable): job stays `CANCEL_PENDING` each time with no `REFUNDED` event; the next sweep with a success outcome refunds using the same opId (Review Focus 3).
  - `escrow_not_found` leads to `RECONCILIATION_REQUIRED`, never `REFUNDED` (Review Focus 4). `PAID` jobs are never swept.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Tests and typecheck pass.
- [ ] **Step 5:** Commit `feat(workflow): funding and restart-safe expiry sweep`.

### Task 5: Worker process and Postgres restart test

**Files:**
- Create: `services/worker/{package.json,src/main.ts}`, `tests/db/expiry.db.test.ts`
- Modify: `.env.example` (`SWEEP_INTERVAL_MS=5000`)

**Interfaces:**
- Consumes: `createPgRepo`, `runExpirySweep`, `createSignerClient`, `getValidatedCloseTime`.
- Produces: `services/worker` with `start` = `tsx --env-file=../../.env src/main.ts`. On boot: connect DB, connect read-only xrpl `Client` to `XRPL_WS_URL`, log `Surety expiry worker | sweep every N ms`, run one sweep immediately, then every `SWEEP_INTERVAL_MS` (default 5000) without overlapping runs. One log line per refunded, pending or reconciliation job and per sweep error. Graceful SIGINT/SIGTERM. The worker never reads a seed (boundary lint still passes).

- [ ] **Step 1: Failing test** `tests/db/expiry.db.test.ts` with `createPgRepo` and `FakeSigner`: job locked with `cancel_after = T`; sweep at `T - 10` does nothing; close the repo (simulated crash); new repo plus new sweep at `T + 1` refunds; `listEvents` shows the refund path with actor `expiry-worker`. Race: two sweeps on two repo connections via `Promise.all` at `T + 1`; exactly one `REFUNDED` event and one cancel opId at the signer (Review Focus 5).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement worker. **Step 4:** `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm check:boundaries` all pass.
- [ ] **Step 5:** Commit `feat(worker): expiry worker process with sweep on boot`.

### Task 6: Testnet restart evidence

**Files:**
- Create: `scripts/restart-refund-demo.ts`
- Modify: `README.md` (Status and evidence), `docs/architecture.md` (mark worker and Supabase built), `docs/log.md` (decisions and spend)

- [ ] **Step 1:** Implement the demo (needs signer running and the Supabase stack up): create a job (ref `restart-demo-<timestamp>`, seller `SELLER_ADDRESS`, `1000000` drops, synthetic invoice source and criteria, policy `phase2-0`, `cancelAfterSeconds 60`) with `createPgRepo`, `fundJob` it, then spawn the worker as a single child process (`spawn(process.execPath, ["--env-file=.env", "--import", "tsx", "services/worker/src/main.ts"])`), let it run 15 s, kill it with `child.kill("SIGKILL")` while validated ledger close time is still before `cancel_after`, wait with no worker until ledger time passes `cancel_after`, spawn a fresh worker, wait for the job to reach `REFUNDED` (timeout 120 s), stop the worker. Write `evidence/restart-refund-<UTC>.json`: job id, create and cancel tx hashes with explorer links, ledger close time at kill vs `cancel_after`, worker start and kill times, and the full `job_events` list.
- [ ] **Step 2:** Run it against testnet. Expected: refund validated `tesSUCCESS` by the second worker; the first worker was killed before expiry. Afterwards confirm no stray `node` process holds port 4100 or runs the worker (Windows can orphan children: check `netstat` and the process command line before killing anything, and only kill processes started from this repo).
- [ ] **Step 3:** Update README, architecture and log. `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm check:boundaries` pass. Commit `feat: testnet evidence of restart-safe refunds` and push.
