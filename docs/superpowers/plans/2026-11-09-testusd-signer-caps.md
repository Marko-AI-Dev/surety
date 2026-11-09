# TESTUSD Settlement in the Signer, Plus Caps (Phase 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The isolated signer can lock, pay and refund deals in TESTUSD, our self-issued test dollar, through XRPL token escrow. Before locking, it enforces a per-deal cap, a rolling 24-hour cap, an open-deal limit and a destination-readiness check. The XRP path keeps working unchanged.

**Architecture:**
- **Wire formats change additively.** The signer request and the gate authorization gain an optional `amountTestUsdCents`, and exactly one of `amountDrops` or `amountTestUsdCents` must be present. Existing XRP bodies, request hashes, binding hashes and job snapshot hashes stay byte-identical.
- **Workflow types move to one discriminated `AssetAmount`.** The database stores `asset` plus one amount column.
- **The signer holds no new key.** The issuer's seed lives in a separate file that only the setup script reads.
- **TESTUSD settings come from config.** The issuer, the approved suppliers and the caps are environment settings.
- **The signer exposes three money operations** (create, finish, cancel), plus health. Amended 9 Nov at Marko's request, it also has **one operator-only policy update** (`POST /operator/policy`), authenticated with its own `OPERATOR_HMAC_SECRET`. The worker and the agents never hold that secret. The policy covers the caps and the approved suppliers, persists in the signer's data directory, takes effect on the next lock, and keeps every change in a history file. Locks already on the ledger settle on their own terms.
- **Build-time limits are small** (Marko, 9 Nov): $2,500 per deal, $25,000 per 24 hours and 5 open deals while we build. They are raised to the demo values ($100,000 per deal, $500,000 per 24 hours) through the policy update on Thursday.

**Tech Stack:** TypeScript, Node 24, pnpm workspace, vitest 5.1.0, xrpl 5.3.0, zod 4.6.7, postgres 4.1.0, local Supabase.

**Spec:** `docs/product-brief.md` (approved 9 Nov 2026) and `PRODUCT.md`. The mechanics were proven in `services/signer/scripts/spike-token-escrow.ts` and `evidence/token-escrow-trial-testusd-2026-11-09T08-13-36-693Z.json`.

## Global Constraints

- **Network:** XRPL Testnet only. Every script checks `network_id === 1` and refuses otherwise.
- **Keys:** never commit keys or seeds, and never print or log a seed. Wallet and seed handling stays under `services/signer`. `pnpm check:boundaries` must stay green.
- **Amounts** are positive integer strings, never floats. TESTUSD is counted in cents: `$48,000` is `"4800000"`.
- **TESTUSD currency code** is the hex string `5445535455534400000000000000000000000000` (`"TESTUSD"` in ASCII, padded to 40 hex characters). It is never `tUSD`, because TUSD is the ticker of TrueUSD.
- **Issuer flags:** the issuer has `asfDefaultRipple` and `asfAllowTrustLineLocking` set. Holders opt in with a TrustSet.
- **Time:** validated ledger close time decides every time window. Laptop time never does.
- **Refusal codes** are snake_case entries in `services/signer/src/errors.ts` `ERROR_STATUS`, and messages name limits, never secrets.
- **Signer surface:** three money operations (create, finish, cancel), health, and the operator-only policy update. No raw-transaction endpoint. The worker secret can't reach the policy route, and the operator secret can't reach a money route.
- **Default TESTUSD limits:** `250000` cents per deal ($2,500), `2500000` cents per rolling 24 hours ($25,000), and 5 open deals.
- **Spend:** no paid API calls in this plan.
- **Existing tests:** all 397 unit tests and 48 DB tests keep passing. Any edit to one is mechanical (amount shape only) and named in its task.
- **Wording:** user-facing messages say "deal", not "job".

## Review Focus

1. **Two concurrent TESTUSD locks that together exceed the daily cap.** Exactly one may succeed. Both are serialized by the buyer lock. Pinned in Task 5.
2. **A signer restart.** The rolling daily total and the open-deal count must be rebuilt from `escrows.json` plus the journal, never reset to zero. Pinned in Task 5.
3. **A ledger value with more than 2 decimals, in exponent notation, or from a different issuer.** The finish must refuse with `escrow_mismatch` (fail closed). Pinned in Tasks 2 and 6.
4. **A trust-line read that fails** (ledger down) during the readiness check. It must refuse with `ledger_failure` and sign nothing. Pinned in Task 4.
5. **An XRP escrow record written before this change**, with no `asset` field. It must still finish and cancel. Pinned in Task 6.
6. **Credential crossover.** A policy update signed with the worker's `SIGNER_HMAC_SECRET` must get `401`, and a money call signed with `OPERATOR_HMAC_SECRET` must get `401`. A policy update racing a lock must leave the lock judged entirely by the old policy or entirely by the new one. Pinned in Task 7.

---

### Task 1: Contracts: asset amounts on the wire

**Files:**
- Modify: `packages/contracts/src/money.ts`, `packages/contracts/src/schemas.ts`, `packages/contracts/src/signer-api.ts`, `packages/contracts/src/authorization.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/money.test.ts`, `packages/contracts/test/authorization.test.ts`, `packages/contracts/test/signer-api.test.ts` (new)

