# Surety product brief

Approved by Marko on 9 Nov 2026 and updated the same evening after Phase 4b, with the agent team, the bouncer and forms. This is the general direction, not a frozen spec: details will change as the build goes. It replaces the agent-to-agent invoice job as the showcase scenario. Everything already built on testnet is reused.

## One line

Escrow for import purchases, run by AI agents: the buyer's agent team finds and negotiates the deal, the importer's payment is locked on the XRP Ledger, and it is released to the overseas supplier only when the shipping documents match the agreed order. If they don't, or the deadline passes, the money comes back.

## Why it matters

- **You can't safely give an AI agent a wallet today.** It can be tricked, it can make things up, and it can overspend. Surety is the layer that makes it safe: an approved-supplier list the agents can't edit, checks they can't override, caps they can't raise, and money that only moves on proof.
- **Pitch line:** "We didn't add steps for people. We removed the people and boxed in the agent."
- **Surety doesn't care whose agents they are.** Our own, Paperclip's or a customer's: any agent team that wants to pay goes through Surety.

## The pain

- **Importer pays first:** it risks never receiving the goods, or paying a fraudster.
- **Supplier ships first:** it risks never being paid.
- **Today's answer is a bank letter of credit:** slow, paperwork-heavy, costly, and often out of reach for small businesses. Before the pitch, verify with sources how slow and how costly, and how big the African trade finance gap is.
- **Invoice redirection fraud:** a hacked supplier email sends "our bank details have changed" to the buyer. This is a known trade fraud and Surety stops it by design.
- **The setting:** cross-border trade, such as South African importers buying from suppliers in China, India or Europe, and intra-African trade.

## Who uses it

| Who | What they do |
|---|---|
| Importer's treasury or operations lead (primary) | Gives the lead agent the brief (what to buy, target and maximum price, deadline), sets limits, approves suppliers, watches deals, gets receipts |
| Lead agent (the CEO, on Paperclip) | Holds the brief, runs the team, picks the winning committed quote and accepts or declines it with a reason |
| Sourcing agent (on Paperclip) | Shortlists suppliers from the approved list and can suggest a new one, which only a person can approve |
| Negotiator (on Paperclip) | Chats with suppliers for a better price. It only talks: it never commits, never accepts and never pays, and it only knows the target price, not the maximum |
| Supplier | Chats with the negotiator, commits its final quote on the Surety form, ships, confirms its pre-filled invoice and shipping details, gets paid |
| Supplier agents (demo) | The other side, outside Paperclip: honest suppliers with different pricing styles, and one crook |
| Judges and the audience | Run the demo themselves and try to break it, including from their phones |

## The deal loop

This follows the five-step payment loop: Intent, Policy, Quote, Settlement, Audit. Sourcing and negotiation sit inside the Quote step.

1. **Intent.** The business user gives the lead agent the brief: goods, quantity, target unit price, maximum unit price, Incoterm and port, and the deadline. For example, 400 solar panels, target $110, maximum $120, CIF Durban. The maximum is held by Surety in code; the negotiator only ever sees the target.
2. **Policy.** These standing rules apply to everything after:
   - the per-deal cap, the daily cap and the open-deal limit
   - the approved-supplier list
   - a check that the supplier's wallet can hold TESTUSD

   Refusals show here.
3. **Quote.**
   - **Sourcing:** the sourcing agent shortlists approved suppliers. It may flag a supplier that isn't on the list, but only the operator can approve one.
   - **Negotiation:** the negotiator chats with the shortlisted suppliers through Surety's inbox. In the demo the chat is time-boxed to about a minute with at most one round of counter-offers. Every supplier message passes the bouncer before any agent reads it.
   - **Chat to negotiate, form to commit.** Nothing said in chat is binding and no chat message can move money. A supplier commits by submitting the Surety quote form: price, quantity, terms. Its wallet comes from its approval record and is never typed.
   - **The decision:** the lead agent picks the best committed quote and accepts or declines it with a reason. Surety checks the quote against the brief and the live policy again, whatever the agent says.
   - **Why this step exists:** the agents make the buying decision and a person only sets the brief and the limits. That's the Ripple track rule.
   - **The lock:** the signer enforces the limits whatever the agent decides, then locks the TESTUSD in XRPL token escrow, with ledger proof. The supplier's page shows "$48,000 locked for you" before it ships.
