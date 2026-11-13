# Round 2 screens: menu, chat and deal rail; admin audit

13 Nov 2026. The screens were approved by Marko on the design playground first (the UI gate): round 2 there mixed Buyer B's deal rail with Buyer C's left menu, and Admin A's side menu with Admin B's audit by stage.

## What is built

**Buyer (`#/`)**
- A menu down the left on a wide screen, grouped under Buying, Control and Records, each item with an icon (`apps/web/src/components/SideNav.tsx`). Below 1024px it is hidden and the bar across the top takes over.
- The chat in the middle, unchanged in how it works.
- The deal on the right as six steps in the order they happen, only the current one open (`DealRail` in `views/Chat.tsx`). Below 1280px it is hidden and the supplier chips come back.
- "Search or do something, Ctrl K": a quick-actions window (bring me what you have, approve every message first, open a supplier's conversation, and so on).
- **One sentence is enough to start.** What matters most and how hard to push are assumed (a balance, firmly), shown as chips the buyer can tap to change, and the start button follows the first complete sentence. Three starter sentences sit on the empty screen so it never shows a dead end.
- The main buttons change their words on hover to what pressing them gets you, and a paper plane flies in a loop (off under reduced motion).

**Admin (`#/admin`)**
- The same side menu, grouped under Records, Controls and Testing.
- "What happened" is now the audit (`views/Audit.tsx`): where the money went, then the six stages as accordions with their facts, their own events and the ledger proof. A switch shows the same events as one timeline.

**Data, tested without a screen**
- `apps/web/src/data/audit.ts`: `dealSteps`, `currentStep`, `auditStages`. The buyer's rail and the admin's audit read the same six steps, so they cannot disagree.
- Every log entry now says which stage it belongs to.
- `services/api/src/intake.ts`: `ASKED`, `ASSUMED`, and `assumed` in the answer.

## Left out on purpose

The playground's menu also had "My purchases", "Suppliers" and "Spending limits". "Suppliers and limits" is built as one read-only panel from data the record already carries. "My purchases" (a list of past purchases you can open) is not built: it needs the app to open a chosen purchase, which it cannot do yet. It is not in the menu, so nothing in the menu is a dead end.

## Result on the journeys

`journeys/runs/20261113-2019.md`, practice backend, laptop size:

| Journey | Before | Now | Actions now |
|---|---|---|---|
| Order solar panels | 0/3 | 3/3 | 7 |
| Order, knowing what matters | 0/3 | 3/3 | 7 |
| Say yes to the deal | 3/3 | 3/3 | 1 |
| Say no to the deal | 3/3 | 3/3 | 1 |
| Ask for the best offer now | 3/3 | 3/3 | 2 |
| Reword a message before it goes | 3/3 | 3/3 | 9 (was 4) |
| Approve every message first | 3/3 | 3/3 | 2 |

Rewording a message got slower for the agent (9 actions, was 4). It still passes every time. Worth a look: the waiting message now shows in the chat and is flagged in the rail, and the agent may be visiting both.

## Not covered

- Phone layout beyond "nothing overflows": the menu is simply hidden there, and the deal rail has no phone form.
- The live backend, Paperclip and the real chat model.
- A screen reader, and automated contrast checks.
