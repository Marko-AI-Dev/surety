# Signer and Escrow Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove on XRPL Testnet, through an isolated signer that is the only holder of keys, one escrow locked then paid and one escrow locked then refunded after expiry, with validated transaction hashes as evidence.

**Architecture:** A pnpm TypeScript workspace. `services/signer` is a separate Node process on 127.0.0.1 that holds the testnet seeds and preimage key, accepts only three HMAC-authenticated escrow operations, enforces limits and checks ledger state itself. Pure XRPL helpers live in `packages/xrpl-settlement`, shared schemas and authorization signing in `packages/contracts`, and an HTTP client in `packages/signer-client`. A spike script outside the signer drives the flow and writes redacted evidence.

**Tech Stack:** Node 24, pnpm 10, TypeScript 7.0.2, xrpl 5.3.0, zod 4.6.7, vitest 5.1.0, tsx 4.23.15. Pin exact versions (`pnpm add -E`).

**Spec:** `docs/specs/master-build-spec.md` (sections 4, 7, 8, 9) and `docs/step1-plan-review.md` (Phases 0 and 1, section 2 corrections).

## Global Constraints

- TESTNET ONLY. Signer refuses to start unless `server_info` network id is `1` (XRPL Testnet). WS default `wss://s.altnet.rippletest.net:51233/`.
- No script or package outside `services/signer` may read a seed, the preimage key, or construct a `Wallet`. Enforced by `scripts/check-boundaries.ts`.
- Signer accepts job and escrow references plus bound authorizations, never arbitrary transaction JSON. Any other route returns 404.
- XRP amounts are integer drop strings matching `^[1-9][0-9]*$`. No floating-point money math. Use `BigInt` for comparisons.
- Per-job cap `MAX_JOB_DROPS` default `2000000`. Demo job amount `1000000` drops.
- CancelAfter = latest validated ledger `close_time` (Ripple epoch seconds) + requested seconds. Allowed window 60 to 86400 seconds. Never use laptop time for eligibility.
- PREIMAGE-SHA-256: 32 random bytes. Condition `A0258020 ‖ SHA256(P) ‖ 810120`, fulfillment `A0228020 ‖ P`, uppercase hex.
- Finish and cancel are signed and fee-paid by the SERVICE wallet. EscrowCreate is signed by the BUYER wallet.
- A result counts only when validated with `tesSUCCESS`. Persist tx hash to the journal before submitting. Never return or log a fulfillment or seed.
- Authorization lifetime at most 120 seconds, one use, HMAC-SHA256 with `GATE_AUTH_SECRET`. Binding fields: network, owner, offerSequence, amountDrops, destination, jobSnapshotHash, deliverableHash, policyVersion, decisionId, expiresAt, nonce.
- Bounded fees: xrpl `Client` option `maxFeeXRP: "0.01"`.
- Commits use `261926348+Marko-AI-Dev@users.noreply.github.com`. Never commit `.env`, `services/signer/.env`, `services/signer/data/`, `evidence/*` containing secrets (evidence is redacted by construction), or `docs/reference/`.
- Prose in docs: no em-dashes or double-dashes.

## Review Focus

1. Signer restarts between create and finish. Expected: escrow mapping and sealed fulfillment are on disk, a new signer instance finishes it. Test in Task 4.
2. Same authorization used twice, including concurrently. Expected: exactly one finish is submitted, the other returns `authorization_consumed`. Test in Task 4.
3. Laptop clock disagrees with ledger. Expected: finish refused once ledger close time is past `cancelAfter - 5`, cancel refused before ledger close time passes `cancelAfter`, regardless of `Date.now()`. Test in Task 4.
4. Retry of the same `opId` after a submit error. Expected: no second signature; the journaled hash is looked up instead. Same `opId` with a different body returns `op_conflict`. Test in Task 4.
5. Malformed or oversized request body. Expected: 400 `bad_request` (16 KB limit), process stays up. Test in Task 5.

---

### Task 1: Repo skeleton, GitHub repo, disclosure (Phase 0)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`, `PRIOR_WORK.md`