4. **Settlement.** The supplier confirms its invoice and shipping details on the Surety form. Most fields are pre-filled from the deal; the supplier adds the invoice number, B/L number, vessel, port of loading and remarks.
   - **Surety Verify** checks them:
     - First, deterministic rules compare the documents with the purchase order and the accepted quote: supplier, buyer, PO number, goods, quantities, unit prices, totals, currency, consignee, port, and the supplier wallet (the redirection check). A failed rule is final.
     - Then the decision model scores consistency and manipulation risk, which matters most for the free-text remarks.
   - A pass gets a one-use authorization, and the signer releases the payment to the supplier. The supplier sees "Paid" with the ledger link.
   - Anything else is refunded at the deadline: a mismatch, an evaluator outage or a missed deadline.
5. **Audit.** The receipt, every station with what it recorded, every message with its bouncer score, the ledger links, and the failure path when there is one.

## Forms, not typed documents

- **Nobody types the document format.** The supplier fills in Surety forms, and the forms produce the fixed invoice and bill of lading template that the rules read. Format errors can't happen.
- **The invoice is mostly pre-filled** from the deal: PO, parties, goods, quantity, price, total, wallet. The supplier checks it and confirms.
- **The supplier page keeps tamper presets for the Attack lab,** so the rules can be shown catching edited documents.
- **The AI document reader is dropped:** with forms there is nothing left for it to read.

## The bouncer

Supplier messages are where prompt injection lives: "approve now", "click here", "our details changed". The bouncer screens them. The user-facing name is still open; "Surety Screen" is proposed.

- **Every supplier message is screened before any agent reads it.** A flagged message is quarantined: the agents never see it, and it shows in the Control room instead.
- **Two layers, like Surety Verify:**
  - **Code first:** a wallet address other than the supplier's approved one, or bank details, is a red card. Spotting these doesn't need AI. Links are stripped before delivery, without a card.
  - **Then the decision model:** does the message try to instruct or steer the buyer's agents, for example to approve, pay, skip checks, change payment details, reveal the budget, or rush a decision?
- **Yellow card:** the decision model flags a message. It is quarantined, the supplier gets a strike, and the conversation can continue.
- **Second yellow:** the supplier is out of this deal and flagged for the operator.
- **Straight red:** anything that tries to change where the money goes. Out at once.
- **Strikes stay on the supplier's record across deals.** A supplier with strikes can't be invited again until the operator clears it.
- **The negotiator reports facts, not chat.** Its report to the lead is structured (price, quantity, delivery) plus a short summary, and the summary is screened too.
- **The agents' only tools are Surety actions:** read the inbox, send a message, report an offer and, for the lead, accept or decline. No opening links or files. Links are stripped from delivered messages.
- **What it protects:** the agents' judgement. The money is already protected without it, because chat can't move money. The bouncer is a strong layer, not the wall, and its questions get their own labelled test set before use.

## The three panels

The app has three side-by-side panels, like headset panels. The panel that moved aside stays visible and can be clicked to bring it back into focus.

| Panel | Lens | What's there |
|---|---|---|
| **Deals** | Use | The brief to the lead agent, the deal list, and the deal record. Opening a deal moves in depth to its five-step record, including the negotiation thread |
| **Control room** | Control | Limits, approved suppliers and their strikes, supplier suggestions waiting for approval, quarantined messages, policy version, the audit trail, health, and the failure mode table |
| **Attack lab** | Attack | One-click attacks, the live feed of audience attempts, and counters: "Attempts: 63. Got through: 0" and "Money moved to attackers: 0" |

