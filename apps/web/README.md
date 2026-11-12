# Surety web app

The backend does its work out of sight, so this app has one job: at every moment show where the money is, who decided, and what stopped the attack.

## Run it

```bash
pnpm install
pnpm web          # http://localhost:5173, replaying the recorded run. No backend, no secrets.
pnpm web:build    # static site in apps/web/dist, deployable anywhere
```

## Live first

The app opens live: it polls the newest purchase every 2 seconds and shows it as it happens. Nothing on the live screen is paced by a script.

- **Live** needs the Surety API and the dev server: `API_TOKEN_VIEW=<token> SURETY_API_URL=http://127.0.0.1:4200 pnpm web`. The view token is added by the dev proxy and never reaches the browser.
- **Recorded** is the backup, always badged "Recorded". If the backend cannot be reached on load, the app shows the recording and says so. `?mode=recorded` opens it directly.
- **Simulated feed** (`?sim=6`) plays a recorded run through the live path at six times speed, for testing without a backend. It is always badged "Simulated feed" and is not for the stage.
- **The main screen:** one sentence on what is happening, three numbers worked out from the record (price moved, suppliers removed, money locked or paid), a link to testnet.xrpl.org for every lock, payment and refund, a thin strip of the nine steps, and the conversations: one per supplier, plus the Lead agent's decision and the inspector. It follows whichever conversation spoke last. A held message shows that it was held and why, never its text; the text is in the Control room.
- **Judge's seat:** the QR code on the main screen opens the live supplier seat when given that supplier's token. The quote form sends `deliveryDays`, and the settlement form takes the real shipping document number, because the inspector must read the same one.
- **Inspector's page** (`#/inspector?t=<token>`): the queue without any B/L number, type the number, read it back, then send. Its QR code is in the Control room, not on the main screen.
- **Start a purchase:** shown when live has no purchase. PROVISIONAL: it calls `POST /demo/start`, which is this app's proposal and not in the API yet; until then it says to start from the terminal.
- **Not run against a real backend.** All of this is unit-tested against the record shape and exercised on the simulated feed only.

## Views

- **Buy** (`#/`): the business user's view and the demo's first screen. Under the money rail: the deal in nine steps, the negotiation as one conversation (the same line sent to every supplier is one bubble; a held message shows only that it was held), the quotes, the Lead's decision with its reason, Surety Verify and the receipt. No scores or rule names here; those are in the Control room.
- **Control room** (`#/control`): the operator's view. The negotiation in one lane per supplier with the bouncer's verdict on every message, held messages in full, and a "Negotiator's eyes" switch that shows exactly what the Negotiator's inbox carried. Then limits, approved suppliers, suggestions, held messages, the audit trail, the run checks, costs, and a QR code for the supplier seat.
- **Attack lab** (`#/attack`): every recorded attack, the layer that stopped it and the recorded reason, with counters counted from the evidence.
- **Supplier seat** (`#/supplier`): built for a phone. Three modes: the recorded run from any supplier's side; practice, where the bouncer's real code rules (`packages/gate/src/chat-rules.ts`, imported, not copied) run in the browser with no backend; and live.

The money rail (treasury, XRPL escrow, supplier) stays on screen in the Buy and Control room views.

On a phone the four views are four tabs in one row, and the recorded-run and live switch is hidden: switching to live is a job for the operator's desk.

## Plain words first

The app is written for someone who has never seen Surety.

- **One sentence says what is happening.** The deal bar opens with it ("$45,600.00 is locked on the ledger for Shenzhen Brightway Solar Co., Ltd. Nobody can take it..."). It comes from `statusLine` in `src/data/plain.ts` and is tested at every step of the recorded run, including that it never uses our own jargon.
- **Our own words explain themselves.** A dotted word (locked on the ledger, the bouncer, Surety Verify, the signer) shows its meaning on hover, focus or tap. "How it works" beside the recording notice gives the whole idea in five steps.
- **Detail opens when asked for.** Scores, thresholds, rule names and policy versions sit behind "Why", "Show the checks" and "How they are enforced". The record is unchanged; only the order of telling is.

## The supplier seat's QR code