**Interfaces:**
- Produces, in `money.ts`:
  - `MAX_TESTUSD_CENTS = 100_000_000_000n`
  - `isCents(value: string): boolean`, which uses the same pattern as `isDrops` and enforces `<= MAX_TESTUSD_CENTS`
  - `type AssetAmount = { asset: "XRP"; drops: string } | { asset: "TESTUSD"; cents: string }`
  - `type WireAmount = { amountDrops: string } | { amountTestUsdCents: string }`
  - `wireAmount(a: AssetAmount): WireAmount`
  - `assetAmountOf(w: { amountDrops?: string; amountTestUsdCents?: string }): AssetAmount`, which throws a `RangeError` naming both fields unless exactly one is present and valid
- Produces, in `schemas.ts`: a `Cents` zod string refined by `isCents`.
- Produces, in `CreateEscrowRequestSchema` and `AuthorizationPayloadSchema`:
  - `amountDrops` becomes optional and `amountTestUsdCents: Cents` is added as optional
  - an object-level refine with the message `"exactly one of amountDrops or amountTestUsdCents is required"`
  - both stay `.strict()`
- Produces, in the responses:
  - `CreateEscrowResponse.issuer?: string`, present only for TESTUSD
  - `HealthResponse.testUsd?: { issuer: string; currencyHex: string; approvedSuppliers: string[]; limits: { perDealCents: string; dailyCents: string; openDeals: number } }`

- [ ] **Step 1: Write the failing tests**
  - `money.test.ts`:
    - `isCents` accepts `"1"` and `"100000000000"`, and rejects `"0"`, `"0123"`, `"1.5"`, `"1e6"`, `"-1"`, `""` and `"100000000001"`.
    - `wireAmount({ asset: "TESTUSD", cents: "4800000" })` deep-equals `{ amountTestUsdCents: "4800000" }`, and `Object.keys` of the result is exactly `["amountTestUsdCents"]`. No undefined-valued key is allowed, because `canonicalJson` throws on undefined.
    - `assetAmountOf({ amountDrops: "1", amountTestUsdCents: "1" })` and `assetAmountOf({})` both throw `/exactly one/`.
  - `authorization.test.ts`:
    - "an XRP payload's binding hash is unchanged": hard-code the `bindingHash` of the existing fixture payload, computed before the change, and assert it still matches.
    - A TESTUSD payload (`amountTestUsdCents: "4800000"`, no `amountDrops`) round-trips through `signAuthorization` and `verifyAuthorization`.
    - A payload with both fields gives `{ ok: false, reason: "malformed" }`.
  - `signer-api.test.ts`: `CreateEscrowRequestSchema` accepts XRP-only and TESTUSD-only bodies. It rejects a body with both fields, a body with neither, and a body whose `amountTestUsdCents` is `"48000.00"`.

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm vitest run packages/contracts`. Expected: FAIL. `isCents`, `wireAmount` and `assetAmountOf` aren't exported yet, and the TESTUSD payload is rejected as malformed.

- [ ] **Step 3: Implement the exports and schema changes listed under Interfaces.** Use the `exactlyOne` refine for both schemas.

- [ ] **Step 4: Run the tests and watch them pass.** Run `pnpm vitest run packages/contracts && pnpm typecheck`. Expected: PASS. Type errors downstream, where `amountDrops` became optional, are fixed by later tasks. If typecheck fails only in `signer.ts`, `settle.ts`, `fund.ts` or `authorize.ts`, note it and continue.

- [ ] **Step 5: Commit.** `git commit -m "feat(contracts): TESTUSD cents alongside drops on the signer and authorization wire"`

---

### Task 2: XRPL settlement: TESTUSD amounts, escrow reads, trust lines

**Files:**
- Create: `packages/xrpl-settlement/src/token.ts`
- Modify: `packages/xrpl-settlement/src/tx.ts`, `packages/xrpl-settlement/src/ledger-read.ts`, `packages/xrpl-settlement/src/index.ts`
- Test: `packages/xrpl-settlement/test/token.test.ts` (new), `packages/xrpl-settlement/test/ledger-read.test.ts` (new, stub `Client` in the style of `services/signer/test/xrpl-ledger.test.ts`), `packages/xrpl-settlement/test/tx.test.ts`

**Interfaces:**
- Produces, in `token.ts`:
  - `TESTUSD_CURRENCY_HEX = "5445535455534400000000000000000000000000"`
  - `interface IssuedAmount { currency: string; issuer: string; value: string }`
  - `testUsdAmount(issuer: string, cents: string): IssuedAmount`. The value is a plain decimal with no trailing zeros: `"4800000"` gives `"48000"`, `"1250050"` gives `"12500.5"`, `"1"` gives `"0.01"`.
  - `tokenValueToCents(value: string): string | null`. It accepts only plain decimals with at most 2 fraction digits and a positive value: `"48000"` gives `"4800000"`, `"12500.5"` gives `"1250050"`, `"0.01"` gives `"1"`. It returns `null` for `"0"`, `"-1"`, `"0.001"`, `"1e3"` and `""`.
- Produces, in `tx.ts`: `buildEscrowCreate` takes `amount: string | IssuedAmount` in place of `amountDrops`. This is the only other call site change, in `services/signer/src/signer.ts:244` (Task 4).
- Produces, in `ledger-read.ts`:
  - `EscrowEntry.Amount: string | IssuedAmount`
  - `getEscrow` returns an IOU amount as-is and throws `"escrow holds an unsupported amount"` for any other object (for example an MPT amount)
  - `interface TrustLine { balance: string; limit: string; frozenByIssuer: boolean }`
  - `getTrustLine(client: Client, account: string, issuer: string, currencyHex: string): Promise<TrustLine | null>`. It runs `account_lines` with `peer: issuer` on the validated ledger and takes the line whose `currency === currencyHex`. `frozenByIssuer` is `freeze_peer === true`. It returns `null` for no line or `actNotFound`.

- [ ] **Step 1: Write the failing tests**
  - `token.test.ts`: the exact vectors above in both directions, plus `tokenValueToCents(testUsdAmount(i, c).value) === c` for `c` in `["1", "99", "4800000", "100000000000"]`.
  - `ledger-read.test.ts`:
    - "getEscrow returns a TESTUSD amount": a stub node with `Amount: { currency: TESTUSD_CURRENCY_HEX, issuer: "rI…", value: "48000" }`.
    - "getEscrow throws on an MPT amount": `{ mpt_issuance_id, value }`.
    - "getTrustLine returns null when the account has no TESTUSD line".
    - "getTrustLine maps balance, limit and freeze_peer".
    - "getTrustLine returns null for actNotFound".
  - `tx.test.ts`: `buildEscrowCreate` with an `IssuedAmount` puts that object in `Amount` unchanged. The existing XRP case now passes `amount: "1000000"`.

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm vitest run packages/xrpl-settlement`. Expected: FAIL, because `token.ts` doesn't exist and `getTrustLine` isn't exported.

