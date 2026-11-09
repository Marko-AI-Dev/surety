import { describe, expect, it } from "vitest";
import { type AgentState, type ThreadItem, nextMove } from "../src/negotiate";
import { PERSONAS } from "../src/personas";

const at = "2026-11-10T09:00:00.000Z";
const ask = (text: string): ThreadItem => ({ kind: "to_supplier", text, at });
const said = (text: string): ThreadItem => ({ kind: "from_supplier", text, delivered: true, card: null, at });
const fresh: AgentState = { priceCents: null, countered: false, scriptIndex: 0, committed: false };

describe("nextMove", () => {
  it("Brightway opens at $118.00, counters once to $114.00, never goes below $109.00", () => {
    const p = PERSONAS.brightway;
    const open = nextMove(p, fresh, [ask("What is your best price for 400 panels?")], 80);
    expect(open?.move).toEqual({ say: { unitCents: 11_800, deliveryDays: 21, intent: "open" } });
    const thread = [ask("What is your best price for 400 panels?"), said("$118.00"), ask("Can you do $105.00? We need a better price.")];
    const counter = nextMove(p, open!.state, thread, 60);
    expect(counter?.move).toEqual({ say: { unitCents: 11_400, deliveryDays: 21, intent: "counter" } });
    const again = nextMove(p, counter!.state, [...thread, said("$114.00"), ask("Lower please, $100.00?")], 40);
    expect(again?.move).toEqual({ say: { unitCents: 11_400, deliveryDays: 21, intent: "hold" } });
    expect(counter!.state.priceCents).toBeGreaterThanOrEqual(p.floorUnitCents);
  });

  it("counters once whatever words the negotiator uses for its target (the dry run said USD 110.00)", () => {
    const p = PERSONAS.brightway;
    const opened = { ...fresh, priceCents: 11_800 };
    const thread = [ask("Price?"), said("$118.00"), ask("Thank you. Could you meet our target unit price of USD 110.00 for 400 panels, CIF Durban?")];
    expect(nextMove(p, opened, thread, 60)?.move).toEqual({ say: { unitCents: 11_400, deliveryDays: 21, intent: "counter" } });
  });

  it("waits for the negotiator before saying anything, and doesn't answer twice", () => {
    expect(nextMove(PERSONAS.brightway, fresh, [], 80)).toBeNull();
    const s = { ...fresh, priceCents: 11_800 };
    expect(nextMove(PERSONAS.brightway, s, [ask("Price?"), said("$118.00")], 70)).toBeNull();
  });

  it("everyone commits with 15 s left", () => {
    for (const p of [PERSONAS.brightway, PERSONAS.sunpeak]) {
      const r = nextMove(p, { ...fresh, priceCents: p.openingUnitCents }, [ask("Price?"), said("x")], 15);
      expect(r?.move).toEqual({ commit: { quoteNumber: expect.stringMatching(/^Q-[A-Z0-9-]+$/), quantity: 400, unitCents: p.openingUnitCents, incoterm: "CIF", port: "Durban", notes: "" } });
      expect(r?.state.committed).toBe(true);
    }
    expect(nextMove(PERSONAS.brightway, { ...fresh, committed: true }, [ask("Price?")], 10)).toBeNull();
  });

  it("commits when the negotiator asks for a final offer", () => {
    const r = nextMove(PERSONAS.brightway, { ...fresh, priceCents: 11_400, countered: true }, [ask("Price?"), said("$114"), ask("Please send your final committed offer.")], 60);
    expect(r?.move).toMatchObject({ commit: { unitCents: 11_400 } });
  });

  it("Coastline never commits a quote unless it has played its script (final review)", () => {
    expect(nextMove(PERSONAS.coastline, fresh, [], 10)).toBeNull();
    expect(nextMove(PERSONAS.coastline, { ...fresh, scriptIndex: 1 }, [ask("Price?"), said("x")], 10)).toBeNull();
    expect(nextMove(PERSONAS.coastline, { ...fresh, scriptIndex: 2, priceCents: 10_400 }, [ask("x")], 10)?.move).toMatchObject({ commit: { unitCents: 10_400 } });
  });

  it("Coastline sends its two script lines in order", () => {
    const p = PERSONAS.coastline;
    const first = nextMove(p, fresh, [ask("Price?")], 80);
    expect(first?.move).toEqual({ script: p.script?.[0] });
    const second = nextMove(p, first!.state, [ask("Price?"), said("x"), ask("Anything else?")], 70);
    expect(second?.move).toEqual({ script: p.script?.[1] });
    expect(nextMove(p, second!.state, [ask("Price?"), said("x"), ask("y"), said("z"), ask("Hello?")], 60)?.move).toMatchObject({ say: { intent: "hold" } });
  });
});