- [ ] **Step 1:** `git init -b main`; set repo-local `user.name "Marko"`, `user.email 261926348+Marko-AI-Dev@users.noreply.github.com`.
- [ ] **Step 2:** Root `package.json` (`"private": true`, `"type": "module"`, `"packageManager": "pnpm@10.28.2"`, `engines.node ">=24"`), scripts: `test` = `vitest run`, `typecheck` = `tsc -b`, `check:boundaries` = `tsx scripts/check-boundaries.ts`, `signer` = `pnpm --filter @surety/signer start`, `spike` = `tsx scripts/spike-escrow.ts`. Workspace globs `packages/*`, `services/*`. Dev deps pinned: typescript, vitest, tsx, @types/node.
- [ ] **Step 3:** `.gitignore`: `node_modules`, `dist`, `.env`, `.env.*` except `.env.example`, `services/signer/.env`, `services/signer/data/`, `docs/reference/`, `*.log`, `.playwright-mcp/`.
- [ ] **Step 4:** `.env.example` with names only: `SIGNER_URL=http://127.0.0.1:4100`, `SIGNER_HMAC_SECRET=`, `GATE_AUTH_SECRET=`, `SELLER_ADDRESS=`, `XRPL_WS_URL=wss://s.altnet.rippletest.net:51233/`, `OPENROUTER_API_KEY=`.
- [ ] **Step 5:** `PRIOR_WORK.md`: planning docs written Oct 2026 before the event; Paperclip (MIT, not yet integrated); Jev UI tester pattern from Marko's own pre-event tool (to be ported, licence of upstream jev-ultrafast to be confirmed); awm-agent UI used as visual reference only pending ownership check. `README.md` stub: one-paragraph pitch, TESTNET ONLY banner, status.
- [ ] **Step 6:** `pnpm install`, `pnpm typecheck`, `pnpm test -- --passWithNoTests`. Expected: all exit 0.
- [ ] **Step 7:** Commit `chore: workspace skeleton, disclosure and plan docs` (includes `docs/specs`, `docs/research`, `docs/step1-plan-review.md`, this plan). `gh repo create Marko-AI-Dev/surety --public --source . --push`.

### Task 2: Crypto-conditions and ledger time (`packages/xrpl-settlement`)

**Files:**
- Create: `packages/xrpl-settlement/{package.json,tsconfig.json}`, `src/conditions.ts`, `src/time.ts`, `src/tx.ts`, `src/ledger-read.ts`, `src/explorer.ts`, `src/index.ts`
- Test: `packages/xrpl-settlement/test/conditions.test.ts`, `test/time.test.ts`, `test/tx.test.ts`

**Interfaces:**
- Produces: `preimageCondition(preimage: Uint8Array): { condition: string; fulfillment: string }` (throws `RangeError` if length > 125); `newPreimage(): Buffer` (32 random bytes); `RIPPLE_EPOCH_OFFSET = 946684800`; `cancelAfterFrom(closeTime: number, seconds: number): number`; `rippleToIso(t: number): string`; `buildEscrowCreate({account, destination, amountDrops, condition, cancelAfter}): EscrowCreate`; `buildEscrowFinish({account, owner, offerSequence, condition, fulfillment}): EscrowFinish`; `buildEscrowCancel({account, owner, offerSequence}): EscrowCancel`; `getValidatedCloseTime(client: Client): Promise<number>`; `getEscrow(client, owner: string, offerSequence: number): Promise<EscrowEntry | null>` (`EscrowEntry = { Account, Destination, Amount, Condition?, CancelAfter? }`, null on `entryNotFound`); `getTxResult(client, hash): Promise<{ validated: boolean; result?: string; ledgerIndex?: number; feeDrops?: string }>`; `explorerTxUrl(hash: string): string` = `https://testnet.xrpl.org/transactions/${hash}`.

- [ ] **Step 1: Failing tests.** `conditions.test.ts`, vectors from rippled `PreimageSha256_test.cpp`:
  - empty preimage: fulfillment `A0028000`, condition `A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100`
  - `"aaa"`: fulfillment `A0058003616161`, condition `A02580209834876DCFB05CB167A5C24953EBA58C4AC89B1ADF57F28F2F9D09AF107EE8F0810103`
  - 32 zero bytes: condition `A025802066687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925810120`, fulfillment `A0228020` + 64 zeros
  - 126-byte preimage throws `RangeError`; `newPreimage()` is 32 bytes and two calls differ.
  `time.test.ts`: `cancelAfterFrom(800000000, 180) === 800000180`; `rippleToIso(0) === "2000-01-01T00:00:00.000Z"`. `tx.test.ts`: builders produce exact `TransactionType`, field names and no `FinishAfter` on create.
