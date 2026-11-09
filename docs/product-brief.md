# Surety product brief

Approved by Marko on 9 Nov 2026. This is the general direction, not a frozen spec: details will change as the build goes. It replaces the agent-to-agent invoice job as the showcase scenario. Everything already built on testnet is reused.

## One line

Escrow for import purchases: the importer's payment is locked on the XRP Ledger and released to the overseas supplier only when the shipping documents match the purchase order. If they don't, or the deadline passes, the money comes back.

## The pain

- **Importer pays first:** it risks never receiving the goods, or paying a fraudster.
- **Supplier ships first:** it risks never being paid.
- **Today's answer is a bank letter of credit:** slow, paperwork-heavy, costly, and often out of reach for small businesses. Before the pitch, verify with sources how slow and how costly, and how big the African trade finance gap is.
- **Invoice redirection fraud:** a hacked supplier email sends "our bank details have changed" to the buyer. This is a known trade fraud and Surety stops it by design.
- **The setting:** cross-border trade, such as South African importers buying from suppliers in China, India or Europe, and intra-African trade.

## Who uses it

| Who | What they do |
|---|---|
| Importer's treasury or operations lead (primary) | States what to buy and the budget, sets limits and approved suppliers, hires agents, watches deals, gets receipts |
| Supplier | Receives a deal link, sends a quote, later submits its commercial invoice and bill of lading, gets paid |
| Deal agent (AI) | Compares the supplier's quote with the intent and the policy, decides to accept or decline, and asks the signer to lock the payment |
| Verification agent (AI) | Reads the supplier's documents into structured fields for the checks |
| Hired agents (AI) | Permanent agents the user creates through chat, such as "monthly panel orders from Shenzhen", each with a budget the operator approves |
| Judges and the audience | Run the demo themselves and try to break it, including from their phones |

## The deal loop

This follows the five-step payment loop: Intent, Policy, Quote, Settlement, Audit.

1. **Intent.** The business user states the purchase: goods, quantity, maximum unit price, supplier wallet, Incoterm and port, and the deadline. For example, 400 solar panels from a Shenzhen supplier, CIF Durban.
2. **Policy.** These standing rules apply to everything after:
   - the per-deal cap, the daily cap and the open-deal limit
   - the approved-supplier list
   - a check that the supplier's wallet can hold TESTUSD

   Refusals show here.
3. **Quote.** The supplier sends its price, terms and wallet (prefilled in the demo). The deal agent compares the quote with the intent and the policy, then accepts or declines it with a reason. On accept, it asks the signer to lock the payment.
   - **Why this step exists:** it means the agent makes the buying decision and a person only sets the intent and the budget. That's the Ripple track rule.
   - **The lock:** the signer enforces the limits whatever the agent decides, then locks the TESTUSD in XRPL token escrow, with ledger proof.
4. **Settlement.** The supplier submits its commercial invoice and bill of lading.
   - The verification agent reads them into fields.
   - **Surety Verify** checks them:
     - First, deterministic rules compare the documents with the purchase order and the accepted quote: supplier, buyer, PO number, goods, quantities, unit prices, totals, currency, consignee, port, and the supplier wallet (the redirection check). A failed rule is final.
     - Then the decision model scores consistency and manipulation risk.
   - A pass gets a one-use authorization, and the signer releases the payment to the supplier.
   - Anything else is refunded at the deadline: a mismatch, an evaluator outage or a missed deadline.
5. **Audit.** The receipt, every station with what it recorded, the ledger links, and the failure path when there is one.

## The three panels

The app has three side-by-side panels, like headset panels. The panel that moved aside stays visible and can be clicked to bring it back into focus.

| Panel | Lens | What's there |
|---|---|---|
| **Deals** | Use | New deal (intent), the deal list, and the deal record. Opening a deal moves in depth to its five-step record |
| **Control room** | Control | Limits, approved suppliers, hired agents and their budgets, policy version, the audit trail, health, and the failure mode table |
| **Attack lab** | Attack | One-click attacks, the live feed of audience attempts, and a counter: "Money moved to attackers: 0" |

Two more pages sit outside the panels:
- the **supplier page**, for quote and documents, with editable documents and tamper presets
- the **public attack page** reached by QR code

## Attack lab

**One-click attacks, each showing where it was stopped:**

