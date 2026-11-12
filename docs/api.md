# Surety API

The only way the buyer's agents, the supplier agents and the UI reach Surety. Plain HTTP with JSON bodies, served by `services/api` (`pnpm api`) on `API_HOST:API_PORT` (default `127.0.0.1:4200`).

## Authentication and roles

Every request except `GET /health` sends `Authorization: Bearer <token>`. Each token belongs to exactly one caller:

| Role | Who | Token |
|---|---|---|
| `lead` | The buyer's lead agent (the CEO) | `API_TOKEN_LEAD` |
| `sourcing` | The sourcing agent | `API_TOKEN_SOURCING` |
| `negotiator` | The negotiator | `API_TOKEN_NEGOTIATOR` |
| `view` | The UI and the operator, read-only | `API_TOKEN_VIEW` |
| `inspector` | A person holding the second key, never an agent | `API_TOKEN_INSPECTOR` |
| `supplier` | One supplier wallet per token | `API_SUPPLIER_TOKENS` (JSON: address to token) |

`pnpm api:tokens` writes all of them to `.env.api`, which is gitignored and never printed. `pnpm api:tokens --add-missing` appends only the role tokens a file lacks (the inspector's, from Phase 4d) and leaves every other line, so no agent's token changes. Both also write `.env.suppliers` with the supplier tokens only: the supplier agents load that file, never `.env.api`, so no agent process holds a role token.

- **The negotiator never sees the maximum price.** No response to its token contains it.
- **A supplier sees only its own thread, quote and deals.** Anything else answers `404`, the same as a missing resource.
- **Chat moves no money.** Only a committed quote, the lead's decision and the signer's checks lead to a lock.
- **A sourcing deal pays only on the inspector's second key.** Surety Verify releases it only when the inspector's attestation is `attested` and its B/L number matches the supplier's documents. The inspector token is never given to an agent, and no response to it contains the B/L number the supplier submitted.

## Errors

Every error is `{ "error": "<code>", "message": "<text>" }`.

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | Not JSON, over 16 KB, or a field fails validation (`message` names it) |
| 400 | `refused` | Surety refuses on its terms: a buyer that isn't the treasury, a total too large, no committed quote |
| 401 | `unauthenticated` | Missing or unknown token |
| 403 | `forbidden` | The token's role may not use this route |
| 403 | `supplier_out` | The supplier has one red card or two yellow cards in this sourcing |
| 429 | `too_many_messages` | The supplier has sent 20 messages in this sourcing, delivered or held |
| 404 | `not_found` | No such resource, or one that belongs to another supplier |
| 409 | `closed` | The sourcing is no longer open, or its negotiation time is over, or the deal can no longer take an attestation |
| 409 | `conflict` | A different quote or attestation is already recorded, the supplier already has a deal, the sourcing is claimed by another deal, or the deal isn't in a state for this |
| 500 | `internal_error` | Anything else; no detail is returned |

## Money and ids

Money is integer US cents (`11400` is $114.00), settled on the ledger as TESTUSD. Ids are UUIDs. Times are ISO 8601.

## The buyer's routes

### `POST /sourcing` (lead)

Opens a sourcing from the buyer's brief.

```json
{
  "buyer": { "name": "Karoo Solar Imports (Pty) Ltd", "address": "<treasury wallet>" },
  "goods": { "description": "Monocrystalline solar panel 550 W", "quantity": 400, "targetUnitCents": 11000, "maxUnitCents": 12000 },
  "incoterm": "CIF",
  "port": "Durban",
  "deadlineSeconds": 300,
  "negotiationSeconds": 90,
  "priority": "balanced",
  "latestDeliveryDays": 30
}
```

- **Returns:** the sourcing `{ id, ref, state: "OPEN", brief, negotiationEndsAt, ... }`.
- `deadlineSeconds` is the deal's refund deadline once a quote is accepted, by ledger time. `negotiationSeconds` is how long the chat stays open.
- `priority` is what the buyer cares about most: `price`, `speed` or `balanced` (the default). `latestDeliveryDays` (optional, 1 to 365) is the slowest delivery the buyer accepts.

### `GET /sourcing/:id` (lead, view, sourcing, negotiator)

- **For lead and view:** the full view, `{ brief (with maxUnitCents), invites: [{ address, name, status, cards: { yellow, red }, quote, deliveryDays, dealId }], ranking: [{ supplier, unitCents, deliveryDays, eligible, why }], reports: [{ supplier, offer, summary } or { supplier, offer, withheld: true }], suggestions, secondsLeft, state, dealId }`.
- **The ranking** orders committed quotes for the priority: `price` by price then days, `speed` by days then price, `balanced` by price relative to the cheapest plus days relative to the fastest. A quote that is out, above the maximum, without days or slower than `latestDeliveryDays` is ranked last with its reason. The lead may accept another; Surety then records a deal event `off_priority` with the best quote, the chosen one and the lead's reason. It never blocks.
- **For sourcing and negotiator:** `{ goods: { description, quantity, targetUnitCents }, incoterm, port, priority, latestDeliveryDays, secondsLeft, invites: [{ address, name, status, committed }], offers: [{ supplier, unitCents, deliveryDays, source, at }] }`, with no maximum and no ranking. `offers` holds each supplier's committed quote, or else its latest report whose summary was delivered: the competing offers the negotiator may cite, anonymised. A withheld report, a held message or an out supplier never appears, and nothing in it is derived from the maximum.

### `GET /sourcing` (lead, view)

The 20 newest sourcings: `[{ id, ref, state, goods, quantity, incoterm, port, negotiationEndsAt, dealId, createdAt }]`. No prices.

### `GET /sourcing/:id/record` (view)

The operator's record of one sourcing, for the web app. It has the same shape as `evidence/sourcing-*.json`, so a live run and a recorded run render with the same code:

- `sourcing` (with the full brief), `invites` (status, cards, committed quote), `suggestions`
- `messages`: every message with its bouncer result, **held messages in full**
- `invites` also carry `deliveryDays`; `ranking` is Surety's ordering of the committed quotes for the buyer's priority
- `deals` with their decision and events, `job`, `verify` (outcome, scores, rules)
- `inspection`: `null` for a deal that needs no inspector, `{ state: "pending" }` until the inspector answers, then `{ state, inspector, blNumber, note, at }`
- `events`: the job's state changes as `[{ at, actor, from, to, reasonCodes }]`, and `notes`: deal events that change no state, such as a choice against the priority
- `create`, `finish`, `cancel`: the validated ledger transactions with explorer links, or `null`
- `policy`: the signer's live limits, policy version and approved suppliers with their hold status
- `treasuryCents` and `checks` are `null`: only the evidence script reads the ledger for them

Read-only: it reads the database and the signer's health, never the ledger or the decision model. Because it carries held messages and the maximum price, every role except `view` gets `403`.

### `POST /demo/start` (view)

The big screen's Start button. It opens nothing itself: it hands the Lead agent its task in Paperclip, and the Lead opens the sourcing with `POST /sourcing` and its own token. Body, all six required and nothing else:

```json
{ "quantity": 400, "targetUnitCents": 11000, "maxUnitCents": 12000, "priority": "balanced", "latestDeliveryDays": 30, "negotiationSeconds": 180 }
```

The API adds the rest of the order (Karoo Solar Imports, monocrystalline solar panel 550 W, CIF Durban, the treasury wallet from the signer, and a refund deadline of `API_DEMO_DEADLINE_SECONDS`, default 420). Returns `{ "started": true }`.

- `404 not_found` unless the API was started with `PAPERCLIP_COMPANY_ID` and `PAPERCLIP_LEAD_AGENT_ID` (both UUIDs). The task is created with `paperclipai issue create` inside WSL.
- `409 conflict` while a sourcing is `OPEN`, or within 120 seconds of the last start.
- `502 start_failed` when the task could not be created.

The view token is otherwise read-only. This is its one action, and it moves no money: every limit still sits with the signer.

### `GET /suppliers` (lead, sourcing)

The approved suppliers: `[{ address, name, onHold }]`. A supplier is on hold after any card until the operator clears it (`pnpm supplier:clear`).

### `POST /sourcing/:id/invites` (sourcing)

- **Body:** `{ "address": "<wallet>" }`.
- **Returns:** `{ invited: true, invite }` or `{ invited: false, reason: "not_approved" | "on_hold" | "closed" }`.

### `POST /sourcing/:id/suggestions` (sourcing)

Suggests a supplier that isn't approved, for the operator to consider. Only the operator can approve one.

- **Body:** `{ "name": "...", "address": "<wallet>", "reason": "..." }`.

### `GET /sourcing/:id/inbox` (negotiator)

The negotiator's messages and every delivered supplier message, oldest first:

- `{ supplier, kind: "to_supplier" | "from_supplier", text, at }`
- `{ supplier, kind: "from_supplier", withheld: true, card, at }` for a message the bouncer held. Its text is never shown.

### `POST /sourcing/:id/messages` (negotiator)

- **Body:** `{ "supplier": "<wallet>", "text": "..." }`, up to 1000 characters.
- A message that names another invited supplier (its wallet, or a distinctive word of its name) is refused with `400 refused` and stored nowhere, so leverage stays anonymous.

### `POST /sourcing/:id/reports` (negotiator)

The negotiator's report to the lead: facts, plus a short summary that the bouncer screens too.

- **Body:** `{ "supplier": "<wallet>", "unitCents": 11400, "quantity": 400, "deliveryDays": 21, "summary": "..." }`.

### `POST /sourcing/:id/select` (lead)

Opens a deal for a supplier's committed quote. This runs the Policy step and the quote checks against the brief and the live policy.

- **Body:** `{ "supplier": "<wallet>" }`.
- **Returns:** the deal, `QUOTE_RECEIVED`, or `POLICY_REFUSED` with its reasons in the deal events.

### `POST /deals/:id/decision` (lead)

The lead's accept or decline, with a reason.

- **Body:** `{ "outcome": "accept" | "decline", "reason": "..." }`.
- **Returns:** `{ deal, job }`.
- **On accept:** Surety re-checks the quote and an accept that breaks the brief or the policy is overruled. Otherwise the signer locks the payment: `job.state` is `LOCKED`.
- **On decline or an overruled accept:** the sourcing stays open for another supplier.

### `GET /deals/:id` (lead, view)

`{ deal, events, job: { id, ref, state, amount, sellerAddress }, decision, inspection }`. `inspection` is `null` for a deal that needs no inspector, `{ state: "pending" }` until the inspector answers, then `{ state: "attested" | "refused", inspector, blNumber, note, at }`.

### `GET /operator/quarantine` (view)

The 50 most recent held messages across sourcings, with their cards and bouncer scores.

## The inspector's routes (inspector token)

The inspector is a person, for example at the port of loading, holding the second key. A sourcing deal is paid only after the inspector reads the bill of lading number off the shipment and attests it. These routes are not in the agents' instructions.

### `GET /inspector/deals`

Funded sourcing deals still waiting for an answer: `[{ dealId, poNumber, goods, quantity, incoterm, port, supplierName, jobState }]`. It never shows the B/L number, prices or wallets, so the inspector's reading is independent of the supplier's.

### `POST /inspector/deals/:id/attestation`

Body `{ blNumber, outcome: "attested" | "refused", note }` (B/L number 1 to 120 characters, note at most 280). Returns the inspection `{ state, inspector, blNumber, note, at }`. One answer per deal and no corrections: the same answer again returns it, a different one is `409 conflict`. Once the deal is being judged or has ended it is `409 closed`. A deal that isn't a funded sourcing deal is `404`. The note is display text only and never reaches a model.

Surety Verify then decides: a matching `attested` number lets the deal be judged and paid; a refusal or a different number fails the rule `attested` and the deal refunds at the deadline. With no answer by the decision cutoff (30 seconds before the deadline, by ledger time) the deal is held and refunds.

From the terminal: `pnpm inspector:attest` lists the queue; `pnpm inspector:attest <dealId> <blNumber> attested "400 cartons counted, seal intact"` answers.

## The supplier's routes (supplier token)

### `GET /supplier/sourcing`

The sourcings this supplier is invited to: `[{ sourcingId, ref, state, goods, quantity, incoterm, port, negotiationEndsAt, committed, committedQuote, dealId }]`. `committedQuote` is this supplier's own `{ unitCents, deliveryDays }` once committed, otherwise `null`.

### `GET /supplier/sourcing/:id/thread`

This supplier's conversation: `[{ kind, text, delivered?, card?, at }]`. It shows whether each of its messages was delivered.

### `POST /supplier/sourcing/:id/messages`

- **Body:** `{ "text": "..." }`.
- **Returns:** `{ delivered, card: null | "yellow" | "red", status: "in" | "out" }`.
- **What the bouncer does:**
  - A wallet other than the supplier's own, or bank details, is a red card.
  - A message that steers the buyer's agent is a yellow card.
  - Links are stripped.

### `POST /supplier/sourcing/:id/quote`

The binding quote form.

- **Body:** `{ "quoteNumber": "Q-88213", "quantity": 400, "unitCents": 11400, "incoterm": "CIF", "port": "Durban", "deliveryDays": 21, "notes": "..." }`. `deliveryDays` (1 to 365) is required. It is stored beside the quote, so the deal's quote and its hash are unchanged; the same price with different days is a `409 conflict`.
- **What Surety fills in:** the wallet is the supplier's approved one and the total is computed. Notes are screened like a message.

### `GET /supplier/deals`

This supplier's deals: `[{ dealId, ref, sourcingId, state, jobState }]`. A `jobState` of `LOCKED` means the payment is locked for it: ship.

### `GET /supplier/deals/:id/settlement`

The pre-filled settlement form: `{ fixed: { invoice, billOfLading }, suggested: { invoiceNumber, remarks } }`.

### `POST /supplier/deals/:id/settlement`

- **Body:** `{ "invoiceNumber": "...", "blNumber": "...", "vessel": "...", "portOfLoading": "...", "remarks": { "invoice": "...", "billOfLading": "..." } }`.
- **What happens:** Surety renders the commercial invoice and bill of lading from the deal plus these fields. Surety Verify then pays the supplier or refunds the buyer.
- **Attack lab only:** `edits` (`payTo`, `invoiceQuantity`, `blQuantity`, `unitCents`, `totalCents`) tampers with the documents, and the rules catch every one.

## `GET /health`

`{ "ok": true }`, no token needed.
