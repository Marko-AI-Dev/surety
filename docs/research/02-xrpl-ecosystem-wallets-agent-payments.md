# 02 XRPL ecosystem: wallets and agent payments

Researched 2026-11-08. [V] = verified in primary sources; [I] = inferred or press only.

## 1. xrpl-resource-index

- URL: https://github.com/RippleDevRel/xrpl-ressource-index (note the spelling "ressource") [V]. Last commit 2026-06-17, 17 commits in total. It is nine short Markdown link pages [V].
- (a) Escrow: `js/escrow.js` in RippleDevRel/xrpl-js-python-simple-scripts (crypto-condition escrow via five-bells-condition), and `send-conditional-escrow.js` and `cancel-escrow.js` in XRPLF/xrpl-dev-portal `_code-samples/escrow/js` [V].
- (b) Agents: the XRPL AI Starter Kit (https://ripple.com/insights/xrpl-ai-starter-kit/), the xrpl.org agentic transactions docs, Open Wallet Standard (OWS), and a "Built by T54" section (x402 facilitator, x402-secure, Claw Credit, rlusd-skills, ripple/xrpl-up) [V].
- (c) Wallets: Crossmark, MetaMask XRPL Snap, OWS. No Privy or GhostSig [V].
- (d) Starters: XRPL-Commons/scaffold-xrp (Next.js, TypeScript, xrpl-connect) and maximedgr/xrpl-quickstart-react-crossmark [V].
- Same org: RippleDevRel/agentic-mpp-demo, a Claude buyer agent with OWS policy-bound signing, lists escrow/crypto-conditions as future work [V].

## 2. Privy

- XRPL is live as a Tier 2 chain ("decodes and validates the transaction before signing"), announced with Ripple on 2026-10-13 [V] (https://docs.privy.io/wallets/overview/chains).
- How it works: call `wallets().create({chain_type:'xrpl'})` (secp256k1) from the Node SDK, Python or REST. Sign with `xrpl_signTransaction`, which returns a blob ready to submit, or with `raw_sign`. You submit with xrpl.js [V] (https://docs.privy.io/wallets/using-wallets/other-chains/xrpl). React client-side XRPL wallets are not documented [V].
- EscrowCreate: the docs say Privy can "sign any XRPL transaction", but give no escrow example. So a server wallet very likely can sign it [I].
- Policy engine: decoded-field rules exist only for Payment, OfferCreate, OfferCancel and TrustSet (destination allowlists, drop caps, time gates) [V]. Escrow types can only be allowed or denied by type or system rule. You cannot cap EscrowCreate Amount or pin its Destination [V]. Privy's examples warn that a Payment.Destination denylist does not cover EscrowCreate [V].
- Free tier: 0 to 499 MAU and 50K signatures a month [V] (https://www.privy.io/pricing).
- Example: community repo danpereira88/privy-xrpl-payout-agent (Claude plans, Privy server wallet signs under a Payment-only policy, testnet). No official repo [V].

## 3. GhostSig

- A hosted passkey wallet (https://ghostsig.dev). The WebAuthn PRF output is the seed, and it derives ed25519 keys per ledger. There is no backend, and apps talk to it through a popup and postMessage [V]. It describes itself as "beta software" that has "not been audited" [V]. Built by Consulting Manao [I].
- SDK: `@ghostsig/sdk` on JSR only, v1.2.0 (2026-10-07), about 2 downloads a week. An xrpl-connect adapter was merged on 2026-09-24 [V].
- `sign` accepts any XRPL transaction JSON on testnet [V]. EscrowCreate has not been publicly tested [I].
- Fit: human buyers only; every signature needs a passkey prompt from a user click [V].

## 4. t54.ai

- Products (https://t54.ai) [V]:
  - XRPL x402 Facilitator: mainnet and testnet hosts, no API key, `exact` scheme, XRP plus RLUSD.
  - x402-secure: open-source risk proxy.
  - Trustline: risk/KYA underwriting API. Needs portal sign-up, KYB and an API key.
  - Claw Credit: agent credit, on XRPL in RLUSD.
  - Agentic Risk Standard: a research spec.
- No product is named "payment requests" or "spending controls"; those map to 402 challenges and Trustline guardrails [I]. No pricing is published [V]. Ripple joined t54's $5M seed round [I].
- The Agentic Risk Standard (github.com/t54-labs/AgenticRiskStandard) already specifies "fees held in escrow until an independent evaluator confirms delivery", but on EVM with USDC [V]. t54 and Virtuals announced escrowed jobs for XRPL in March 2026 [I].
- Verdict: the nearest competitor on concept, and a complement on payment rails.

## 5. x402 vs MPP

- x402: started at Coinbase in 2025 [I]. It is now run by the x402 Foundation under the Linux Foundation, with Ripple as a premier member [V]. The server answers with HTTP 402, the client retries with a signed payment, and a facilitator verifies and settles. XRPL is in the official spec: `@x402/xrpl` 2.30.0 with the `exact` scheme and a draft `upto` scheme on PayChannels [V]. RLUSD works through t54 [V]. The `auth-capture` scheme (hold, capture, void, reclaim after a deadline) exists for EVM only [V].
- MPP: the Machine Payments Protocol, co-authored by Stripe and Tempo [V] and launched on 2026-03-18 [I]. It is submitted to the IETF and supports charge, session and subscription intents across several rails [V] (https://mpp.dev). The XRPL method is ripple/xrpl-mpp-sdk (npm 0.1.0-beta.4): XRP, IOU and MPT charges, plus XRP PayChannel sessions [V].
- Difference: both are pay-per-request. The buyer pays at request time and trusts the seller to deliver; settlement is final. Conditional escrow is pay-on-verified-delivery: funds are locked before the work, released only when the gate produces the fulfillment, and refundable after CancelAfter. Neither protocol does this on XRPL today [V].

## 6. MCP and agent toolkits for Claude

- XRPL Docs MCP: https://mcp.xrpledger.ai (no key; backup https://xrpl.org/mcp). Docs search only, no signing [V].
- Official Claude skills: xrpl-agent-wallet, xrpl-payments and xrpl-trading in XRPLF/xrpl-dev-portal `.claude/skills` [V].
- ripple/xrpl-up: a testnet CLI with a Claude Code plugin and an `escrow` command [V].
- No Ripple-endorsed MCP server submits transactions; community ones are unendorsed [V].

## 7. W3NODE and Ripple Africa

- No public Ripple bounty, "best use of XRPL" prize or XRPL track was found. w3node.io and Eventbrite name no sponsors [V].
- Ripple DevRel is present: RippleDevRel/xrpl-devex-hook (pushed 2026-11-02) has the invite code `W3NodeHackathon26XRPL` and records XRPL friction from opted-in coding agents [V].
- A W3NODE x WIBA post cites over $10,000 in prizes, including an agentic finance focus [I].
- No 2026 Ripple Africa program was found. Ask organisers on day one.

## Recommendation for a 3-day testnet prototype

- Privy: MENTION IN PITCH. It likely signs escrow transactions, but its policy cannot read escrow fields. Name it as the production custody path.
- GhostSig: SKIP. It is beta, unaudited and works only with a human at a popup.
- t54: MENTION IN PITCH. Set Surety against the Agentic Risk Standard: native XRPL escrow with no smart contract.
- x402: MENTION IN PITCH. Present Surety as the missing XRPL "auth-capture" scheme.
- MPP: MENTION IN PITCH. It is Ripple-backed but beta and pay-per-request. Reference it, don't build on it.