- [ ] **Step 3: Implement `token.ts`, the `tx.ts` parameter change and the `ledger-read.ts` additions.** Do the cents conversion with BigInt and string arithmetic, never `Number`.

- [ ] **Step 4: Run the tests and watch them pass.** Run `pnpm vitest run packages/xrpl-settlement`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(xrpl-settlement): TESTUSD amounts, IOU escrow reads and trust-line lookup"`

---

### Task 3: Signer config and ledger port for TESTUSD

**Files:**
- Modify: `services/signer/src/config.ts`, `services/signer/src/ledger.ts`, `services/signer/src/xrpl-ledger.ts`, `services/signer/src/errors.ts`
- Modify (test support): `services/signer/test/fake-ledger.ts`. The `beforeEach` config literal in `services/signer/test/signer.test.ts` and `http.test.ts` gets `testUsd: null` (mechanical).
- Test: `services/signer/test/config.test.ts`, `services/signer/test/xrpl-ledger.test.ts`

**Interfaces:**
- Produces, in `SignerConfig`: `testUsd: null | { issuer: string; approvedSuppliers: string[]; maxDealCents: bigint; dailyCents: bigint; maxOpenDeals: number; operatorSecret: string }`. It is `null` unless `TESTUSD_ISSUER` is set.
- **Environment variables:**
  - `TESTUSD_ISSUER` (classic address)
  - `APPROVED_SUPPLIERS` (comma list of classic addresses; required when the issuer is set)
  - `MAX_DEAL_TESTUSD_CENTS`, default `"250000"` ($2,500)
  - `DAILY_TESTUSD_CENTS`, default `"2500000"` ($25,000)
  - `MAX_OPEN_TESTUSD_DEALS`, default `5`
  - These are the initial policy only. Once `policy.json` exists in `DATA_DIR`, it wins (Task 7).
  - `OPERATOR_HMAC_SECRET`: required when the issuer is set, at least 32 characters, and different from `SIGNER_HMAC_SECRET` and `GATE_AUTH_SECRET`.
- Produces, in `ERROR_STATUS`:
  - `daily_cap_reached: 403`
  - `open_deal_limit_reached: 403`
  - `destination_not_ready: 409`
  - `insufficient_funds: 409`
  - `asset_not_enabled: 400`
- Produces, in `LedgerPort`:
  - `trustLine(account: string, issuer: string, currencyHex: string): Promise<TrustLine | null>`
  - `issuerAllowsLocking(issuer: string): Promise<boolean>`, which is `account_info` on the validated ledger with `lsfAllowTrustLineLocking` set
- Produces, on `FakeLedger`:
  - `trustLines: Map<string, TrustLine>`, keyed `${account}:${issuer}`
  - `throwOnNextTrustLine: boolean`
  - `lockingAllowed = true`
  - `apply()` stores an IOU `Amount` on EscrowCreate unchanged

- [ ] **Step 1: Write the failing tests**
  - `config.test.ts`:
    - "TESTUSD stays off unless TESTUSD_ISSUER is set": `config.testUsd === null`.
    - "applies TESTUSD cap defaults of 250000 cents, 2500000 cents and 5 open deals".
    - "rejects an invalid TESTUSD_ISSUER, an invalid APPROVED_SUPPLIERS address, a missing APPROVED_SUPPLIERS, and a non-cents cap": problems name each variable, and the thrown message contains none of the values.
    - "requires OPERATOR_HMAC_SECRET when TESTUSD is on, and refuses one equal to SIGNER_HMAC_SECRET or GATE_AUTH_SECRET".
  - `xrpl-ledger.test.ts`: "issuerAllowsLocking reads lsfAllowTrustLineLocking from account_info", with flags `1073741824` true and `0` false.

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm vitest run services/signer/test/config.test.ts services/signer/test/xrpl-ledger.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the config parsing (reuse `isCents`), the error codes, the `LedgerPort` methods, `XrplLedger` (delegate `trustLine` to `getTrustLine`) and the `FakeLedger` support.**

- [ ] **Step 4: Run the tests and watch them pass.** Run `pnpm vitest run services/signer`. Expected: PASS, including every existing signer test.

- [ ] **Step 5: Commit.** `git commit -m "feat(signer): TESTUSD config, refusal codes and trust-line reads"`

---

