# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React and TypeScript web app (`apps/web`, not yet created) on the existing pnpm workspace: Node packages for the signer, gate and workflow, Supabase Postgres, xrpl.js. Taken from the project's build spec.

## Users

**Primary:** the treasury or operations lead at an importing business, for example a South African company buying solar panels from a supplier in China. They:
- create deals
- set the spending limits and approved suppliers that the deal agent can't change
- watch each deal's documents get checked
- must be able to prove every payout and refund

**Secondary:** the overseas supplier. It gets one page where it submits its commercial invoice and bill of lading, then sees the payment arrive.

**Evaluators:**
- W3NODE judges for Ripple's Agentic Finance track
- real companies in trade or payments assessing adoption

Both groups must see a real use case they can test themselves, including trying to break it.

## Product Purpose

Surety is escrow for import purchases.
- The importer's payment is locked on the XRP Ledger in a test dollar (TESTUSD).
- It is released to the supplier only when the shipping documents match the purchase order and the accepted quote. The check is called **Surety Verify**: deterministic rules first, then a decision model that returns scores, not text. The decision model is TypeSafe's Jev under the hood. It is never named in the app, and it is credited in the README.
- Otherwise the importer is refunded at the deadline.
- A person sets the intent and the budget. The deal agent decides whether to accept the supplier's quote and has the payment locked, within limits set by a person.

Success means every deal ends paid or refunded with ledger proof, and nothing pays without a validated ledger result.

## Positioning

"The ledger is the vault. Surety is the referee."
- **The incumbent** is the bank letter of credit, which is slow, heavy on paperwork and out of reach for many small importers.
- **Native XRPL token escrow, with no smart contract.**
- **Rules come first and are final:** the decision model can never override a failed rule. Never call the decision model deterministic: identical input scored 0.72 to 0.76 across 5 runs.
- **It fails closed:** if the evaluator is unavailable, nothing pays and the importer is refunded at the deadline.
- **Limits are set by a person** and enforced in an isolated signer that the agents can't reach.
- **The nearest agent-payments concept** is t54's Agentic Risk Standard, which targets EVM chains and USDC.

## Operating Context

**A deal follows the five-step loop:**
1. **Intent:** the business user states goods, quantity, maximum price, supplier and deadline.
2. **Policy:** per-deal cap, daily cap, open-deal limit, approved supplier, and whether the supplier can hold TESTUSD.
3. **Quote:** the supplier's price, terms and wallet. The deal agent accepts or declines it, and on accept the signer locks the TESTUSD (EscrowCreate).
4. **Settlement:** the documents are hashed and frozen. Surety Verify runs (rules, then the decision model). Then EscrowFinish with a one-use authorization, or EscrowCancel after the deadline.
5. **Audit:** the receipt, every station's record, the ledger links and the failure path.

**Records:** deal states are guarded, and every change is written to an append-only event log. Validated ledger time decides the deadline.

**Network:** XRPL Testnet only.

**Demo:** demonstrated in a 5-minute pitch with 3 minutes of Q&A at W3NODE (Cape Town, Nov 2026) and in a 3-minute video, on a desktop or projector. There are three side-by-side panels: Deals (Use), Control room (Control) and Attack lab (Attack). There is also a supplier page, and later a public QR attack page where the audience tries to break a live deal from their phones.

## Capabilities and Constraints

**Built and proven on XRPL Testnet:**
- the isolated signer, which has three operations only
- escrow lock, pay and refund in XRP
- a restart-safe expiry worker
- the rules plus Jev gate under a versioned policy (policy-v2)
- four outcomes run live: paid, rejected by rules, blocked by Jev for injection, evaluator offline
- TESTUSD token escrow (a trial on 9 Nov): exact payout, full refund, and the ledger refusing a wrong key, an early refund and a late release

**Planned:**
- TESTUSD in the signer
- trade-document rules (purchase order against invoice and bill of lading)
- a deal agent and a verification agent (Claude Haiku 5.5 via OpenRouter)
- operator limits and approved suppliers in the database, plus a daily cap
- an API
- the web app: business view, supplier page, Control room

**Constraints:**
- Testnet only. TESTUSD is a self-issued test dollar with no value.
- Any rand value must be labelled simulated.
- Keys never leave the signer.
- The approved-supplier list is a demo list, not KYC or KYB.

## Brand Commitments

**Names:**
- Name: Surety
- Team: "Surety - Marko Solo"
- Pitch line: "The ledger is the vault. Surety is the referee."
- User-facing word: "Deal", never "Job" or "Lot"

**Binding constraints Marko volunteered:**
- dark glass, elegant, minimal, high-status
- auditable: live states, stats and logs over animated workflow metaphors
- spatial, VR-style navigation: sections sit side by side like headset panels. The panel that moved aside stays visible and can be clicked to bring it back into focus. Going deeper into an item moves in depth.
- containers hold everything they show, with no scrolling inside panels
- smooth, purposeful motion

**Drafts so far:**
- Rejected: the v1 and v2 playgrounds (a linear pipeline, and a railway signal-box metaphor that read as synthetic).
- Leaning: the Spatial Desk draft from the console drafts. It isn't locked yet.

## Evidence on Hand

**Real testnet transactions in `evidence/*.json`:**
- the spike
- the restart drill
- the four outcomes
- the TESTUSD token escrow trial

**Jev:** calibration in `docs/research/05-jev-calibration.md` and `evidence/jev-calibration-*.json`.

**Absent, and never to be fabricated:**
- customers
- pricing
- real volumes
- testimonials
- real-money usage
- letter-of-credit cost figures without a cited source

## Product Principles

1. **Proof over promise:** every state shown is backed by a ledger transaction or a recorded decision.
2. **Fail closed, visibly:** refusals and refunds are as easy to read as payments.
3. **Limits belong to people:** the operator sets them, and agents can only read them.
4. **Calm under scrutiny:** an auditor or judge can trace any deal station by station without asking.

## Accessibility & Inclusion

WCAG 2.1 AA contrast, full keyboard operation, and a non-3D fallback when reduced motion is requested.