- [ ] **Step 2:** `pnpm vitest run packages/xrpl-settlement`. Expected: FAIL, modules missing.
- [ ] **Step 3:** Implement. Fulfillment `A0 (L+2) 80 L ‖ P`; condition `A0 25 80 20 ‖ SHA256(P) ‖ 81 01 L`. `ledger-read.ts` uses `client.request` with `ledger_index: "validated"` (`ledger`, `ledger_entry` with `escrow: { owner, seq }`, `tx`).
- [ ] **Step 4:** Tests pass, `pnpm typecheck` clean.
- [ ] **Step 5:** Commit `feat(xrpl-settlement): preimage conditions, ledger time, escrow builders`.

### Task 3: Contracts and authorization (`packages/contracts`, `packages/signer-client`)

**Files:**
- Create: `packages/contracts/src/{money.ts,canonical.ts,authorization.ts,signer-api.ts,transport.ts,index.ts}`, `packages/signer-client/src/index.ts`
- Test: `packages/contracts/test/{money,canonical,authorization,transport}.test.ts`

**Interfaces:**
- Produces: `isDrops(s: string): boolean`; `canonicalJson(v: unknown): string` (recursively sorted keys, no whitespace, throws on `undefined`, functions, non-finite numbers); `sha256Hex(data: string | Uint8Array): string`; zod `AuthorizationPayload` (fields per Global Constraints, `network: "testnet"`, hashes 64 lowercase hex, `nonce` 32 hex, `expiresAt` ISO); `bindingHash(p: AuthorizationPayload): string`; `signAuthorization(p, secret: string): SignedAuthorization` (`{ payload, sig }`); `verifyAuthorization(a: unknown, secret: string, now: Date): { ok: true; payload; bindingHash } | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "too_long_lived" }`; zod `CreateEscrowRequest { opId: uuid, jobRef: string 1..64, destination, amountDrops, cancelAfterSeconds: int }`, `FinishEscrowRequest { opId, authorization }`, `CancelEscrowRequest { opId, owner, offerSequence: int }`, `CreateEscrowResponse { opId, txHash, owner, offerSequence, condition, cancelAfter, ledgerIndex, result }`, `SettleResponse { opId, txHash, ledgerIndex, result, feeDrops }`, `ErrorBody { error: string, message: string }`; transport: headers `x-surety-ts`, `x-surety-sig`, `signRequest(secret, ts: string, method, path, body: string): string` = HMAC-SHA256 hex over `${ts}\n${method}\n${path}\n${sha256Hex(body)}`; `createSignerClient({ url, hmacSecret }): { health(), createEscrow(req), finishEscrow(req), cancelEscrow(req) }` throwing `SignerClientError { status, code }`.

- [ ] **Step 1: Failing tests.** `money`: `"1000000"` true; `"0"`, `"01"`, `"1.5"`, `"-1"`, `""` false. `canonical`: `{b:1,a:{d:2,c:3}}` → `{"a":{"c":3,"d":2},"b":1}`; key order of input does not change hash; `undefined` throws. `authorization`: round trip ok and `bindingHash` matches; changing `amountDrops`, `destination` or `deliverableHash` after signing gives `bad_signature`; `expiresAt` in the past gives `expired`; `expiresAt` > now + 120 s gives `too_long_lived`; missing field gives `malformed`; verification uses `timingSafeEqual`. `transport`: same inputs give same sig; any changed part changes it.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement with `node:crypto` and zod.
- [ ] **Step 4:** Tests pass, typecheck clean.
- [ ] **Step 5:** Commit `feat(contracts): drops, canonical hashing, one-use authorization, signer API`.

### Task 4: Signer core with fake ledger (`services/signer`)

**Files:**
- Create: `services/signer/src/{config.ts,store.ts,secretbox.ts,ledger.ts,signer.ts,errors.ts,lock.ts}`, `services/signer/.env.example`
- Test: `services/signer/test/fake-ledger.ts`, `test/signer.test.ts`, `test/secretbox.test.ts`