| Attack | Stopped at |
|---|---|
| Compromised agent locks to an unapproved wallet | Signer |
| Invoice says "our wallet has changed" | Rules (redirection check), then refund |
| Quantity or total edited | Rules, then refund |
| Hidden instruction in the bill of lading | Surety Verify, then refund |
| Deal above the cap, or daily cap reached | Policy and signer |
| Runaway agent fires 20 deals in a loop | Daily cap and open-deal limit |
| Evaluator switched off | Held, refunded at the deadline |

**QR audience attack (after the core works):**
- **How people attack:** the audience scans a QR code to a public attack page. They can:
  - **Tamper** with a live deal's documents.
  - **Talk** to the deal agent and try to persuade it to pay them.
- **No prepared attack needed:** tap-to-load starter attacks can be edited before sending.
- **The prize:** one real escrow on testnet. It can only ever go to the approved supplier, and it refunds at the end.
- **Guardrails:**
  - a rate limit per phone and a cap on total attempts
  - the $5 OpenRouter cap
  - the big screen shows the attack type and where it was stopped, never the raw text
- **Pitch line:** "You might convince the agent. You can't convince the ledger."
- **Needs a public URL:** hosting or a tunnel, which needs approval.

## Ask Surety chat and hired agents

**A native chat dock in the app, not Paperclip's runtime.** It:
- answers questions such as "Why was deal 12 refunded?"
- explains refusals
- hires permanent agents

**Hiring goes in this order:**
1. The user describes a job.
2. The chat proposes an agent with a budget and the suppliers it may use.
3. The operator approves or lowers the budget in the Control room.
4. The signer enforces that budget.

Agents never set their own limits. The same chat component powers the "Talk" attack on the QR page.

**Paperclip stays in the pitch as the business angle:** agent workforces need spending controls, and Surety is that layer. If Thursday has spare time, a Paperclip agent opens a deal through our API.

## Surety Verify (naming and honesty)

- **In the app the check is called Surety Verify.** It has two layers:
  - **Rules:** deterministic.
  - **Decision model:** returns probabilities, not text, so it can't be talked into writing "approved".
- **It isn't deterministic.** A repeat test on 9 Nov (`evidence/jev-repeat-2026-11-09T08-11-31-258Z.json`) sent the same input 5 times:
  - satisfaction ranged 0.72 to 0.76, injection was 0.02 every time
  - so it must never be called deterministic
  - the safety margin is the gap between bad files (0.04 or less) and the 0.70 approval line
- **The demo's honest documents must score well above 0.70.** The exact-match deliverable scored 0.95.
- **Credit the vendor outside the app.** The README, the prior-work disclosure and any Q&A answer credit TypeSafe's Jev via OpenRouter. The app doesn't need the vendor name, but we never claim the model as ours.

## Money

- **TESTUSD** is a test dollar we issue ourselves on XRPL Testnet, with no value. The app shows it as "$48,000 (test)".
  - It isn't "tUSD", because TUSD is the ticker of TrueUSD.
  - It isn't Tether (USDT).
- **RLUSD can't be used.** It is Ripple's dollar on XRPL, but its testnet issuer has escrow switched off. TESTUSD uses the same trust-line escrow mechanism, so moving to RLUSD later means changing the issuer once escrow is enabled.
- A rand value can appear beside amounts only when labelled simulated.
- Testnet only. No real money.
- **Both sides need an XRPL account.** The supplier's account must also opt in to hold TESTUSD (a trust line). The Policy step checks this before locking.
- **Proven on testnet on 9 Nov.** Both trials used throwaway wallets: `evidence/token-escrow-trial-2026-11-09T00-16-50-404Z.json` (as tUSD) and `evidence/token-escrow-trial-testusd-2026-11-09T08-13-36-693Z.json`.
  - 48,000 was locked. The ledger refused a wrong release key and an early refund. The right key paid the supplier the exact amount.
  - 12,500 was locked with no key issued. After the deadline even the right key was refused, and the buyer got the full amount back.

## Failure mode table

The table appears in the Control room and the README. Each row is linked to testnet evidence where it exists.