### Task 4: Signer create: TESTUSD locks, approved suppliers, per-deal cap, readiness

**Files:**
- Modify: `services/signer/src/signer.ts` (`createEscrow`, `EscrowRecord`, `PendingCreate`, `finalize`)
- Test: `services/signer/test/signer.test.ts` (new `describe("createEscrow in TESTUSD")`, with a `testUsdConfig()` helper and a `readyLines()` helper that seeds trust lines for buyer and seller)

**Interfaces:**
- Consumes: Task 1's `assetAmountOf` and `wireAmount`, Task 2's `testUsdAmount` and `TESTUSD_CURRENCY_HEX`, Task 3's `config.testUsd` and `ledger.trustLine`.
- Produces, in `EscrowRecord`:
  - `asset?: "XRP" | "TESTUSD"`, where absent means XRP (old records)
  - `amountTestUsdCents?: string`
  - `issuer?: string`
  - `lockedAtCloseTime?: number`, the validated close time read for this create
  - `amountDrops` becomes optional
- Produces, in the response: `CreateEscrowResponse.issuer` for TESTUSD.
- **Check order for TESTUSD**, cheap local checks before any ledger read:
  1. `asset_not_enabled`
  2. destination in `approvedSuppliers`, else `destination_not_allowed`. The XRP `allowlist` doesn't apply to TESTUSD.
  3. `amountTestUsdCents > maxDealCents` gives `amount_over_cap`, with the message "amount exceeds the per-deal cap of $X"
  4. the cancel window
  5. the daily and open-deal caps (Task 5)
  6. destination line: missing, frozen by the issuer, or `limit - balance < amount` gives `destination_not_ready`
  7. treasury (buyer) line balance `< amount` gives `insufficient_funds`
  8. sign
- **Unchanged:** the XRP path and the order of its checks.

- [ ] **Step 1: Write the failing tests**
  - "locks TESTUSD from the treasury with a condition and ledger-time CancelAfter": the submitted EscrowCreate `Amount` deep-equals `testUsdAmount(issuer, "4800000")`, the response has `issuer`, and the fulfillment is never in the response.
  - "refuses TESTUSD when no issuer is configured": `asset_not_enabled`.
  - "refuses a TESTUSD lock to an address on the XRP allowlist but not an approved supplier": `destination_not_allowed`.
  - "refuses a TESTUSD lock over the per-deal cap": `10000001` cents gives `amount_over_cap`, while `10000000` locks.
  - "refuses a destination without a TESTUSD trust line", "refuses a destination whose trust line limit leaves no room" and "refuses a destination whose trust line the issuer froze": all `destination_not_ready`, and `ledger.submitted` is empty.
  - "refuses when the treasury holds less TESTUSD than the amount": `insufficient_funds`.
  - Review Focus 4, "a failed trust-line read refuses with ledger_failure and nothing is signed": set `throwOnNextTrustLine`, expect `ledger_failure` and `ledger.submitted.length === 0`, then a retry with the same opId locks.
  - "refuses a body with both amountDrops and amountTestUsdCents": `bad_request`.

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm vitest run services/signer/test/signer.test.ts -t "TESTUSD"`. Expected: FAIL.

- [ ] **Step 3: Implement the routing in `createEscrow`.** Branch on `assetAmountOf(req)`. Wrap a `trustLine` rejection as `SignerError("ledger_failure", "could not read trust lines; retry with the same opId")`. Convert ledger values with `tokenValueToCents`, and treat `null` as not ready (or as insufficient funds, for the treasury).

- [ ] **Step 4: Run the tests and watch them pass.** Run `pnpm vitest run services/signer`. Expected: PASS, with every XRP test unchanged.

- [ ] **Step 5: Commit.** `git commit -m "feat(signer): lock TESTUSD for approved, ready suppliers within the per-deal cap"`

---

### Task 5: Signer caps: rolling 24-hour total and open-deal limit

**Files:**
- Modify: `services/signer/src/signer.ts`, adding a pure `testUsdExposure(...)` helper (file-local, or `services/signer/src/caps.ts` if it grows past about 30 lines)
- Test: `services/signer/test/signer.test.ts` (`describe("TESTUSD caps")`), `services/signer/test/caps.test.ts` if `caps.ts` is created

**Interfaces:**
- Produces: `testUsdExposure(records: EscrowRecord[], pending: PendingCreate[], closeTime: number): { usedDailyCents: bigint; openDeals: number }`
  - **`usedDailyCents`** sums the TESTUSD cents of every record (locked, finished or cancelled) plus every journal create still `submitted`, where `lockedAtCloseTime > closeTime - 86_400`.
  - **`openDeals`** counts TESTUSD records with status `locked` plus `submitted` TESTUSD creates.
  - **Excluded:** failed journal entries and XRP records.
- **Refusal rule:** refuse `daily_cap_reached` when `usedDailyCents + amount > config.testUsd.dailyCents`, and refuse `open_deal_limit_reached` when `openDeals >= maxOpenDeals`. Both are checked inside `locks.run(buyer)`, after reading `validatedCloseTime()` once, and that same close time is used for CancelAfter.

- [ ] **Step 1: Write the failing tests**
  - "refuses a TESTUSD lock that would take the rolling 24-hour total past the daily cap": with caps `$100k` and `$250k`, `9500000` and `9500000` lock, then `6000001` is refused with `daily_cap_reached` and `6000000` locks.
  - "frees daily capacity once a lock is more than 24 hours old by ledger time, whatever the laptop clock says": advance `ledger.closeTime` by `86_401` and the refused amount locks. Advancing only the laptop clock (`vi.setSystemTime`) does not free it.
  - "counts paid and refunded deals toward the daily cap": finish one and cancel one, and the total is unchanged.
  - "refuses a TESTUSD lock when the open-deal limit is reached, and allows one after a deal is paid or refunded": `maxOpenDeals: 2`.
  - "counts a submitted-but-unvalidated lock toward both caps, and does not count one that failed on the ledger": `holdNextSubmit` for the first, `nextResult = "tecUNFUNDED"` for the second.
  - "XRP locks are unaffected by TESTUSD caps": 6 XRP locks with `maxOpenDeals: 1` all succeed.
  - Review Focus 1, "two concurrent locks that together exceed the daily cap: exactly one succeeds": with the daily cap set to `15_000_000n`, `Promise.allSettled` of two `9000000` locks gives exactly one fulfilled and one `daily_cap_reached`.
  - Review Focus 2, "the daily total and open count survive a signer restart": lock, call `makeSigner()` again on the same `dataDir`, and the next over-cap amount is still refused.

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm vitest run services/signer -t "TESTUSD caps"`. Expected: FAIL.

