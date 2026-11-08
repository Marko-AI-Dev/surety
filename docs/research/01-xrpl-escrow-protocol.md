# 01 XRPL escrow protocol check (2026-11-08)

**[V]** verified today (source, docs, live RPC); **[I]** inferred. Testnet runs xrpld 3.4.1. Sources: `XRPLF/rippled` develop, `xrpl.js` tag `xrpl@5.3.0`.

## 1. xrpl.js
- Latest **5.3.0** (2026-09-16). `engines.node >=20.19.0`, so Node 24 is fine. [V `npm view xrpl`]
- CommonJS only: no `type`, no `exports`, `main: dist/npm/`, types `dist/npm/index.d.ts`. [V] Official sample uses `import xrpl from 'xrpl'`; named ESM imports should work via Node CJS interop. [I]
- Types (`src/models/transactions/escrow*.ts`) [V]:
  - `EscrowCreate { Amount: Amount | MPTAmount; Destination; CancelAfter?: number; FinishAfter?: number; Condition?: string; DestinationTag?: number }`
  - `EscrowFinish { Owner; OfferSequence: number | string; Condition?; Fulfillment?; CredentialIDs?: string[] }`
  - `EscrowCancel { Owner; OfferSequence: number | string }`. `OfferSequence` is still the reference field.
- Time helpers, root export (`import { isoTimeToRippleTime } from 'xrpl'`, source `src/utils/timeConversion.ts`): `rippleTimeToUnixTime(sec) → ms`, `unixTimeToRippleTime(ms) → sec`, `rippleTimeToISOTime`, `isoTimeToRippleTime(string | Date)`. Offset 946684800. `unixTimeToRippleTime` takes **milliseconds**. [V]

## 2. EscrowFinish fee
- `autofill` handles it: `src/sugar/autofill.ts` `calculateFeePerTransactionType` uses `netFee × (33 + fulfillmentBytes/16)` (netFee includes load factor), rounded up, capped at `client.maxFeeXRP`. [V]
- rippled `EscrowFinish::calculateBaseFee`: `base + base × (32 + floor(size/16))`. xrpl.org escrow concept: `reference_fee * (signer_count + 33 + (fulfillment_bytes / 16))`. [V]
- 32-byte preimage (36-byte fulfillment): rippled minimum **350 drops**; autofill gives **353** (no floor, safe overpay). [V arithmetic on source]

## 3. Crypto-conditions
- xrpl.org JS sample (`_code-samples/escrow/js/send-conditional-escrow.js`) still uses **five-bells-condition** (`"*"`). [V]
- five-bells-condition 5.0.1, last published **2017-02-17**; repo last push 2022; CJS only; no TS types; optional native `ed25519@0.0.4`. [V] That dep likely fails to build on Node 24 (non-fatal). [I] Hand-roll instead.
- Layout for 32-byte preimage P [V rippled `include/xrpl/conditions/detail/PreimageSha256.h`: cost = preimage length, max preimage 128 B; draft-thomas-crypto-conditions-02 §8.1, linked from xrpl.org EscrowCreate]:
  - Fulfillment (36 B): `A0 22 80 20 || P`
  - Condition (39 B): `A0 25 80 20 || SHA256(P) || 81 01 20` (cost 32)
- Vectors from rippled `src/test/conditions/PreimageSha256_test.cpp` [V]; my node:crypto encoder reproduced both:
  - empty: F `A0028000`, C `A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100`
  - "aaa": F `A0058003616161`, C `A02580209834876DCFB05CB167A5C24953EBA58C4AC89B1ADF57F28F2F9D09AF107EE8F0810103`
  - 32 zero bytes (computed): C `A025802066687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925810120`

```ts
import { createHash, randomBytes } from 'node:crypto'
const p = randomBytes(32)
const fulfillment = Buffer.concat([Buffer.from('A0228020', 'hex'), p]).toString('hex').toUpperCase()
const condition = Buffer.concat([Buffer.from('A0258020', 'hex'), createHash('sha256').update(p).digest(), Buffer.from('810120', 'hex')]).toString('hex').toUpperCase()
```

## 4. Escrow rules
- No CancelAfter and no FinishAfter: `temBAD_EXPIRATION`. No FinishAfter, Condition or Bytecode: `temMALFORMED`. So Condition + CancelAfter without FinishAfter is valid, and CancelAfter is **mandatory** there. Create also fails `tecNO_PERMISSION` if CancelAfter already passed. [V `EscrowCreate.cpp`; xrpl.org EscrowCreate table]
- Finish after expiry: no. `tecNO_PERMISSION` once parent ledger close time > CancelAfter; Cancel needs close time > CancelAfter. Uses `parentCloseTime`. [V `EscrowFinish.cpp`, `EscrowCancel.cpp`]
- "Any account may submit" Finish and Cancel. [V xrpl.org] Exception: if Destination has DepositAuth, the finisher must be the destination, preauthorized, or present CredentialIDs. [V depositauth.md] Finish must carry both Condition and Fulfillment, matching the stored Condition. [V]
- Reserves (testnet server_info, ledger 22165840): `reserve_base_xrp 1`, `reserve_inc_xrp 0.2`, base fee 10 drops; mainnet identical. Each escrow costs **0.2 XRP** owner reserve on the creator until finished or cancelled. [V]
- Recent escrow amendments (TokenEscrow, Credentials, PermissionDelegationV1_1, fixCleanup3_4_0) do not change XRP conditional semantics. [V]