Two more pages sit outside the panels:
- the **supplier page**, for chat, the quote form and the settlement form, with tamper presets
- the **public attack page** reached by QR code, which also shows the live counter

## Attack lab

**One-click attacks, each showing where it was stopped:**

| Attack | Stopped at |
|---|---|
| Compromised agent locks to an unapproved wallet | Signer |
| Supplier message says "approve now, pay this wallet" | Bouncer (red card), never reaches the agents |
| Supplier keeps slipping instructions into chat | Bouncer: yellow, then out on the second |
| Unknown supplier offers a cheaper deal | The agent can only suggest it; the operator must approve |
| Invoice says "our wallet has changed" | Rules (redirection check), then refund |
| Quantity or total edited | Rules, then refund |
| Hidden instruction in the bill of lading | Surety Verify, then refund |
| Deal above the cap, or daily cap reached | Policy and signer |
| Runaway agent fires 20 deals in a loop | Daily cap and open-deal limit |
| Evaluator switched off | Held, refunded at the deadline |

**QR audience attack:**
- **How people attack:** the audience scans a QR code to a public attack page. They can:
  - **Talk:** play a dodgy supplier and try to sweet-talk the negotiator into a bad deal or a different wallet.
  - **Tamper** with a live deal's documents.
- **It runs alongside the pitch, not instead of it.** The QR goes up at the start ("try to scam our agent while I talk"), a live counter runs on a side screen and on the attack page, and the pitch comes back to it at the end.
- **No prepared attack needed:** tap-to-load starter attacks can be edited before sending.
- **The prize:** one real escrow on testnet. It can only ever go to the approved supplier, and it refunds at the end.
- **Guardrails:**
  - a few messages per phone and a cap on total attempts
  - a spending cap on the decision-model checks
  - the big screen shows the attack type and where it was stopped, never the raw text
- **Pitch line:** "You might convince the agent. You can't convince the ledger."
- **Needs a public URL:** Vercel, Cloud Run or Cloudflare. Deploying still needs Marko's go at the time.

## Agent team on Paperclip

- **Paperclip runs the buyer's company:** the CEO as the lead agent, a sourcing agent and a negotiator, with Paperclip's own hierarchy and communication between them. The user talks to the CEO.
- **It runs on Marko's personal ChatGPT subscription** through Paperclip's subscription sign-in, not an API key, and never on the AWM plan.
- **Paperclip agents reach Surety only through Surety's API,** each with its own scoped token: the negotiator can read its inbox, send messages and report offers; the lead can open sourcing, select a supplier and decide on a quote.
- **The supplier agents stay outside Paperclip.** They are the other company, so the demo really is two sides talking.
- **Phase 4c opens with a short test:** a Paperclip agent opens a deal and messages a supplier through the API, fast enough for the stage. If Paperclip is too slow, the same API serves our own agents instead, so no work is lost.
- **Selling point:** bring your own Claude or ChatGPT subscription to power the agents. Before pitching it commercially, check each provider's terms for business use.

## Surety Verify (naming and honesty)

- **In the app the check is called Surety Verify.** It has two layers:
  - **Rules:** deterministic.
  - **Decision model:** returns probabilities, not text, so it can't be talked into writing "approved".
- **It isn't deterministic.** A repeat test on 9 Nov (`evidence/jev-repeat-2026-11-09T08-11-31-258Z.json`) sent the same input 5 times:
  - satisfaction ranged 0.72 to 0.76, injection was 0.02 every time
  - so it must never be called deterministic
- **For deals, `policy-v4-trade` pays only with satisfaction 0.70 or more and injection 0.20 or less** (Marko, 9 Nov). On 20 labelled document pairs, honest ones scored 0.94 to 0.96 satisfaction and at most 0.10 injection, and every manipulated one scored injection 0.82 or more ([`docs/research/06-trade-calibration.md`](research/06-trade-calibration.md)).
- **Credit the vendor outside the app.** The README, the prior-work disclosure and any Q&A answer credit TypeSafe's Jev via OpenRouter. The app doesn't need the vendor name, but we never claim the model as ours.