**Interfaces:**
- Consumes: Task 2 builders and `preimageCondition`, `newPreimage`, `cancelAfterFrom`; Task 3 schemas and `verifyAuthorization`.
- Produces: `loadConfig(env: NodeJS.ProcessEnv): SignerConfig` (requires `BUYER_SEED`, `SERVICE_SEED`, `PREIMAGE_KEY` 64 hex, `SIGNER_HMAC_SECRET` ≥ 32 chars, `GATE_AUTH_SECRET` ≥ 32 chars, `DESTINATION_ALLOWLIST` comma list; defaults `XRPL_WS_URL` testnet, `MAX_JOB_DROPS "2000000"`, `MIN_CANCEL_SECONDS 60`, `MAX_CANCEL_SECONDS 86400`, `FINISH_MARGIN_SECONDS 5`, `PORT 4100`, `DATA_DIR ./data`); `interface LedgerPort { networkId(): Promise<number>; validatedCloseTime(): Promise<number>; getEscrow(owner, seq): Promise<EscrowEntry | null>; autofill<T>(tx: T): Promise<T>; submitSigned(blob: string, hash: string): Promise<{ validated: boolean; result: string; ledgerIndex: number; feeDrops: string; sequence?: number }>; lookup(hash: string): Promise<{ validated: boolean; result?: string; ledgerIndex?: number; feeDrops?: string }> }`; `seal(key: Buffer, plaintext: string): Sealed` / `open(key, sealed): string` (AES-256-GCM); `createSigner(deps: { config; ledger: LedgerPort; buyer: Wallet; service: Wallet }): Signer` with `createEscrow(req): Promise<CreateEscrowResponse>`, `finishEscrow(req): Promise<SettleResponse>`, `cancelEscrow(req): Promise<SettleResponse>`, `health(): Promise<{ network: "testnet"; buyer: string; service: string }>`; `SignerError { code, status }` with codes `bad_request 400`, `destination_not_allowed 403`, `amount_over_cap 403`, `cancel_window_invalid 400`, `authorization_invalid 403`, `authorization_consumed 409`, `escrow_not_found 404`, `escrow_mismatch 409`, `finish_window_closed 409`, `cancel_not_yet_eligible 409`, `op_conflict 409`, `op_pending 409`, `ledger_failure 502`.
- Persistence under `DATA_DIR`: `escrows.json` (key `owner:offerSequence` → `{ jobRef, secretRef, condition, amountDrops, destination, cancelAfter, createTxHash }`), `secrets.json` (secretRef → Sealed fulfillment), `consumed.json` (nonces), `journal.jsonl` (`{ opId, requestHash, type, txHash, lastLedgerSequence, status, response? }`). Atomic writes (tmp file + rename). `withLock(key, fn)` serializes per account address and per escrow key.

- [ ] **Step 1: Failing tests** in `signer.test.ts` using `FakeLedger` (in-memory escrows, settable close time, records submitted blobs, real `Wallet.generate()` test wallets):
  - create within cap to allowlisted destination returns `offerSequence`, condition starting `A0258020`, `cancelAfter = close + seconds`; response never contains a fulfillment.
  - destination not allowlisted → `destination_not_allowed`; `"2000001"` → `amount_over_cap`; `cancelAfterSeconds` 59 or 86401 → `cancel_window_invalid`.
  - finish with valid authorization submits EscrowFinish from the service account whose Fulfillment matches the stored preimage; escrow then gone from fake ledger.
  - restart: second `createSigner` over the same `DATA_DIR` finishes an escrow created by the first (Review Focus 1).
  - same authorization twice, and two concurrent `finishEscrow` with it → exactly one submitted blob, other `authorization_consumed` (Review Focus 2).
  - tampered payload → `authorization_invalid`; payload amount or destination differing from ledger escrow → `escrow_mismatch`; unknown escrow → `escrow_not_found`.
  - close time ≥ `cancelAfter - 5` → finish `finish_window_closed`; cancel with close time ≤ `cancelAfter` → `cancel_not_yet_eligible`; after it → cancel submitted by service account (Review Focus 3, with `Date.now` mocked far in the past and future to prove it is ignored).
  - submit throws after journaling: retry with same `opId` calls `lookup` and submits no second blob; same `opId` with different body → `op_conflict` (Review Focus 4).
  - non-`tesSUCCESS` validated result → `ledger_failure` with the result code in the message, journal records it.
  `secretbox.test.ts`: round trip; tampered ciphertext throws.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement. Order inside finish: verify authorization → lock escrow key → nonce not consumed → load mapping → ledger escrow exists and matches owner, amount, destination, condition → close time window → mark nonce consumed (persist) → build, autofill, sign with service wallet → journal hash → submit → persist result.
- [ ] **Step 4:** Tests pass, typecheck clean.
- [ ] **Step 5:** Commit `feat(signer): isolated escrow signer with limits, one-use authorizations and journal`.

### Task 5: Signer process, real ledger, wallet setup

