# Product vision: a procurement team of agents, with Surety as the trust layer

Marko's direction, 12 Nov 2026. The hackathon demo is the last mile of this; the rest is the commercial product.

## The idea

You tell the system what you need. A team of agents researches it, finds and checks suppliers, negotiates over days the way real trade works, and brings you a deal to approve. You give the final yes. Surety holds the money until the goods are proven, and refunds by itself if they aren't.

"Trusting your AI doesn't mean blind faith. It means confidence in every negotiation and every payment."

## The flow

1. **Onboarding: teach the agents what you buy.** The buyer describes the business and the goods (solar panels today; brackets, mounting rails, bearings or clothing tomorrow).
2. **Research.** A research agent studies the category before anyone buys: the standards and certifications that matter (IEC 61215 and IEC 61730 and an NRCS letter of authority for panels in South Africa), the measurements that separate good from bad, typical flaws, fair price ranges, and the internationally recognised sellers. It reports back in plain words, for example "for brackets, these are the 10 criteria to insist on, and these 7 sellers carry them", so the buyer can see what it learned before anything is bought.
3. **The brief, with reasoning.** The buyer says "brackets for 500 panels"; the agent works out the quantity (4 per panel, so 2,000) and asks about anything missing: deadline, budget, priority, how hard to push.
4. **Negotiation over days, not minutes.** The negotiator contacts the suppliers and keeps the conversation going over a window the buyer sets (three days, a week), replying immediately whenever a supplier answers. It uses volume as leverage, plays competing offers anonymously, asks what a careful importer asks (certification, warranty, what the price includes: freight, insurance, surcharges, duties, VAT), never assumes, and stops pushing once an offer meets the brief.
5. **The buyer's final yes.** When a deal meets the brief, the buyer gets a message: what was negotiated and why, with Approve, Decline or Push for more.
6. **Surety.** The money locks in an XRP Ledger escrow. It is released only when the paperwork passes Surety's checks and an independent inspector confirms the shipment; otherwise the ledger refunds the buyer at the deadline. Every step is in an audit trail and on the public ledger.

## Many small agents, not one big one

- The buyer talks to one assistant. Behind it, a hiring agent (Paperclip's CEO) hires a dedicated team for each purchase: a researcher and a negotiator for solar panels, and a separate new pair if brackets are needed later. Fifty agents that each do one thing well, not one agent that does fifty things.
- Every negotiator shares the same core skills, and they learn from each other: after each deal, which tactics worked, what moved the price, how often each approach succeeded. The playbook improves with every completed purchase.
- Research first is a rule for every new category: no agent negotiates a product it hasn't studied.

## The human in the loop, without the overload

- One simple screen: tell your team what you need in plain words, and it asks about anything missing.
- Every supplier conversation is an email thread (the agent can copy the buyer in), shown as a chat so anyone can follow it.
- When the agent needs a nudge it asks: "I'd like you to review these 3 deals. Shenzhen offered this, the other is $1 less and faster but can only do part of the quantity. I'm leaning towards this one, because..." The buyer approves, declines or tells it what to push for.
- Built for someone without a degree: no jargon, no dashboards to learn.

## Why it can be built now

- **Paperclip** spins up a team of agents per buyer and per category on demand; they can improve from each completed deal.
- **Surety** removes the reason to fear letting agents buy: the agents can negotiate, but the money only moves under rules, limits and a second key they cannot touch.

## What is real in the hackathon build

Steps 5 and 6 are built and run live on testnet, with a shortened negotiation (minutes instead of days) and two suppliers played by agents with fixed price floors. The research agent, onboarding, reasoning about quantities and multi-day negotiation are the product roadmap, not the demo.