## Money

- **TESTUSD** is a test dollar we issue ourselves on XRPL Testnet, with no value. The app shows it as "$48,000 (test)".
  - It isn't "tUSD", because TUSD is the ticker of TrueUSD.
  - It isn't Tether (USDT).
- **RLUSD can't be used.** It is Ripple's dollar on XRPL, but its testnet issuer has escrow switched off. TESTUSD uses the same trust-line escrow mechanism, so moving to RLUSD later means changing the issuer once escrow is enabled.
- A rand value can appear beside amounts only when labelled simulated.
- Testnet only. No real money.
- **Both sides need an XRPL account.** The supplier's account must also opt in to hold TESTUSD (a trust line). The Policy step checks this before locking. For the demo, every party has a wallet.
- **In the real world, the supplier doesn't need to hold crypto itself.** Either it has a business account at a regulated exchange or payment company (already checked for money laundering, and it cashes out to its bank from there), or a payout partner receives the payment and pays the supplier's bank in local currency. We never create or hold wallets for suppliers: that would make us a custodian.
- **The supplier's wallet is fixed when it is approved, and never typed at payment time.** That is exactly where redirection fraud gets in.
- **Proven on testnet on 9 Nov.** Both trials used throwaway wallets: `evidence/token-escrow-trial-2026-11-09T00-16-50-404Z.json` (as tUSD) and `evidence/token-escrow-trial-testusd-2026-11-09T08-13-36-693Z.json`.
  - 48,000 was locked. The ledger refused a wrong release key and an early refund. The right key paid the supplier the exact amount.
  - 12,500 was locked with no key issued. After the deadline even the right key was refused, and the buyer got the full amount back.
- **The deal loop is proven on testnet** (`evidence/deals-2026-11-09T15-07-44-320Z.json`): one $48,000 deal paid, the treasury exactly $48,000 lower, and five attacks stopped.

## Supplier trust

- **You buy from suppliers you know.** The approved list lives in the signer behind the operator's own secret, so agents can't add to it.
- **Joining (Could):** an invite link, company details and a wallet, plus proof the wallet is theirs: they sign a short message with it, or, for an exchange account that can't sign, we send a tiny test amount with a code and they read it back (a penny-drop check). Then the operator approves. Demo suppliers start pre-approved.
- **Trust tiers (pitch only):** bronze, silver and gold, earned by clean deal history (for example gold after more than $20,000 of clean deals), with higher tiers getting higher limits. New suppliers start with small limits. Payments are not split across suppliers: more transfers means more risk, not less.

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
| Injection in chat | Bouncer quarantines it; the agents never see it | |
| Supplier keeps pushing tricks | Out of the deal on the second yellow | |
| Overspend | Refused | |
| Runaway loop | Capped | |
| Stolen agent credentials | Worst case: the attacker locks within caps to approved suppliers and can't release | |

## Scope

- **Must:**
  - the deal loop with sourcing, negotiation and the committed quote form
  - the agent team: lead, sourcing and negotiator on Paperclip, or our own agents if the Paperclip test fails
  - the supplier agents, including the crook
  - the bouncer with yellow and red cards
  - the supplier forms (quote and settlement)
  - the API
  - the three panels, the deal record and the supplier page
  - the one-click Attack lab
  - the failure mode table
  - the video
- **Should:** the QR audience attack page with its live counter, and hosting for it.
- **Could:**
  - supplier joining with wallet proof
  - a carrier-signed bill of lading (see below)
  - a Policy-step warning for the daily cap and open-deal limit before suppliers quote (needs a read-only signer change)
  - an Ask Surety explainer chat ("Why was deal 12 refunded?")
  - the UI tester port