| Failure | Result | Evidence |
|---|---|---|
| Evaluator down | Refund | Proven |
| Worker restarts mid-deal | Resumes, then refunds or settles | Proven by the restart drill |
| Signer crashes after submitting | Journal plus hash lookup, never a double submit | |
| Transaction lost | Ranged lookup proves it absent before any retry | |
| Approval arrives too late | 30-second decision cutoff, so it refunds | |
| Wrong documents | Rules refuse | Proven: bill of lading edited to 380 panels, refunded ([evidence](../evidence/deals-2026-11-09T15-07-44-320Z.json)) |
| Injection | Blocked | Proven: instruction in the B/L remarks, injection 0.97, refunded ([evidence](../evidence/deals-2026-11-09T15-07-44-320Z.json)) |
| Redirection | Rules refuse | Proven: "our wallet has changed" invoice, rule `pay_to`, refunded ([evidence](../evidence/deals-2026-11-09T15-07-44-320Z.json)) |
| Overspend | Refused | |
| Runaway loop | Capped | |
| Stolen agent credentials | Worst case: the attacker locks within caps to approved suppliers and can't release | |

## Scope

- **Must:**
  - the deal loop with the Quote step
  - TESTUSD in the signer, plus the daily cap and open-deal limit (signer change approved 9 Nov)
  - the trade-document rules, including the redirection check
  - both agents
  - the API
  - the three panels, the deal record and the supplier page
  - the one-click Attack lab
  - the failure mode table
  - the video
- **Should:** the QR audience attack page with its live feed, and the Ask Surety chat.
- **Could:**
  - hired agents with budgets
  - a Paperclip agent opening a deal through the API
  - the UI tester port

## Ripple Agentic Finance fit

| Track rule | How Surety meets it |
|---|---|
| A testnet transaction executed autonomously by an agent | The deal agent accepts the quote and has the payment locked |
| Limits enforced somewhere the agent doesn't control | The isolated signer checks every lock |
| A human operator sets the limits outside the agent | The Control room, including hired agents' budgets |
| Meaningful use of XRPL and RLUSD | Token escrow with crypto-conditions, refunds by ledger time, an RLUSD-ready path, and cross-border business payments |

## Business model (hypotheses to validate)

- A fee per settled deal, priced below letter-of-credit costs.
- Distribution through freight forwarders and clearing agents, who already handle these documents for importers.
- The payment-control layer for agent workforces such as Paperclip.

## Out of scope for the hackathon

- real money, KYC or KYB
- real bank or RLUSD integration
- OCR of arbitrary PDFs (the demo uses synthetic, editable documents)
- legal enforceability
- partial shipments and dispute handling beyond refund
- paid APIs and metered access

## Build plan

- **Mon 9 Nov:**
  - the checkpoint
  - the Phase 4 plans
  - start the backend: TESTUSD in the signer and caps first
- **Tue 10 Nov:** finish the backend: the deal model with the Quote step, trade-document rules, both agents, the API.
- **Wed 11 Nov:** the web app: three panels, the deal record and the supplier page, in the look Marko picks from drafts.
- **Thu 12 Nov:** the Attack lab, the failure mode table, then the QR page and chat if the core is solid. Freeze in the evening.
- **Fri 13 Nov:** rehearse, record the video, finish the README, submit by 23:59.

## Decided on 9 Nov

- **"Deal"** is the user-facing word.
- **The primary user** is the importer's treasury lead, and the supplier gets its own page.
- **Demo documents** are synthetic and editable, styled as an invoice and a bill of lading. No PDFs.
- **The name stays Surety.**
- **Supplier entry:** the business user pastes the supplier's wallet address. The Policy step checks it. Demo suppliers come pre-approved.
- **Deadlines:** the ledger only allows a refund after the deadline, so demo deals offer a 5-minute deadline alongside real-world choices.
- **The Quote step, the three panels, the Attack lab, the failure mode table, the daily cap and the open-deal limit** are all in.
- **The signer change** (TESTUSD and caps) is approved.
- **Naming:** "Surety Verify" for the check, and TESTUSD for the token.
- **Paperclip:** built as the native Ask Surety chat with hired agents, and Paperclip appears only in the pitch.
- **The QR audience attack** comes after the core works.

## Open decisions

1. **Hosting for judges:** run it on Marko's laptop at the venue, or deploy a hosted version. The QR page needs a public URL, either hosting or a tunnel. Both need approval. Ask at the 9 Nov checkpoint what "testnet deployment" means.
