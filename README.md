# Surety

**The trust layer for the agent economy.** One AI agent hires another. Payment is locked in native XRP Ledger escrow and released only when the delivered work passes checks the agents cannot override. If the work fails, or the evaluator is down, the buyer gets a refund once the escrow expires.

> **TESTNET ONLY.** Surety runs on XRPL Testnet with valueless test XRP and synthetic data. It is a hackathon prototype for W3NODE 2026 (Agentic Finance track), not a financial product.

## Proven so far on XRPL Testnet

Through the isolated signer only (8 Nov 2026, evidence in [`evidence/`](evidence/)):

| Step | Result | Transaction |
|---|---|---|
| Job A: lock 1 XRP in conditional escrow | validated `tesSUCCESS` | [7A215DBF…](https://testnet.xrpl.org/transactions/7A215DBF3BBEE97D342EE4CC9257FC8BF6B48B669725696D06FBCBF9FA7A505E) |
| Job A: pay the seller with a one-use authorization | validated `tesSUCCESS`, seller 100 → 101 XRP | [30A62137…](https://testnet.xrpl.org/transactions/30A62137966801B2A46F6200AA375F6AF19CB4EA33F515F2143FA27D458E73CB) |
| Job B: refund the buyer after expiry | validated `tesSUCCESS` | [5EB074D7…](https://testnet.xrpl.org/transactions/5EB074D7126A1B1024DDD13E869A9A13BE7C5087DB758149B874CD3F5E007E61) |

Refused by the signer, as designed: reusing a spent authorization, an escrow above the 2 XRP per-job cap, an escrow to a wallet not on the allowlist, and a refund before ledger time passed expiry.

## How it works

See [`docs/architecture.md`](docs/architecture.md) for the diagram and trust boundaries. In short:

- Keys exist only in `services/signer`, a separate process that accepts three operations and nothing else.
- Each escrow is locked with a crypto-condition whose secret only the signer holds.
- Payment needs a short-lived, one-use authorization bound to the exact escrow, job, deliverable and policy.
- Refunds happen by ledger time, not laptop time.

## Run it

Requires Node 24 and pnpm 10.

```bash
pnpm install
pnpm test                 # 99 tests
pnpm typecheck
pnpm check:boundaries     # lint: flags key-handling code outside the signer

pnpm --filter @surety/signer init-wallets   # funds 3 testnet wallets from the official faucet, writes .env files
pnpm signer                                 # terminal 1: the isolated signer on 127.0.0.1:4100
pnpm spike                                  # terminal 2: lock, pay, lock, refund; writes evidence/
```

## Status

1. Isolated signer and testnet escrow: **done**
2. Durable expiry worker that survives restarts
3. Deterministic checks and the Jev evaluator
4. Buyer and seller agents, operator spending limits
5. Live pipeline view and ledger-linked receipts

Plan: [`docs/step1-plan-review.md`](docs/step1-plan-review.md). Disclosures: [`PRIOR_WORK.md`](PRIOR_WORK.md).
