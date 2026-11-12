# Surety: the business in one page

Draft for the Business score. Anything in [square brackets] is a gap only Marko can fill. Every outside figure has its source next to it and a note on how far to trust it. Nothing here is invented; where there is no evidence yet, it says so.

## The problem, in one breath

A small importer who buys from a supplier abroad has two bad choices. Pay up front and hope the goods arrive, or ask a bank for a letter of credit and often be turned down.

- African banks rejected about 37% of trade finance applications over 2020 to 2024, and the unmet demand is above US$74 billion a year. Source: African Development Bank, "Trade Finance Supply in Africa", as reported by [Global Trade Review](https://www.gtreview.com/news/africa/africas-trade-finance-gap-tops-us74bn-as-banks-retreat-afdb-warns/). *Read from a news report, not the AfDB report itself. Open the report and confirm both numbers before saying them on stage.*
- Where a letter of credit is available, opening one commonly costs around 0.5% to 2% of its value, plus amendment and handling fees, and fixed minimums make it poor value on small orders. Sources: trade guides such as [Slash](https://www.slash.com/blog/letters-of-credit) and [Nav](https://www.nav.com/business-credit/what-is-a-letter-of-credit/). *These are guides, not bank tariffs. Replace with one South African bank's published fee: [bank, fee, link].*
- Paying without protection is where the fraud is. The FBI recorded US$2.77 billion in reported losses to business email compromise in 2024, which includes fake supplier invoices. Source: FBI IC3 2024 report, as summarised by [Nacha](https://www.nacha.org/news/fbis-ic3-finds-almost-85-billion-lost-business-email-compromise-last-three-years). *US reports only, and it covers all such fraud, not only supplier payments.*

Now add AI agents. Businesses are starting to let agents find suppliers and negotiate. Nobody sensible lets them pay, because an agent can be talked into anything.

**Be honest about one thing:** the US$74 billion gap is mostly about credit, and Surety does not lend. It serves the buyer who has the cash and cannot trust the other side. Say "rejected importers pay up front and carry the risk; Surety removes that risk", not "Surety closes the trade finance gap".

## Who it is for first

An importer placing orders of roughly US$10,000 to US$100,000 with suppliers they have not bought from before. Too small for a bank to care, too large to lose. The recorded purchases in `evidence/` are US$44,400 to US$47,200, which is inside that range.

**Evidence that this person exists and wants it: none yet.** This is the biggest hole in the Business score, and one conversation fixes most of it.

> [Name, role, company or "a clearing agent in Durban". One or two sentences in their words: how they pay suppliers today, what went wrong last time, what they would pay to avoid it. Date of the conversation.]

Three questions to ask them, ten minutes on the phone:

1. The last time you paid a new supplier abroad, how did you pay, and what did you worry about?
2. Have you ever lost money or goods on an order? What happened?
3. If the money sat locked until an inspector confirmed the shipment, what would that be worth to you per order?

## What they get

One sentence: AI agents that can buy for your business and cannot steal from it.

- The agents negotiate. In the recorded 10 Nov purchase they brought two suppliers down by US$7 and US$10 a panel on 400 panels.
- The money locks on the XRP Ledger and is released only when the paperwork passes and an independent inspector confirms the shipment. Otherwise the ledger refunds it. No bank, no smart contract.
- A person sets the limits and the approved suppliers. The agents cannot change them.

## Who pays, and how much

**A proposal, not a tested price.** A fee on each settled purchase, charged to the buyer, set clearly below a letter of credit.

| On the recorded US$46,400 purchase | Cost |
|---|---|
| Letter of credit at 0.5% to 2% (guide range above) | US$232 to US$928 |
| Surety at [0.25%] | [US$116] |
| Ledger fees for lock and release | a fraction of a cent |

The inspection is paid separately to the inspector, as it is today. Refunded purchases pay nothing.

[Marko: pick the percentage, or a flat fee per purchase, and say it with confidence. If the person you speak to names a number, use theirs.]

## How it reaches them

Importers already trust their freight forwarder or clearing agent, who sees every shipment and already handles the bill of lading. That person is both the sales channel and the natural inspector: they earn a fee per confirmation and bring their own clients.

[Marko: one named forwarder or clearing agent you could approach, or "none yet".]

## The bigger picture, in one line for the judges

Import purchases are the first example. The product is the payment-control layer for any AI agent that spends money: the agent decides, limits it cannot touch decide whether the money moves, and a second party confirms before release.

## Why XRPL and RLUSD

- Token escrow is built into the ledger, so the lock, the release and the timed refund need no contract to audit.
- A dollar stablecoin means the supplier is paid in dollars within seconds of release, and the fee is negligible.
- TESTUSD stands in for RLUSD on testnet because RLUSD's testnet issuer has escrow switched off. Moving is a change of issuer.

## What stands between this and a business

Say these before a judge does.

1. **No customer has seen it.** Fix: the one conversation above.
2. **The inspector is a stand-in.** A real one is a forwarder, an inspection company or the carrier's signed record. No agreement with any exists.
3. **Suppliers must accept a stablecoin.** Untested. [Ask one supplier or one importer whether theirs would.]
4. **Regulation.** Holding and moving client funds across borders touches exchange control and payments licensing in South Africa. Not researched. Say "we would partner with a licensed provider" only if you mean it.
5. **Testnet only.** No real money has moved.

## The thirty seconds to say out loud

"Small importers either pay strangers up front or get turned down for a letter of credit. [One sentence from the person you spoke to.] Surety lets AI agents do the buying and takes the payment out of their hands: the money locks on the XRP Ledger and moves only when the paperwork passes and an inspector confirms the shipment. We charge [fee] per settled purchase, a fraction of a letter of credit, and we reach importers through the freight forwarders who already inspect their goods."
