import type { QuoteForm } from "@surety/contracts";
import type { Persona } from "./personas";

// A supplier's next move in one sourcing, decided by code from its persona, its own state and the
// thread (Phase 4d: several rounds). It beats a competing price by a step above its floor, trades price
// for delivery days (slower for less, faster for more, each once), counters an ask half way at most
// twice, and holds at its floor. It commits when asked for a final offer or with 15 seconds left; the
// crook plays its script first. Wording may come from a model; prices and days never do.

export interface ThreadItem {
  kind: "to_supplier" | "from_supplier";
  text: string;
  delivered?: boolean;
  card?: string | null;
  at: string;
}

export interface AgentState {
  // The current offer: null until the opening price.
  priceCents: number | null;
  deliveryDays: number | null;
  counters: number;
  traded: { slow: boolean; rush: boolean };
  scriptIndex: number;
  committed: boolean;
}

export const initialState = (): AgentState => ({
  priceCents: null,
  deliveryDays: null,
  counters: 0,
  traded: { slow: false, rush: false },
  scriptIndex: 0,
  committed: false,
});

export type SayMove = { unitCents: number; deliveryDays: number; intent: "open" | "counter" | "beat" | "trade" | "hold" | "final" };
export type Move = { say: SayMove } | { commit: QuoteForm } | { script: string };

export interface Order {
  quantity: number;
  incoterm: QuoteForm["incoterm"];
  port: string;
}

// The demo order, used when the caller doesn't pass the sourcing's own.
export const DEMO_ORDER: Order = { quantity: 400, incoterm: "CIF", port: "Durban" };

export const COMMIT_SECONDS = 15;
export const MAX_COUNTERS = 2;

const quoteNumber = (p: Persona) => `Q-${p.key.slice(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase().slice(-6)}`;

export interface Leverage {
  competitorCents?: number;
  competitorDays?: number;
  askCents?: number;
  askDays?: number;
  wantsFaster: boolean;
  final: boolean;
}

const AMOUNT = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\bUSD\s?(\d[\d,]*(?:\.\d{1,2})?)|\b(\d[\d,]*(?:\.\d{1,2})?)\s?USD\b/i;
const DAYS = /\b(\d{1,3})\s?-?\s?days?\b/i;
const COMPETITOR = /\banother\b|\bother supplier|\bcompeting\b|\bcompetitor|\boffered\b/i;
const FASTER = /\bfaster\b|\bsooner\b|\bquicker\b|\bearlier\b/i;
const cents = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);

// What a negotiator's message says, by sentence: a sentence about another supplier gives the competing
// price and days; any other sentence gives the buyer's ask.
export function readLeverage(text: string): Leverage {
  const out: Leverage = { wantsFaster: FASTER.test(text), final: /\bfinal\b/i.test(text) };
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const amount = AMOUNT.exec(sentence);
    const value = amount ? cents(amount[1] ?? amount[2] ?? amount[3] ?? "") : undefined;
    const days = DAYS.exec(sentence);
    const dayValue = days ? Number(days[1]) : undefined;
    if (COMPETITOR.test(sentence)) {
      out.competitorCents ??= value;
      out.competitorDays ??= dayValue;
    } else {
      out.askCents ??= value;
      out.askDays ??= dayValue;
    }
  }
  return out;
}

const wholeDollars = (c: number) => Math.round(c / 100) * 100;

export function nextMove(
  persona: Persona,
  state: AgentState,
  thread: ThreadItem[],
  secondsLeft: number,
  order: Order = DEMO_ORDER,
): { move: Move; state: AgentState } | null {
  if (state.committed) return null;
  const price = state.priceCents ?? persona.openingUnitCents;
  const days = state.deliveryDays ?? persona.deliveryDays;
  const commit = (): { move: Move; state: AgentState } => ({
    move: { commit: { quoteNumber: quoteNumber(persona), quantity: order.quantity, unitCents: price, incoterm: order.incoterm, port: order.port, deliveryDays: days, notes: "" } },
    state: { ...state, priceCents: price, deliveryDays: days, committed: true },
  });
  // The crook commits only once it has played its whole script (and so been carded): a crook nobody
  // talked to never slips in an unscreened cheap quote for the lead to pick.
  const scriptPlayed = !persona.script || state.scriptIndex >= persona.script.length;
  if (secondsLeft <= COMMIT_SECONDS) return scriptPlayed ? commit() : null;

  const last = thread.at(-1);
  if (!last || last.kind !== "to_supplier") return null;

  if (persona.script && state.scriptIndex < persona.script.length) {
    const line = persona.script[state.scriptIndex] ?? "";
    return { move: { script: line }, state: { ...state, priceCents: price, deliveryDays: days, scriptIndex: state.scriptIndex + 1 } };
  }

  const say = (unitCents: number, deliveryDays: number, intent: SayMove["intent"], next: Partial<AgentState> = {}) => ({
    move: { say: { unitCents, deliveryDays, intent } } as Move,
    state: { ...state, ...next, priceCents: unitCents, deliveryDays },
  });
  if (state.priceCents === null) return say(persona.openingUnitCents, persona.deliveryDays, "open");

  const lev = readLeverage(last.text);
  if (lev.final) return commit();

  const floor = persona.floorUnitCents;
  const standard = persona.deliveryDays;
  const step = persona.stepCents;

  // 1. A competing price below ours: beat it by a step, meet it at the floor, or trade for slower
  //    delivery once; after that, hold at the floor.
  const c = lev.competitorCents;
  if (c !== undefined && c < price) {
    if (c - step >= floor) return say(c - step, standard, "beat");
    if (c >= floor) return floor < price ? say(floor, standard, "beat") : say(price, days, "hold");
    if (persona.slow && !state.traded.slow) {
      return say(floor - persona.slow.discountCents, persona.slow.days, "trade", { traded: { ...state.traded, slow: true } });
    }
    return say(floor, standard, "hold");
  }

  // 2. The buyer wants it sooner (or a competitor is faster): the rush option, once.
  const fasterWanted = lev.wantsFaster || (lev.competitorDays ?? Number.POSITIVE_INFINITY) < days || (lev.askDays ?? Number.POSITIVE_INFINITY) < days;
  if (fasterWanted && persona.rush && !state.traded.rush) {
    const base = days === standard ? price : floor;
    return say(base + persona.rush.premiumCents, persona.rush.days, "trade", { traded: { ...state.traded, rush: true } });
  }

  // 3. Any other push: counter half way toward the ask (never below the floor), at most twice.
  if (lev.askCents !== undefined && lev.askCents >= price) return say(price, days, "hold");
  const target = Math.max(lev.askCents ?? floor, floor);
  if (state.counters < MAX_COUNTERS && price > target) {
    const halfway = Math.max(target, wholeDollars((price + target) / 2));
    const counter = halfway < price ? halfway : target;
    return say(counter, days, "counter", { counters: state.counters + 1 });
  }
  return say(price, days, "hold");
}
