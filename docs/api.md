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
| `supplier` | One supplier wallet per token | `API_SUPPLIER_TOKENS` (JSON: address to token) |

`pnpm api:tokens` writes all of them to `.env.api`, which is gitignored and never printed.

- **The negotiator never sees the maximum price.** No response to its token contains it.
- **A supplier sees only its own thread, quote and deals.** Anything else answers `404`, the same as a missing resource.
- **Chat moves no money.** Only a committed quote, the lead's decision and the signer's checks lead to a lock.

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
| 409 | `closed` | The sourcing is no longer open, or its negotiation time is over |
| 409 | `conflict` | A different quote is already committed, the supplier already has a deal, the sourcing is claimed by another deal, or the deal isn't in a state for this |
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
  "negotiationSeconds": 90
}
```

- **Returns:** the sourcing `{ id, ref, state: "OPEN", brief, negotiationEndsAt, ... }`.
- `deadlineSeconds` is the deal's refund deadline once a quote is accepted, by ledger time. `negotiationSeconds` is how long the chat stays open.

### `GET /sourcing/:id` (lead, view, sourcing, negotiator)

- **For lead and view:** the full view, `{ brief (with maxUnitCents), invites: [{ address, name, status, cards: { yellow, red }, quote, dealId }], reports: [{ supplier, offer, summary } or { supplier, offer, withheld: true }], suggestions, secondsLeft, state, dealId }`.
- **For sourcing and negotiator:** `{ goods: { description, quantity, targetUnitCents }, incoterm, port, secondsLeft, invites: [{ address, name, status, committed }] }`, with no maximum and no committed prices.

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

`{ deal, events, job: { id, ref, state, amount, sellerAddress }, decision }`.

### `GET /operator/quarantine` (view)

The 50 most recent held messages across sourcings, with their cards and bouncer scores.

## The supplier's routes (supplier token)

### `GET /supplier/sourcing`

The sourcings this supplier is invited to: `[{ sourcingId, ref, state, goods, quantity, incoterm, port, negotiationEndsAt, committed, dealId }]`.

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

- **Body:** `{ "quoteNumber": "Q-88213", "quantity": 400, "unitCents": 11400, "incoterm": "CIF", "port": "Durban", "notes": "..." }`.
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
