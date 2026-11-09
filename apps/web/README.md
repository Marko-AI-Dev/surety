# Surety web app

The backend does its work out of sight, so this app has one job: at every moment show where the money is, who decided, and what stopped the attack.

## Run it

```bash
pnpm install
pnpm web          # http://localhost:5173, replaying the recorded run. No backend, no secrets.
pnpm web:build    # static site in apps/web/dist, deployable anywhere
```

## Views

- **Buy** (`#/`): the business user's view. The brief, what the agent team is doing in plain sentences, the committed quotes, the Lead's decision with its reason, Surety Verify and the receipt.
- **Control room** (`#/control`): the operator's view. The negotiation in one lane per supplier with the bouncer's verdict on every message, held messages in full, and a "Negotiator's eyes" switch that shows exactly what the Negotiator's inbox carried. Then limits, approved suppliers, suggestions, held messages, the audit trail, the run checks and costs.
- **Attack lab** (`#/attack`): every recorded attack, the layer that stopped it and the recorded reason, with counters counted from the evidence.
- **Supplier seat** (`#/supplier`): built for a phone. Three modes: the recorded run from any supplier's side; practice, where the bouncer's real code rules (`packages/gate/src/chat-rules.ts`, imported, not copied) run in the browser with no backend; and live.

The money rail (treasury, XRPL escrow, supplier) stays on screen in the Buy and Control room views.

## Modes

- **Recorded run** (default): replays `evidence/sourcing-2026-11-09T18-56-04-932Z.json` with play, pause, step, 1x/4x/16x and a scrubber.
- **Live**: polls `GET /sourcing` and `GET /sourcing/:id/record` every 2 seconds through the dev server's `/api` proxy. Start it with `API_TOKEN_VIEW=<token> SURETY_API_URL=http://127.0.0.1:4200 pnpm web`: the proxy adds the view token on the server side, so it never reaches the browser. A supplier's live link is `#/supplier?t=<supplier token>`; the token is read from the fragment, kept in memory only and removed from the address bar.
- **Live mode has never been run against a real backend.** It is unit-tested against a mocked fetch only, and the two record routes come from a separate pull request. The live supplier seat fills the vessel and port of loading with placeholder values.

## Real and reconstructed

- **Real:** every message and its time, every bouncer score and card, the quotes, the Lead's reason, the Verify scores, the amounts, the treasury balances, the ledger indexes and the transaction links. The Attack lab reads the deals and signer evidence files the same way.
- **Reconstructed order, not time:** the record does not time the invites, the quote commits, the decision, the lock, the documents, Verify or the payout. They are replayed in their true order, a few seconds apart, and each is marked "order recorded, exact time not recorded" (a ring in the audit trail, a hollow tick on the scrubber).
- **From the docs, not the record:** the limits shown in replay ($100,000 per deal, $500,000 per 24 hours, 10 open) are policy v5 from `docs/log.md`. The 12 trade rules are listed as passed because the decision model is asked only when all of them pass; the record keeps the outcome, not each rule.

## Design

- **A treasury desk, not a crypto dashboard.** Solid surfaces, IBM Plex Sans, large tabular figures for money. No glass, glow or 3D: on a projector they cost legibility and add nothing a judge can check.
- **Four colours with fixed meanings.** Blue is money in motion, green is a validated ledger result or a pass, amber is held, red is stopped. Nothing else is coloured.
- **Dark by default, light through the same tokens.** It follows the system setting and has a switch, because projectors wash out dark screens.
- **Motion only where money or a verdict changes:** the balances count, the rail's legs draw, a message appears. Reduced motion turns all of it off.
- **Same run, different eyes.** The Buy view, the Control room, the Negotiator's eyes and the supplier seat are four readings of one record, which is how the claim "the Negotiator never saw it" becomes something you can look at.
