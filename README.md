# Surety

**The trust layer for the agent economy.** One AI agent hires another. Payment is locked in native XRP Ledger escrow and released only when the delivered work passes checks the agents cannot override. If the work fails, or the evaluator is down, the buyer gets a refund once the escrow expires.

> **TESTNET ONLY.** Surety runs on XRPL Testnet with valueless test XRP and synthetic data. It is a hackathon prototype for W3NODE 2026 (Agentic Finance track), not a financial product.

## Status

Work in progress. Building in this order:

1. Isolated signer and testnet escrow (lock, pay, refund after expiry)
2. Durable expiry worker that survives restarts
3. Deterministic checks and the Jev evaluator
4. Buyer and seller agents, operator spending limits
5. Live pipeline view and ledger-linked receipts

See `docs/step1-plan-review.md` for the plan and `PRIOR_WORK.md` for disclosures.
