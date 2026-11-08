# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React and TypeScript web console (`apps/web`, not yet created) on the existing pnpm workspace: Node packages for the signer, gate and workflow, Supabase Postgres, xrpl.js. Taken from the project's build spec.

## Users

Primary: the treasury or operations lead at a company whose AI agents buy and sell work. They set the spending limits the agents cannot change, watch money in flight, and must be able to audit and prove every payout and refund.

Secondary: the business owner, who wants a simple view of what was hired, where the money is, and the receipts.

Evaluators: W3NODE judges for Ripple's Agentic Finance track, and real companies in agent payments assessing adoption. Both must see a real use case that is production-grade and auditable.

## Product Purpose

Surety is the referee between AI agents. One agent hires another; the payment waits in native XRP Ledger escrow and is released only when the delivered work passes deterministic rules and an independent AI evaluator (Jev). Otherwise the buyer is refunded when the escrow expires. Success: every job ends paid or refunded with ledger proof, and nothing pays without a validated ledger result.

## Positioning

"The ledger is the vault. Surety is the referee." Native XRPL conditional escrow with no smart contract. Rules come first and are final; Jev can never override a failed rule. It fails closed: an unavailable evaluator means no payment and a refund at expiry. Spending limits are set by a human operator and enforced in an isolated signer the agents cannot reach. Every step is bound to ledger transactions. Nearest existing concept: t54's Agentic Risk Standard, which targets EVM chains and USDC.

## Operating Context

A job passes through stations: operator limits, escrow lock (EscrowCreate), delivery (hashed and frozen), rules (six deterministic checks), Jev (satisfaction and injection risk), signer (one-use authorization), settlement (EscrowFinish or EscrowCancel). Job states are guarded and every change is written to an append-only event log. XRPL Testnet only; validated ledger time decides expiry. Demonstrated in a 5-minute pitch with 3 minutes of Q&A at W3NODE (Cape Town, Nov 2026) and a 3-minute video, on a desktop or projector.

## Capabilities and Constraints

Built and proven on XRPL Testnet: the isolated signer (three operations only), escrow lock, pay and refund, a restart-safe expiry worker, and the rules plus Jev gate under a versioned policy (policy-v2). Four outcomes ran live: paid, rejected by rules, blocked by Jev for injection, evaluator offline.

Planned: buyer and seller agents (Claude Haiku 5.5), operator limits stored in the database behind an operator-only control, a daily cap, an API, and the web console.

Constraints: testnet only with valueless test XRP; any fiat value must be labelled simulated; keys never leave the signer; the seller allowlist is a demo allowlist, not KYC.

## Brand Commitments

Name: Surety (working name). Team: "Surety - Marko Solo". Pitch line: "The ledger is the vault. Surety is the referee."

Binding constraints Marko volunteered:
- dark glass, elegant, minimal, high-status
- auditable: live states, stats and logs over animated workflow metaphors
- spatial, VR-style navigation: sections sit side by side like headset panels; the panel that moved aside stays visible and clickable to bring back to focus; going deeper into an item moves in depth
- containers hold everything they show, with no scrolling inside panels
- smooth, purposeful motion

Rejected so far: the v1 and v2 playgrounds (a linear pipeline, and a railway signal-box metaphor that read as synthetic).

## Evidence on Hand

Real testnet transactions in `evidence/*.json` (spike, restart drill, four outcomes). Jev calibration in `docs/research/05-jev-calibration.md` and `evidence/jev-calibration-*.json`. Live Jev smoke test in `docs/research/03-jev-typesafe-openrouter.md`.

Absent, never to be fabricated: customers, pricing, real volumes, testimonials, real-money usage.

## Product Principles

1. Proof over promise: every state shown is backed by a ledger transaction or a recorded decision.
2. Fail closed, visibly: refusals and refunds are as legible as payments.
3. Limits belong to people: the operator sets them; agents can only read them.
4. Calm under scrutiny: an auditor or judge can trace any job station by station without asking.

## Accessibility & Inclusion

WCAG 2.1 AA contrast, full keyboard operation, and a non-3D fallback when reduced motion is requested.
