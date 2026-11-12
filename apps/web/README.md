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
- **Open the big screen as `http://localhost:5173` on the laptop itself.** The dev proxy gives the view token only to a request from this machine, addressed to localhost, with no forwarding header. The start request must also come from the app's own page. Phones use the laptop's network address and reach only the supplier and inspector routes.
- **Recorded** is the backup, always badged "Recorded". If the backend cannot be reached on load, the app shows the recording and says so. `?mode=recorded` opens it directly.
- **Four recordings** can be played back, chosen beside the "Recorded" badge: paid with the inspector's confirmation (the default), refunded after the inspector refused, refunded when nobody answered in time, and the first run from before the inspector existed.
- **Simulated feed** (`?sim=6`) plays a recorded run through the live path at six times speed, for testing without a backend. It is always badged "Simulated feed" and is not for the stage.
- **The main screen:** one sentence on what is happening, three numbers worked out from the record (price moved, suppliers removed, money locked or paid), a link to testnet.xrpl.org for every lock, payment and refund, a thin strip of the nine steps, and the conversations: one per supplier, plus the Lead agent's decision and the inspector. It follows whichever conversation spoke last. A held message shows that it was held and why, never its text; the text is in the Control room.
- **Judge's seat:** the QR code on the main screen opens the live supplier seat when given that supplier's token. The quote form sends `deliveryDays`, and the settlement form takes the real shipping document number, because the inspector must read the same one.
- **Inspector's page** (`#/inspector?t=<token>`): the queue without any B/L number, type the number, read it back, then send. Its QR code is in the Control room, not on the main screen.
- **Start a purchase:** shown when live has no purchase. It calls `POST /demo/start`, which hands the Lead agent its task; the Lead opens the purchase. If the API was started without `PAPERCLIP_COMPANY_ID` and `PAPERCLIP_LEAD_AGENT_ID` the route answers 404 and the form says to start by hand.
- **Not run against a real backend.** All of this is unit-tested against the record shape and exercised on the simulated feed only.

## Views

Two places in the menu, and two phone pages with their own links.

- **My purchase** (`#/`): the whole product for the buyer, on one screen.
  1. **Say what you need,** typed or spoken (the browser's own speech recognition, where it has one). The team asks about anything missing, one plain question at a time: how many, the most you will pay, the price you hope for, how soon, what matters most, how hard to push. `POST /buyer/intake` reads the words; nothing is opened.
  2. **Put my team to work.** `POST /demo/start` hands the Lead agent its task. The negotiation is shortened to three minutes in this build, and the screen says so.
  3. **Watch.** Each supplier's conversation is an email thread with the buyer copied in. A message Surety stopped shows only that it was stopped and why, never its text. The buyer can tell the negotiator something at any time (`POST /sourcing/:id/notes`).
  4. **The final yes.** When the Lead recommends a deal the screen becomes its message: the deals, its pick and its reason, and two buttons. `POST /deals/:id/approval`. Only a yes locks the payment; a no moves nothing.
  5. **Track it.** After the yes: payment locked, paperwork, the inspector's confirmed shipping number, the check, paid or refunded, each with its ledger link, and a bar from the payment day to the promised delivery day. Delivery itself is marked "Not tracked on the test network yet", and the three quick actions (message the seller, ask the shipping line, report a problem) are marked "Coming soon": none of them is built.
- **Admin** (`#/admin`): everything else.
  - **What happened:** a plain-words log of the purchase, oldest first: who said what, which agent did what, every check and every transaction with its ledger link.
  - **Ask:** an assistant that answers from the records of the last five purchases (`POST /admin/ask`). It is a model, and the page says so.
  - **Control room, Attack lab, Supplier seat:** the technical views, unchanged. Old links (`#/control`, `#/attack`) still open them.
  - **Recordings and display:** switch the main screen to a recording, pick which, or turn on the control room's 3D arc.
- **Supplier's phone page** (`#/supplier`) and **inspector's phone page** (`#/inspector`): as before, reached by their own links.

A recording or a simulated feed is always badged, and can be watched but not acted on: the say-box, the nudge and the yes appear only on the live backend.
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
- **Flat by default.** Every panel is on the page at once, with the glass kept. The arc clips its side panes on a 1440 px screen, so the 3D layout is now a choice: press "Flat" to turn it off. Reduced motion always stays flat and makes the panels solid. Blur also falls back to solid where it is unsupported or reduced transparency is requested.
- **A blurred solar field behind everything.** `public/solar-field.jpg` sits under a veil of the page colour (88% in light, 86% in dark). The veil is that strong on purpose: with it, the muted text that lies straight on the page keeps at least 4.5:1 even where the photo underneath is black (light) or white (dark). Photo by [Andreas Gücklhorn](https://unsplash.com/photos/Ilpf2eUPpUE) on Unsplash, used under the Unsplash License, resized and blurred.
- **The Control room shows one conversation at a time.** All four suppliers stay listed beside it; "Side by side" brings back the four lanes on a wide screen.
- **Four colours with fixed meanings.** Blue is money in motion, green is a validated ledger result or a pass, amber is held, red is stopped. Nothing else is coloured.
- **Light by default, dark through the same tokens.** Light holds up on a projector. The "Dark" button in the bar switches, and the choice is remembered on that device.
- **Motion only where money or a verdict changes:** the balances count, the rail's legs draw, a message appears. Reduced motion turns all of it off.
- **Same run, different eyes.** The Buy view, the Control room, the Negotiator's eyes and the supplier seat are four readings of one record, which is how the claim "the Negotiator never saw it" becomes something you can look at.