**Files:**
- Create: `services/signer/src/{xrpl-ledger.ts,http.ts,main.ts}`, `services/signer/scripts/init-wallets.ts`
- Test: `services/signer/test/http.test.ts`

**Interfaces:**
- Consumes: Task 3 transport and schemas, Task 4 `createSigner`, `LedgerPort`.
- Produces: `XrplLedger(url)` implementing `LedgerPort` with `new Client(url, { maxFeeXRP: "0.01" })`; `createHttpServer(signer, config): http.Server` routes `GET /health`, `POST /escrows/create`, `POST /escrows/finish`, `POST /escrows/cancel`, 404 otherwise; `main.ts` exits non-zero unless network id is 1, binds `127.0.0.1:${PORT}`; `init-wallets.ts` funds buyer, service and seller via `client.fundWallet()` on testnet, writes `services/signer/.env` (seeds, generated `PREIMAGE_KEY`, secrets, `DESTINATION_ALLOWLIST=<seller>`) and root `.env` (`SIGNER_URL`, the two shared secrets, `SELLER_ADDRESS`), refuses to overwrite existing files, discards the seller seed, prints addresses only.

- [ ] **Step 1: Failing tests** in `http.test.ts` (signer stubbed): missing or wrong `x-surety-sig` → 401; timestamp skew > 30 s → 401; `POST /sign` and `POST /submit` → 404; body > 16 KB → 400; invalid JSON → 400 and server still answers `/health`; `SignerError` maps to its status and `{ error, message }`; response bodies never contain `seed`, `Fulfillment` or `PREIMAGE`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement. `XrplLedger.submitSigned` uses `client.submitAndWait(blob)`; `lookup` uses `getTxResult`.
- [ ] **Step 4:** Tests pass, typecheck clean.
- [ ] **Step 5:** Run `pnpm --filter @surety/signer exec tsx scripts/init-wallets.ts`. Expected: three classic addresses printed, both `.env` files exist, `git status` shows neither.
- [ ] **Step 6:** Commit `feat(signer): http boundary, testnet ledger adapter, wallet setup`.

### Task 6: Testnet spike, boundary check, evidence

**Files:**
- Create: `scripts/spike-escrow.ts`, `scripts/check-boundaries.ts`, `tests/boundary.test.ts`, `docs/architecture.md`, `evidence/.gitkeep`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createSignerClient`, `signAuthorization`, `sha256Hex`, `getEscrow`, `getTxResult`, `getValidatedCloseTime`, `explorerTxUrl`.

- [ ] **Step 1: Failing test** `tests/boundary.test.ts`: `checkBoundaries(root)` returns no violations for the repo, and returns a violation for a temp file outside `services/signer` containing `Wallet.fromSeed(`. Patterns: `fromSeed`, `Wallet.generate`, `_SEED`, `PREIMAGE_KEY`, `secretbox`.
- [ ] **Step 2:** Run, expect FAIL. Implement `checkBoundaries`, test passes.
- [ ] **Step 3:** Implement `spike-escrow.ts`: health; Job A create (1000000 drops, 180 s) → mint authorization (expires in 60 s, random nonce, `jobSnapshotHash` = sha256 of `"spike-job-A"`, `deliverableHash` = sha256 of `"spike-deliverable-A"`, `policyVersion "spike-0"`) → finish → confirm validated `tesSUCCESS` and `getEscrow` null; Job B create (1000000 drops, 60 s) → cancel immediately, expect `cancel_not_yet_eligible` → reuse Job A authorization, expect `authorization_consumed` → poll validated close time until past `cancelAfter` → cancel → confirm validated and escrow gone. Write `evidence/spike-<UTC timestamp>.json` with hashes, ledger indexes, fees, explorer links and refusal codes. No fulfillment in output.
- [ ] **Step 4:** Start signer (`pnpm signer`), run `pnpm spike`. Expected: two `tesSUCCESS` creates, one finish, one cancel, both refusals, evidence file written. Check one hash on `https://testnet.xrpl.org`.
- [ ] **Step 5:** `docs/architecture.md`: Mermaid component diagram (agents, API/gate, Jev, signer, Supabase, XRPL) marking what exists now versus planned, and the trust boundary. README: run instructions and latest evidence links.
- [ ] **Step 6:** `pnpm test`, `pnpm typecheck`, `pnpm check:boundaries` all exit 0. Commit `feat: testnet escrow spike with validated pay and refund evidence` and push.