- [ ] **Step 3: Implement `testUsdExposure` and the two checks.** Read pending creates from `journal.get()` entries with `type === "create" && status === "submitted" && pending`.

- [ ] **Step 4: Run the tests and watch them pass.** Run `pnpm vitest run services/signer`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(signer): rolling 24-hour TESTUSD cap and open-deal limit by ledger time"`

---

### Task 6: Signer finish, cancel, health and boot for TESTUSD

**Files:**
- Modify: `services/signer/src/signer.ts` (`finishEscrow` match, `health`), `services/signer/src/main.ts` (boot check and boot line), `services/signer/package.json` (start script)
- Test: `services/signer/test/signer.test.ts`

**Interfaces:**
- **Finish match for a TESTUSD record.** All of the following must hold:
  - `p.amountTestUsdCents === record.amountTestUsdCents`
  - `p.amountDrops === undefined`
  - `onLedger.Amount` is an `IssuedAmount` with `currency === TESTUSD_CURRENCY_HEX` and `issuer === record.issuer`
  - `tokenValueToCents(onLedger.Amount.value) === record.amountTestUsdCents`

  plus the existing owner, destination, condition and CancelAfter checks. A record without `asset` is XRP and keeps today's match exactly.
- **Health** returns `testUsd` (Task 1 shape) when configured, built from config only, with no ledger read.
- **`main.ts`**, when `config.testUsd` is set:
  - It refuses to start unless `await ledger.issuerAllowsLocking(issuer)`, with the message `"Refusing to start: the TESTUSD issuer does not allow trust-line locking."`
  - The boot line adds `| TESTUSD issuer <addr> | caps $<deal> per deal, $<day> per 24h, <n> open`.
- **Start script:** `"start": "node --env-file=.env --env-file-if-exists=.env.testusd --import tsx src/main.ts"`.

