import type { QuoteForm } from "@surety/contracts";
import type { Persona } from "./personas";

// A supplier's next move in one sourcing, decided by code from its persona, its own state and the
// thread. One counter-offer, half way to its floor in whole dollars; a committed quote when the
// negotiator asks for a final offer or 15 seconds remain; the crook plays its script in order.

export interface ThreadItem {
  kind: "to_supplier" | "from_supplier";
  text: string;
  delivered?: boolean;
  card?: string | null;
  at: string;
}

export interface AgentState {
  priceCents: number | null;
  countered: boolean;
  scriptIndex: number;
  committed: boolean;
}

export type SayMove = { unitCents: number; deliveryDays: number; intent: "open" | "counter" | "hold" | "final" };
export type Move = { say: SayMove } | { commit: QuoteForm } | { script: string };

export interface Order {
  quantity: number;
  incoterm: QuoteForm["incoterm"];
  port: string;
}

// The demo order, used when the caller doesn't pass the sourcing's own.
export const DEMO_ORDER: Order = { quantity: 400, incoterm: "CIF", port: "Durban" };

export const COMMIT_SECONDS = 15;
const ASKS_FOR_LESS = /lower|better|discount|reduce|cheaper|best|\$\s?\d/i;

const quoteNumber = (p: Persona) => `Q-${p.key.slice(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase().slice(-6)}`;

export function nextMove(
  persona: Persona,
  state: AgentState,
  thread: ThreadItem[],
  secondsLeft: number,
  order: Order = DEMO_ORDER,
): { move: Move; state: AgentState } | null {
  if (state.committed) return null;
  const price = state.priceCents ?? persona.openingUnitCents;
  const commit = (): { move: Move; state: AgentState } => ({
    move: { commit: { quoteNumber: quoteNumber(persona), quantity: order.quantity, unitCents: price, incoterm: order.incoterm, port: order.port, notes: "" } },
    state: { ...state, priceCents: price, committed: true },
  });
  if (secondsLeft <= COMMIT_SECONDS) return commit();

  const last = thread.at(-1);
  if (!last || last.kind !== "to_supplier") return null;

  if (persona.script && state.scriptIndex < persona.script.length) {
    const line = persona.script[state.scriptIndex] ?? "";
    return { move: { script: line }, state: { ...state, priceCents: price, scriptIndex: state.scriptIndex + 1 } };
  }
  if (/final/i.test(last.text)) return commit();

  const say = (unitCents: number, intent: SayMove["intent"], countered = state.countered) => ({
    move: { say: { unitCents, deliveryDays: persona.deliveryDays, intent } } as Move,
    state: { ...state, priceCents: unitCents, countered },
  });
  if (state.priceCents === null) return say(persona.openingUnitCents, "open");
  if (!state.countered && ASKS_FOR_LESS.test(last.text)) {
    const halfway = Math.round((price + persona.floorUnitCents) / 2 / 100) * 100;
    return say(Math.max(persona.floorUnitCents, halfway), "counter", true);
  }
  return say(price, "hold");
}