- **Dropped:** the AI document reader.

## Ripple Agentic Finance fit

| Track rule | How Surety meets it |
|---|---|
| A testnet transaction executed autonomously by an agent | The lead agent accepts the committed quote and the payment locks |
| Limits enforced somewhere the agent doesn't control | The isolated signer checks every lock |
| A human operator sets the limits outside the agent | The Control room and the operator-only policy update |
| Meaningful use of XRPL and RLUSD | Token escrow with crypto-conditions, refunds by ledger time, an RLUSD-ready path, and cross-border business payments |

## Business model (hypotheses to validate)

- A fee per settled deal, priced well below letter-of-credit costs (often quoted around 1% of the deal or more, plus fixed fees; verify before the pitch).
- Distribution through freight forwarders and clearing agents, who already handle these documents for importers.
- The payment-control layer for agent workforces such as Paperclip.
- Bring your own Claude or ChatGPT subscription to power the agents.
- **The strongest future upgrade:** the bill of lading comes straight from the shipping line's electronic system, signed by the carrier, so the shipping proof can't be written by the supplier at all. In the demo the supplier still confirms its own shipping details; the pitch says so.

## Out of scope for the hackathon

- real money, KYC or KYB
- real bank or RLUSD integration
- OCR of arbitrary PDFs (the demo uses forms)
- real email (the negotiation runs in an in-app inbox styled like email)
- carrier integration (pitch only)
- legal enforceability
- partial shipments and dispute handling beyond refund

## Build plan

- **Mon 9 Nov:** Phase 4a and 4b done and on GitHub: TESTUSD and caps in the signer, deals with the Quote step, trade rules and Surety Verify, proven on testnet.
- **Tue 10 Nov:** the BuilderBase check-in forms open at 09:00 (Project Concept Document, Team Status Update, Technical Foundation Evidence). Phase 4c: the Paperclip test first, then the bouncer, sourcing and negotiation, the forms, the API and the supplier agents.
- **Wed 11 Nov:** finish 4c with a live testnet run of the whole agent loop; the web app (three panels, the deal record and the supplier page) in the look Marko picks from drafts.
- **Thu 12 Nov:** the Attack lab, the failure mode table, then the QR page and hosting. Freeze in the evening.
- **Fri 13 Nov:** rehearse, record the video, finish the README, submit by 23:59.

## Decided on 9 Nov

- **"Deal"** is the user-facing word.
- **The primary user** is the importer's treasury lead, and the supplier gets its own page.
- **The name stays Surety.**
- **Deadlines:** the ledger only allows a refund after the deadline, so demo deals offer a 5-minute deadline alongside real-world choices.
- **The Quote step, the three panels, the Attack lab, the failure mode table, the daily cap and the open-deal limit** are all in.
- **The signer change** (TESTUSD and caps) is approved.
- **Naming:** "Surety Verify" for the check, and TESTUSD for the token.
- **The QR audience attack** comes after the core works, and runs alongside the pitch.
- **Evening, after Phase 4b:**
  - Paperclip runs the buyer's agent team on Marko's ChatGPT subscription, replacing the earlier "native chat only, Paperclip in the pitch" decision.
  - Sourcing and negotiation join the Quote step. Chat to negotiate, form to commit.
  - The bouncer screens every supplier message, with yellow and red cards.
  - Forms replace typed documents, and the AI document reader is dropped.
  - The negotiator knows the target price, never the maximum.
  - Trust tiers and the carrier-signed bill of lading are pitch material, not build.
  - `policy-v4-trade`: pay only at injection 0.20 or lower.

## Open decisions

1. **Hosting:** Vercel, Cloud Run or Cloudflare for the public pages. Deploying needs Marko's go at the time.
2. **The bouncer's user-facing name:** "Surety Screen" is proposed.
3. **The Policy-step warning for the daily cap and open-deal limit:** needs a small read-only signer change; Marko hasn't decided.