- [ ] **Step 1: Write the failing tests**
  - "pays a TESTUSD escrow with a matching authorization": the EscrowFinish is submitted from `service`, and the record status is `finished`.
  - "rejects an XRP-amount authorization for a TESTUSD escrow": `escrow_mismatch`.
  - Review Focus 3, "rejects when the ledger's issuer, currency or value differs from the record": the three cases mutate `ledger.escrows` and include `value: "48000.001"` and `"4.8e4"`. All give `escrow_mismatch`.
  - "refunds a TESTUSD escrow after ledger time passes CancelAfter".
  - Review Focus 5, "an XRP escrow recorded before this change still finishes and cancels": write an `escrows.json` record without `asset`, `amountTestUsdCents` or `lockedAtCloseTime`, then finish one and cancel another.
  - "health reports the TESTUSD issuer, approved suppliers and limits, and nothing secret": `JSON.stringify(health)` contains no seed or preimage key.

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm vitest run services/signer -t "TESTUSD"`. Expected: FAIL on the new finish and health tests.

- [ ] **Step 3: Implement the match, health, the boot check and the start script.**

- [ ] **Step 4: Run the tests and watch them pass, then check the boundaries.** Run `pnpm vitest run services/signer && pnpm typecheck && pnpm check:boundaries`. Expected: PASS. Typecheck may still fail only in `packages/gate` and `packages/workflow`, which Task 8 fixes.

- [ ] **Step 5: Commit.** `git commit -m "feat(signer): pay and refund TESTUSD escrows; health and boot report TESTUSD limits"`

---

### Task 7: Operator-only policy update: live limits and approved suppliers

Added on 9 Nov. Marko chose instant limit changes over restart-to-apply.

**Files:**
- Create: `services/signer/src/policy.ts`
- Modify:
  - `packages/contracts/src/signer-api.ts`: `UpdatePolicyRequestSchema`, `PolicyView`, and `HealthResponse.testUsd` gains `policyVersion`
  - `packages/contracts/src/index.ts`
  - `services/signer/src/signer.ts`: the create checks and health read the live policy
  - `services/signer/src/http.ts`: a secret per route
  - `services/signer/src/errors.ts`
  - `packages/signer-client/src/index.ts`
- Test:
  - `services/signer/test/policy.test.ts` (new)
  - `services/signer/test/http.test.ts`
  - `services/signer/test/signer.test.ts`
  - `packages/contracts/test/signer-api.test.ts`

**Interfaces:**
- **Contracts:**
  - `UpdatePolicyRequestSchema` is a strict object:
    - `opId` (uuid)
    - `expectedVersion` (integer of at least 1)
    - `perDealCents` (Cents)
    - `dailyCents` (Cents)
    - `maxOpenDeals` (integer, 1 to 50)
    - `approvedSuppliers` (1 to 50 unique `Address` values)
  - `PolicyView = { version: number; perDealCents: string; dailyCents: string; maxOpenDeals: number; approvedSuppliers: string[]; updatedAt: string }`
- **`policy.ts`:**
  - `createPolicyStore(dataDir: string, initial: Omit<PolicyView, "version" | "updatedAt">): { current(): PolicyView; update(req: UpdatePolicyRequest, guard: PolicyGuard): PolicyView }`
  - It persists `policy.json`, the current view.
  - It appends to `policy-history.json`, an array of `{ opId, requestHash, view }`.
  - The first boot writes version 1 from config. A later boot reads the file, so env defaults never overwrite an operator change.
- **`PolicyGuard`** is `{ forbidden: string[] }`, holding the treasury, service and issuer addresses.
- **Update rules, in order:**
  1. A replay of an opId already in the history returns its stored view if the request hash matches, else `op_conflict`.
  2. `expectedVersion !== current.version` gives the new code `policy_conflict` (409).
  3. A supplier in `forbidden` gives `bad_request`.
  4. `perDealCents > dailyCents` gives `bad_request` ("the per-deal cap cannot exceed the 24-hour cap").
  5. Otherwise the version goes up by 1 and the update is written.
- **Signer:**
  - Exposes `updatePolicy(req: unknown): Promise<PolicyView>`. It runs inside `locks.run(buyer.classicAddress)`, the same lock as TESTUSD creates, so a lock sees exactly one policy.
  - The TESTUSD create checks read `policy.current()` for `approvedSuppliers`, `perDealCents`, `dailyCents` and `maxOpenDeals`, instead of `config.testUsd`.
  - Finish and cancel never consult the policy.
  - `health().testUsd` reports the live policy and `policyVersion`.
  - If `config.testUsd` is null, `updatePolicy` refuses with `asset_not_enabled`.
- **HTTP:**
  - The route table maps each route to the secret that authenticates it: `POST /operator/policy` uses `config.testUsd.operatorSecret`, and every other route uses `hmacSecret`.
  - With TESTUSD off, the policy route doesn't exist (404 after the auth check).
- **Client:** `createOperatorClient({ url, operatorSecret }): { updatePolicy(req: UpdatePolicyRequest): Promise<PolicyView> }`. `createSignerClient` gains nothing.

- [ ] **Step 1: Write the failing tests**
  - `policy.test.ts`:
    - "first boot writes version 1 from config, and a later boot keeps the operator's change over new config defaults"
    - "an update with the current expectedVersion bumps the version and appends history"
    - "a stale expectedVersion is refused with policy_conflict"
    - "replaying the same opId and body returns the stored view; the same opId with a different body is op_conflict"
    - "refuses the treasury, service or issuer as an approved supplier"
    - "refuses a per-deal cap above the 24-hour cap"
  - `signer.test.ts`, `describe("operator policy")`:
    - "lowering the per-deal cap applies to the next lock": lock `200000`, update `perDealCents` to `100000`, and `200000` is now `amount_over_cap`
    - "removing a supplier blocks new locks to it but its locked deal still pays"
    - "raising the daily cap frees capacity immediately"
    - "health reports the live policy and its version"
    - Review Focus 6, "a policy update racing a lock: the lock is judged by one policy only": `Promise.allSettled` of a lock at the old cap and an update that lowers it. Either the lock succeeds and the update lands after it, or the lock is refused under the new cap. It is never accepted under a mix.
  - `http.test.ts`:
    - Review Focus 6, "a policy update signed with SIGNER_HMAC_SECRET gets 401"
    - "a create signed with OPERATOR_HMAC_SECRET gets 401"
    - "a policy update signed with OPERATOR_HMAC_SECRET reaches the signer"
  - `signer-api.test.ts`: `UpdatePolicyRequestSchema` rejects duplicate suppliers, `maxOpenDeals: 0`, 51 suppliers, and extra keys.

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm vitest run services/signer packages/contracts`. Expected: FAIL, because `policy.ts`, the route and the schema don't exist.

- [ ] **Step 3: Implement the policy store, the schema, the route secret table, `updatePolicy`, the switch of the create checks to the live policy, `policy_conflict: 409`, and `createOperatorClient`.**

- [ ] **Step 4: Run the tests and watch them pass.** Run `pnpm vitest run services/signer packages/contracts packages/signer-client && pnpm check:boundaries`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(signer): operator-only policy update with its own secret; limits apply to the next lock"`

---

### Task 8: Gate and workflow carry AssetAmount

**Files:**
- Modify:
  - `packages/gate/src/authorize.ts` (`MintInput.amount: AssetAmount` replaces `amountDrops`)
  - `packages/workflow/src/repo.ts` (`Job.amount`, `NewJob.amount`, `EscrowRow.amount` and `EscrowRow.issuer: string | null` replace `amountDrops`; `assertAmount(a: AssetAmount)` replaces `assertDrops`)
  - `packages/workflow/src/snapshot.ts`, `fund.ts`, `settle.ts`, `memory-repo.ts`, `index.ts`
  - `scripts/outcomes-demo.ts`, `scripts/restart-refund-demo.ts` (mechanical: `amount: { asset: "XRP", drops: "1000000" }`). `scripts/spike-escrow.ts` needs no change, because `amountDrops` stays valid on the wire.