## 5. Amendments
Testnet: live `feature`. Mainnet: read-only `feature` on xrplcluster.com (3.4.1), because xrpl.org known-amendments is a stale 2026-09-16 snapshot. [V]

| Amendment | Testnet | Mainnet |
|---|---|---|
| TokenEscrow, fixTokenEscrowV1 | on | on |
| MPTokensV1, Credentials, PermissionedDomains | on | on |
| PermissionDelegationV1_1 (original removed in 2.6.1) | on | on |
| BatchV1_1 + fixBatchV1_2 (original removed in 3.1.1) | on | on (2026-10-09) |
| DID, PriceOracle, DynamicNFT, fixCleanup3_4_0 | on | on |
| SmartEscrow | absent | absent |
| Sponsor, ConfidentialTransfer, DynamicMPT, LendingProtocol, SingleAssetVault | off | off |

Escrow and CryptoConditions show `enabled:false` on testnet only because they are retired, hard-coded active (`features.macro`). [V]

Delegation: yes. `DelegateSet` can grant only `"EscrowCreate"` (value 2) without Payment (xrpl.org permission-values; `transactions.macro`). The delegate is a funded **account**. [V] **Caveat:** EscrowCreate has no granular limits, so a delegate can create a FinishAfter-only escrow to any Destination and finish it seconds later. It blocks Payment, not value transfer. [I]

## 6. RLUSD
`account_info` validated ledger **22165841**: Flags `0x819A0000` = AllowTrustLineClawback, DepositAuth, DefaultRipple, DisableMaster, DisallowXRP, RequireDestTag. **lsfAllowTrustLineLocking (0x40000000) not set.** [V] Unchanged since 2026-10-10.

## 7. Smart Escrows (XLS-100)
- rippled develop: `SmartEscrow` is `Supported::No`; bytecode escrows return `tecFAILED_PROCESSING` ("no WASM engine"). Absent on testnet and mainnet. [V]
- Live on WASM Devnet only: `wss://wasm-devnet.dev.ripplex.io:51233`, faucet `wasm-devnet-faucet.dev.ripplex.io`; build 3.5.0-b0, network_id 5001, SmartEscrow enabled. [V]
- Tooling: Rust crates `xrpl-common-stdlib` + `xrpl-escrow-stdlib` (`wasm32v1-none`); xrpl.js `smart-escrow-experimental` = 5.4.0-smartescrow.0. Its faucet map targets network 2002 / `wasmfaucet.devnet.rippletest.net`, which does not resolve; pass `faucetHost`. [V]
- Verdict: a tiny Rust check (for example "evaluator Credential exists") is doable in a day for a Rust-fluent dev, but the model cannot run on-ledger and devnets reset without warning. Stretch only. [I]

## 8. Testnet ops
- WS `wss://s.altnet.rippletest.net:51233/`, RPC `https://s.altnet.rippletest.net:51234/`. [V]
- `client.fundWallet(wallet?, { amount?, faucetHost? })` maps network_id 1 to `faucet.altnet.rippletest.net/accounts`. [V] xrpl.js comment says default 1000 XRP; xrpl.org UI requests 10 (max 10000). [V] Real payout and rate limits undocumented. [I]
- No 2026 testnet reset announced (xrpl.org blog checked); last was Aug 2024. [V]

## Conflicts with spec
None of the five claims is contradicted. Refinements:
- Ripple epoch: `unixTimeToRippleTime` takes ms.
- 330-drop base: exact is `ref × (33 + floor(fulfillment_bytes/16))`, 350 drops here.
- Escrow identity: Ticket-created escrows use TicketSequence (spec line 36 says "Sequence").
- Anyone can finish: unless Destination has DepositAuth.
- RLUSD locking still off; an EscrowCreate-only delegate is not a spending cap.

## XRPL features worth considering for an agent-escrow product
1. DepositAuth + DepositPreauth on the seller: only seller or signer can finish.
2. Permission Delegation: buyer agents create escrows without the buyer's master key (not a cap).
3. Tickets: parallel EscrowCreates without Sequence contention.
4. TokenEscrow: RLUSD-priced jobs once the issuer enables locking.
5. Credentials: on-ledger evaluator attestations a future Smart Escrow can require.
