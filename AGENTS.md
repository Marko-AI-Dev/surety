# AGENTS.md: rules for everyone who builds here (humans and AI agents)

Surety is escrow for import purchases: a buyer's AI agents find suppliers and negotiate, the buyer gives the final yes, and the payment is locked on the XRP Ledger until the paperwork passes and an inspector confirms the shipment.

- What changed recently and why, for anyone arriving without the history: the newest `docs/handover-*.md`.
- What it is for and its constraints: `PRODUCT.md`.
- Where the product is going, in Marko's words: `docs/product-vision.md`. Where the two differ, the vision is newer.
- The design system: `DESIGN.md`.
- The API: `docs/api.md`. The architecture: `docs/architecture.md`.

Read this file at the start of every session. If a rule here is wrong or out of date, say so and propose the change; do not work around it.

## Non-negotiables

1. **Testnet only.** XRPL Testnet and TESTUSD, a self-issued test dollar with no value. Anything simulated or not yet real is labelled as such on screen.
2. **Secrets never in code, chat, commits or logs.** Keys never leave `services/signer`; `pnpm check:boundaries` enforces it. API tokens stay server side: the browser reaches the API only through the dev proxy (`apps/web/src/data/proxy-policy.ts`), which adds the view token for this machine's own page and nothing else.
3. **The money path is guarded.** The signer, escrow, settlement, the bouncer's rules and the approval gate change only with tests, and the pull request says so in its first lines. Nothing locks before the buyer's yes, and a no moves nothing. Nothing pays without a validated ledger result.
4. **The record is not rewritten.** Never change anything under `evidence/`. Never edit an existing migration; a schema change is a new file in `supabase/migrations/`.
5. **Never weaken a test to make it pass.** When an expectation has to change, change it on purpose and list it in the pull request with the reason.
6. **Fail closed.** A missing or invalid required value stops the action with a plain message. Never a silent fallback. If the decision model is unavailable, nothing pays.
7. **Synthetic data only** in code, fixtures, seeds, screenshots and logs. Never invent customers, prices, volumes, testimonials or cost figures without a cited source.
8. **A held message stays held.** The text of a message the bouncer stopped never reaches an agent, a model or the buyer's screen. It appears only as held, with its card and reason codes.
9. **What the agents may know.** The negotiator never receives the buyer's maximum price, in views, prompts or helpers. A message to one supplier never names another.
10. **Words.** The user-facing word is "Deal", never "Job" or "Lot". The decision model's vendor is never named in the app. Never call the decision model deterministic.

## How to work

- **Diagnose, report, get approval, then build.** Never build a feature Marko did not ask for.
- **Plan first.** Anything bigger than a fix starts from a short written plan in `docs/plans/` (older plans are in `docs/superpowers/plans/`). Build it task by task.
- **Screens before logic (the UI gate).** Build the screen with sample data first (a recording from `evidence/`, or a scripted backend). Marko approves it, then the logic is wired in.
- **Test first for logic.** Write the failing test, watch it fail, then write the smallest code that passes.
- **`pnpm check` must pass before every commit.** It runs the typecheck, the unit tests, the key boundary check and the web build.
- **Verify before claiming done.** Run the command, read its output, then say it passed. In every report keep "verified by running" apart from "read in the code", and say what was not verified.
- **Small commits, one change each.** Work on a branch and open a pull request. Never push to `main`. The agent that builds may merge its own pull request once `pnpm check` passes (Marko, 13 Nov 2026). The exception is the money path (non-negotiable 3): a change there waits for a separate review before it merges. A merge is not a live test: say in the pull request what has not been run on the live backend. Nothing is deployed without Marko's go-ahead.
- **Plain, calm writing**, on screen and in reports. Short sentences, no long dashes, no jargon a new reader would not know. One primary action per screen. A disabled button says why.

## Where things are

- `packages/contracts`: the schemas every request is checked against. `packages/workflow`: the rules of a sourcing and a deal, and the only code that talks to the database (`*-repo.ts`). `packages/gate`: the bouncer and the decision engine. `packages/signer-client`, `packages/xrpl-settlement`: the ledger side.
- `services/signer`: the only place keys exist. `services/api`: the only door for agents, suppliers and the screens. `services/worker`: expiry and settlement. `services/supplier-agents`: the demo supplier companies.
- `agents/paperclip`: the Lead's, Sourcing's and Negotiator's instructions and the negotiator's helper. The live agents run from a copy made by `pnpm paperclip:team`, so a change here is not live until that is run again.
- `apps/web`: the screens. `src/views` are the screens, `src/data` works everything out from the record and is tested without a browser, `src/components/ui` is the UI kit.

## Being adopted (not true of all the code yet)

These are the target. New work follows them; older code is moved over step by step, with Marko's approval for each move.

- **The kit rule.** New UI is built from `apps/web/src/components/ui` and the tokens in `DESIGN.md`: no raw colours and no one-off font sizes. The older screens still style themselves in `apps/web/src/styles.css`. There is no test for this yet.
- **Module boundaries in the web app.** Screens should not call the API themselves; that belongs in `src/data`. Several older screens still do.
- **Browser tests** for the main flows, accessibility and visual baselines. None are in the repo yet.
- **AI journey testing** (an AI agent uses the running app like a new user, with a check against the record). Set up for the buyer's chat: `journeys/surety_journeys.py`, against `pnpm practice` only, reports in `journeys/runs/`. See `docs/plans/2026-11-13-journeys.md`. It is not part of `pnpm check`. Every newly shipped feature gets a journey; the older screens have none yet.