- Test:
  - `packages/gate/test/authorize.test.ts`
  - `packages/workflow/test/repo-contract.ts`, `fund.test.ts`, `settle.test.ts`, `engine-loop.test.ts`, `fake-signer.ts` (mechanical amount shape, plus the new cases below)

**Interfaces:**
- Consumes: Task 1's `AssetAmount`, `wireAmount` and `isCents`.
- **Snapshot hash:** `snapshotHash` spreads `wireAmount(input.amount)` where it used `amountDrops`, so XRP jobs hash exactly as before.
- **`fundJob`** sends `...wireAmount(job.amount)` and stores `issuer: res.issuer ?? null`.
- **`CONCLUSIVE`** gains `daily_cap_reached`, `open_deal_limit_reached`, `destination_not_ready`, `insufficient_funds` and `asset_not_enabled`.
- **`mintAndRecord`** passes `amount: escrow.amount`.
- **`assertAmount`** messages keep the words `amountDrops` and `amountTestUsdCents`, so existing `/amountDrops/` assertions still match.

- [ ] **Step 1: Write the failing tests**
  - `authorize.test.ts`: "mints a TESTUSD authorization with amountTestUsdCents and no amountDrops key": check `Object.keys(payload)` and that `verifyAuthorization` gives ok.
  - `repo-contract.ts`:
    - "an XRP job's snapshot hash is unchanged by the asset refactor": compare with `sha256Hex(canonicalJson({ …old fields, amountDrops }))` for the same input.
    - "creates and reads back a TESTUSD job and escrow with its issuer".
    - `it.each(["1.5", "1e6", "0123"])` "refuses the cent string %s before writing anything".
  - `fund.test.ts`:
    - "locks a TESTUSD job and records the issuer".
    - `it.each` over the five new codes "records %s as CREATE_FAILED".
  - `settle.test.ts`: "a TESTUSD job's authorization binds amountTestUsdCents".

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm vitest run packages/gate packages/workflow`. Expected: FAIL.

- [ ] **Step 3: Implement the type change across the listed files and update the mechanical call sites.**

- [ ] **Step 4: Run the tests and watch them pass.** Run `pnpm test && pnpm typecheck`. Expected: PASS, 397 or more unit tests, with no type errors.

- [ ] **Step 5: Commit.** `git commit -m "feat(workflow): jobs, escrows and authorizations carry XRP or TESTUSD amounts"`

---

### Task 9: Database: asset columns and pg repo

**Files:**
- Create: `supabase/migrations/20261110000000_testusd.sql`
- Modify: `packages/workflow/src/pg-repo.ts` (`toJob` and `toEscrow` map `asset`, `amount_drops`, `amount_testusd_cents` and `issuer`; the insert statements write them)
- Test: `tests/db/schema.db.test.ts`. `tests/db/pg-repo.db.test.ts` runs Task 8's contract cases unchanged.

**Interfaces:**
- **Migration for `jobs`:**
  - add `asset text not null default 'XRP' check (asset in ('XRP','TESTUSD'))`
  - add `amount_testusd_cents numeric(20,0) check (amount_testusd_cents > 0)`
  - alter `amount_drops drop not null`
  - add `constraint jobs_one_amount check ((asset = 'XRP' and amount_drops is not null and amount_testusd_cents is null) or (asset = 'TESTUSD' and amount_testusd_cents is not null and amount_drops is null))`
- **Migration for `escrows`:** the same columns and the same constraint (named `escrows_one_amount`), plus `issuer text` with `check ((asset = 'TESTUSD') = (issuer is not null))`.
- **Existing rows:** they backfill to `'XRP'` through the default.

- [ ] **Step 1: Write the failing tests.** In `schema.db.test.ts`: "refuses a job whose asset and amount columns disagree", with the four mismatching combinations each raising a check violation, and "refuses a TESTUSD escrow without an issuer".

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm db:start && pnpm db:reset && pnpm test:db`. Expected: FAIL on the new tests and on the TESTUSD contract cases.

- [ ] **Step 3: Write the migration and the pg-repo mapping.**

- [ ] **Step 4: Run the tests and watch them pass.** Run `pnpm db:reset && pnpm test:db && pnpm test`. Expected: PASS, 48 or more DB tests and every unit test.

- [ ] **Step 5: Commit.** `git commit -m "feat(db): asset column with one amount per job and escrow"`

---

### Task 10: One-time TESTUSD setup script

**Files:**
- Create: `services/signer/scripts/setup-testusd.ts`, `services/signer/scripts/testusd-env.ts`
- Modify: `services/signer/package.json` (add `"setup-testusd": "node --env-file=.env --import tsx scripts/setup-testusd.ts"`)
- Test: `services/signer/test/testusd-env.test.ts`

**Interfaces:**
- Produces, in `testusd-env.ts`:
  - `renderTestUsdEnv(p: { issuer: string; approvedSuppliers: string[]; operatorSecret: string }): string`. It writes:
    - `TESTUSD_ISSUER` and `APPROVED_SUPPLIERS`
    - the three cap variables at the build-time defaults, with a "# initial policy; change it live through the operator policy update" comment
    - `OPERATOR_HMAC_SECRET`

    It contains no seed.
  - `renderOperatorEnv(operatorSecret: string): string`. It writes the root `.env.operator`, holding `OPERATOR_HMAC_SECRET` only, for operator tools such as the evidence script and, later, the Control room API. The worker never loads it.
  - `renderIssuerEnv(seed: string): string`. It writes `TESTUSD_ISSUER_SEED=<seed>` with a "never commit" header.