The Control room draws a QR code for the supplier seat. A phone cannot open `localhost`, so type the address phones should use (this machine's network address after `pnpm web --host`, or the hosted address) and the code follows. It is made in the browser by `src/data/qr.ts` (byte mode, level M, versions 1 to 9), with no dependency and no outside service. The encoder's output was checked once against an independent decoder for every version it supports.

## The inspector's place

A second key for the release is coming: an inspector, separate from the buyer's agents and from the supplier, attests the bill of lading. The API is not built, so the app only leaves room for it:

- `SourcingRecord.inspection` (`src/data/types.ts`) is optional and provisional: `{ state: "pending" | "attested" | "refused", inspector?, blNumber?, note?, at? }`.
- The Buy view's steps always include "Inspector", between the documents and Surety Verify. For a record without an inspection, such as the recorded run, it is dashed and reads "Second key. Not part of this run".
- The supplier seat shows an "Inspector's attestation" card after the settlement form, and says the supplier cannot do that step itself.
- When a record carries an inspection, the timeline gains an `inspected` step and both places show it waiting, attested or refused. This is tested with records made in the tests; nothing about it is in the recorded run.

## Modes

- **Recorded run** (default): replays `evidence/sourcing-2026-11-09T18-56-04-932Z.json` with play, pause, step, 1x/4x/16x and a scrubber.
- **Live**: polls `GET /sourcing` and `GET /sourcing/:id/record` every 2 seconds through the dev server's `/api` proxy. Start it with `API_TOKEN_VIEW=<token> SURETY_API_URL=http://127.0.0.1:4200 pnpm web`: the proxy adds the view token on the server side, so it never reaches the browser. A supplier's live link is `#/supplier?t=<supplier token>`; the token is read from the fragment, kept in memory only and removed from the address bar.
- **Live mode has never been run against a real backend.** It is unit-tested against a mocked fetch only, and the two record routes come from a separate pull request. The live supplier seat fills the vessel and port of loading with placeholder values.

## Real and reconstructed

- **Real:** every message and its time, every bouncer score and card, the quotes, the Lead's reason, the Verify scores, the amounts, the treasury balances, the ledger indexes and the transaction links. The Attack lab reads the deals and signer evidence files the same way.
- **Reconstructed order, not time:** the record does not time the invites, the quote commits, the decision, the lock, the documents, Verify or the payout. They are replayed in their true order, a few seconds apart. The app does not invent a time for them: the replay bar shows the clock for timed steps and "Step 31 of 34" for the rest, and the audit trail leaves their time blank.
- **From the docs, not the record:** the limits shown in replay ($100,000 per deal, $500,000 per 24 hours, 10 open) are policy v5 from `docs/log.md`. The 12 trade rules are listed as passed because the decision model is asked only when all of them pass; the record keeps the outcome, not each rule.

## Design

- **A calm room with glass in it.** A few large frosted surfaces float at different depths: the bar, the deal bar, the panes on the arc and the replay bar. Everything inside them is a solid, lightly tinted panel. Each view has three panes on a gentle arc; bring one forward by clicking it, with the tabs, the arrow keys or a drag. The front pane tilts slightly toward the pointer. Text uses the device's own interface font.
- **Flat mode.** Reduced motion, a narrow screen or the "Flat" button turns off depth and tilt; reduced motion and the button also make the panels solid. Blur also falls back to solid where it is unsupported or reduced transparency is requested.
- **The Control room shows one conversation at a time.** All four suppliers stay listed beside it; "Side by side" brings back the four lanes on a wide screen.
- **Four colours with fixed meanings.** Blue is money in motion, green is a validated ledger result or a pass, amber is held, red is stopped. Nothing else is coloured.
- **Light by default, dark through the same tokens.** Light holds up on a projector. The "Dark" button in the bar switches, and the choice is remembered on that device.
- **Motion only where money or a verdict changes:** the balances count, the rail's legs draw, a message appears. Reduced motion turns all of it off.
- **Same run, different eyes.** The Buy view, the Control room, the Negotiator's eyes and the supplier seat are four readings of one record, which is how the claim "the Negotiator never saw it" becomes something you can look at.
