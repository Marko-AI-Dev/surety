# Surety UI direction (v2)

9 Nov 2026. Playground: `surety-ui-v2.html` (single-file Artifact, unpublished). Method: Impeccable audit, critique (two independent agents) and shape. Nobody could be interviewed, so the calls are mine (section 7).

## 1. Audit of v1

Design health 23/40 (Nielsen). Technical audit 11/20.

| # | Finding | v2 response |
|---|---|---|
| P1 | **The money never moves.** A linear stepper fits any CI dashboard. Failure only recolours the same line, and a refund lands on "Settled". | An interlocking board where the 1 XRP coin travels buyer → vault → seller, or back through a refund door. |
| P1 | **Phone runs play off-screen**, about 950 px below Run. The payoff hides behind a blurred modal receipt. | A one-screen stage; each run dollies to the board. The verdict lands in place, and the receipt is a pane. |
| P1 | **Operator limits are decorative.** The daily cap is never enforced, the allowlist is read-only and the cap refusal is hidden. | A working cap, an allowlist switch and the daily cap (planned). "Over the cap" is a one-click outcome. |
| P1 | **Contrast and targets.** `--ink-3` measures 3.4 to 4.1:1; chips are 35 px tall. | `--ink-3` is #97a3a0 (4.5:1 or better) and every target is at least 44 px. |
| P2 | **Honesty.** A green "XRPL Testnet" dot implies a live connection; all refunds share one hash. | An amber "Simulated · real testnet examples" pill and a distinct real transaction per scenario. |
| P2 | **Bare numbers.** Jev scores are shown with no thresholds, the clock never stops and the final row reads PASS. | Jev gauges with threshold ticks, a clock that stops, and outcome stamps. |

Kept: the trail copy, expiry countdown, honest footnotes and reduced motion.

## 2. Two modes

A capsule toggle switches between **My jobs** (the business owner) and **Control room** (the operator).

| My jobs | Control room |
|---|---|
| **Post**: the job, budget in XRP with an illustrative Rand line, the six gates, an amber "Post job and lock 1 XRP" | **Limits**: per-job cap with live allowed or refused verdicts, daily cap (planned), allowlist switch, agent rights, change log |
| **Progress**: "Where is my money?", a plain status sentence, the board with plain captions, a location chip | **Pipeline**: the same board with data captions, plus a signal sheet (evidence, hashes, Jev gauges) |
| **Receipt**: verdict, stamp, Why row, ledger links, earlier runs as stubs | **Trail**: append-only events showing from → to, actor and reason code |
| **Spend**: held, paid, returned, fees and spent; Rand / Dollar / XRP-only switch; today's limit | **Health**: signer, worker, Jev and ledger lamps, the reconciliation queue with a refund countdown, counters, the real restart drill |

The sections are index-matched (Post↔Limits, Progress↔Pipeline, Receipt↔Trail, Spend↔Health), so switching mode turns the same pane around. A run continues across the switch.

## 3. Spatial system and motion

- **One glass pane per section**, stacked in depth, with the next two panes peeking above the front one. Only the front pane gets backdrop blur.
- **Primary transition: depth dolly.** Going deeper flies the front pane past the viewer as the next one rises (740 ms, ease-out); going back reverses it. It is chosen over a lateral swipe for three reasons:
  - depth is the product's metaphor, going deeper into the vault;
  - the stack shows how many sections remain;
  - swipes read as carousels and fight the board's horizontal route.
- **Mode switch: a half turn.** The pane goes edge-on, swaps face and returns (260 ms in, 500 ms out). The Control room is the back of the glass.
- **Inner parallax.** The front pane tilts toward the cursor (±3.5° by ±5°, damped). Three content layers drift 2, 4 and 7 px, board labels float above the tracks, and the edge light slides with the tilt.
- **The one authored moment:** the points throw and the coin runs the route that has been set.
- **Reduced motion:** no 3D, tilt or parallax. Panes crossfade, the coin jumps between stations, and the timeline and countdown stay.

## 4. Pipeline concept

I ranked seven structures; Impeccable's concept seed (key `6ba711f5`) dealt three.

- **A. Interlocking (chosen).** A railway signal-box panel drawn in glass.
  - Signals stand in numbered order: 1 Limits, 2 Vault, 3 Delivered, 4 Rules, 5 Jev, 6 Signer.
  - The work arrives on a dashed line.
  - The points beside the vault lie toward refund by default, and only three green signals throw them to the seller.
  - Failure has its own line: the coin takes the siding to a refund door ringed by the CancelAfter clock, then returns to the buyer.
  - A dark signal means stop. That is real railway practice and exactly fail-closed.
  - A cap refusal stops the coin at signal 1.
  - Pitch line: "The points lie toward refund."
- **B. Ledger dial.** The escrow window as a clock face, with checks as arcs. Time reads clearly, but the money's direction is implicit and arc text fails at 400 px. Its discipline is kept: the refund clock starts at lock, so a pass visibly beats it.
- **C. Referee's cards.** Yellow or red cards per check. Literal, trivialises money, blurs order. Declined.

Two catalog challengers lent a discipline each:

- **Orienteering map:** gold is reserved for the money's active leg.
- **Ticket wallet:** outcomes stamp, and nothing disappears.

Horizontal from 860 px of board width (700 px in the Control room), vertical below.

## 5. Components for the React build

- **Shell:** `AppShell`, `ModeToggle`, `SectionTabs` (ARIA tablist), `DepthDeck`, `GlassPane`, `OutcomeDock`, `useTilt`, `useParallaxLayer`.
- **Board:** `RouteBoard` (SVG plus HTML labels, with H and V geometry tables), `SignalLamp`, `RefundDoor`, `Points`, `CoinToken`, `WorkToken`, and `useRouteModel`, a pure reducer from `job_events` to board state.
- **Panels:** `StatusLine`, `MoneyChip`, `SignalSheet`, `JevGauge`, `TrailList`, `ReceiptCard`, `Stamp`, `SpendStatement`, `CurrencySwitch`, `LimitSlider`, `AllowlistSwitch`, `HealthLamps` and `ReconciliationQueue`.
- **Tokens:** one `tokens.css` with every colour defined on `:root`.

## 6. Cut for a 3-day hackathon

- **Keep:** RouteBoard, both modes, Progress, Pipeline, Receipt, Limits and Trail, fed by real `job_events`.
- **Stub:**
  - Spend: held, paid and returned only.
  - The currency switch: a fixed Rand line instead.
  - Health: three lamps.
  - Receipt stubs.
  - The queue UI, unless a job freezes.
  - Ghost panes and tilt on phones.
- **Never cut:** the refund line, the simulated labels, contrast, keyboard focus and the reduced-motion fallback.

## 7. Assumptions to confirm

1. The mode names "My jobs" and "Control room".
2. An illustrative fixed rate of 1 XRP = R40.00 or $2.20, labelled simulated. A live feed is design space only.
3. Real 8 Nov transactions mapped to scenarios as labelled examples. Wrong total uses spike run 2 and evaluator down uses the restart run.
4. The daily cap is shown as planned; only the per-job cap and the allowlist are proven in the signer.
5. "Over the cap" tries the cap plus 1 XRP.
6. A signer refusal is logged as CREATE_PENDING → CREATE_FAILED.
7. Not run, because the brief allowed only two files: Impeccable's finish reviewer, DESIGN.md and a surface brief.