- **What the script does, in order:**
  1. Refuse if `services/signer/.env.testusd`, `services/signer/.env.issuer` or the root `.env.operator` exists. Generate the operator secret with `randomBytes(32).toString("hex")`.
  2. Check the network ID.
  3. Read `BUYER_SEED` from the environment (as the signer does) and never print it.
  4. Fund the issuer from the faucet.
  5. Set `asfDefaultRipple`, then `asfAllowTrustLineLocking`.
  6. TrustSet the treasury with limit `"1000000000"`.
  7. Issuer Payment of `10000000` TESTUSD to the treasury.
  8. Fund 3 demo suppliers from the faucet and TrustSet each with limit `"1000000000"`, then discard their seeds.
  9. Fund 1 approved supplier with no trust line, then discard its seed. It is the "not opted in yet" case.
  10. Write `.env.issuer`, `.env.testusd` and the root `.env.operator`, each with mode `0o600`.
  11. Print addresses, transaction results and the explorer link for each.
- **Where the issuer seed lives:** `.env.issuer` is read only by this script and by future top-ups. The signer process never loads it. Both files are already gitignored by `.env.*`.

- [ ] **Step 1: Write the failing tests.** In `testusd-env.test.ts`:
  - "renders the TESTUSD settings with no seed": the output matches `TESTUSD_ISSUER=r…` and `APPROVED_SUPPLIERS=a,b,c,d`, and doesn't match `/SEED|^s[1-9A-HJ-NP-Za-km-z]{20,}/m`.
  - "renders the issuer seed file with its warning header".

- [ ] **Step 2: Run the tests and watch them fail.** Run `pnpm vitest run services/signer/test/testusd-env.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the renderers and the script.** Reuse the `submit` and `must` pattern from `spike-token-escrow.ts`.

- [ ] **Step 4: Run the tests, then run the setup on testnet.** Run `pnpm vitest run services/signer && pnpm check:boundaries`, then `pnpm --filter @surety/signer setup-testusd`. Expected: tests PASS. The setup prints `tesSUCCESS` for every setup transaction and the treasury holds `10000000` TESTUSD. Then `pnpm signer` boots with the TESTUSD issuer and caps in its boot line, which confirms the `--env-file-if-exists` start script.

- [ ] **Step 5: Commit.** Do not add any `.env*` file. `git commit -m "feat(signer): one-time TESTUSD issuer, treasury and demo supplier setup"`

---

### Task 11: Testnet evidence through the signer

**Files:**
- Create: `scripts/spike-testusd-signer.ts`
- Modify: `package.json` (add `"spike:testusd": "tsx --env-file=.env scripts/spike-testusd-signer.ts"`), `README.md` (evidence table row), `docs/log.md` (decisions and spend)

**Interfaces:**
- Consumes: the signer client, gate `mintAuthorization` with `amount`, `/health`'s `testUsd` (issuer, approved suppliers, limits), and a read-only xrpl `Client` for balances and for finding the approved supplier without a trust line.
- **Holds no keys.** It plays the gate with `GATE_AUTH_SECRET`, like `spike-escrow.ts`.
- **Also holds `OPERATOR_HMAC_SECRET`** from the root `.env.operator`, playing the operator. The script reads the current policy version from `/health` before each update.
- **Sequence, against the build-time policy ($2,500 per deal, $25,000 per 24 hours, 5 open):**
  1. A: lock `100000` cents ($1,000), then pay. Record the supplier's TESTUSD balance before and after.
  2. Refusals, each recorded with its code:
     - `300000` to an approved, ready supplier gives `amount_over_cap`
     - the service address gives `destination_not_allowed`
     - the approved supplier without a trust line gives `destination_not_ready`
  3. Credential crossover: a policy update signed with `SIGNER_HMAC_SECRET` gives `401`.
  4. Operator lowers the 24-hour cap to `300000` ($3,000). Lock B `150000` with 60 s. C `100000` then gives `daily_cap_reached`, because 1,000 + 1,500 + 1,000 is more than 3,000.
  5. Operator lowers the per-deal cap to `50000`. D `60000` gives `amount_over_cap`, which proves the change applied to the next lock.
  6. Operator restores the build-time policy. Lock E, F, G and H at `100` cents with 60 s each. With B still open, I at `100` gives `open_deal_limit_reached`.
  7. Wait past the deadlines by ledger time, then cancel B, E, F, G and H. The treasury ends at start minus `100000`.
  8. Record every policy version and change in the evidence.
- **Cap use:** this run uses $2,504 of the $25,000 rolling cap.
- **Output:** writes `evidence/testusd-signer-<UTC>.json` with tx hashes, ledger indexes, explorer links, balances and the refusal list. No seed appears anywhere.

- [ ] **Step 1: Write the script.** It is a scripted check, not a unit test. Assertions are `must(result, expected)` throws, as in `spike-token-escrow.ts`.

- [ ] **Step 2: Run the script against the live signer.** With `pnpm signer` running from Task 10, run `pnpm spike:testusd`. Expected: every step matches its expected code, A pays exactly `1000` TESTUSD, the five refunds return in full, the policy ends at the build-time values, and evidence is written.

- [ ] **Step 3: Run the checks, then commit.** Run `pnpm check:boundaries && pnpm test`, then `git commit -m "feat: testnet evidence for TESTUSD locks, payouts, refunds and every cap refusal"`
