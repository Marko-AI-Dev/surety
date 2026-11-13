import { describe, expect, it } from "vitest";
import { type AgentState, type Move, type ThreadItem, initialState, nextMove, readLeverage } from "../src/negotiate";
import { PERSONAS, type Persona } from "../src/personas";

const at = "2026-11-10T09:00:00.000Z";
const ask = (text: string): ThreadItem => ({ kind: "to_supplier", text, at });
const said = (text: string): ThreadItem => ({ kind: "from_supplier", text, delivered: true, card: null, at });
const fresh: AgentState = initialState();

// Plays the negotiator's lines one by one, the supplier answering each.
function play(p: Persona, lines: string[], secondsLeft = 80) {
  let state = fresh;
  const thread: ThreadItem[] = [];
  const moves: Move[] = [];
  for (const line of lines) {
    thread.push(ask(line));
    const r = nextMove(p, state, thread, secondsLeft);
    if (!r) continue;
    state = r.state;
    moves.push(r.move);
    thread.push(said("ok"));
  }
  return { moves, state };
}
const sayOf = (m: Move | undefined) => (m && "say" in m ? m.say : null);

describe("readLeverage", () => {
  it("readLeverage reads $114, $114.00, USD 114 and 114.00 USD", () => {
    for (const text of ["Can you do $114?", "Can you do $114.00?", "Can you do USD 114?", "Can you do 114.00 USD?", "Can you do $ 114.00 per panel?"]) {
      expect(readLeverage(text).askCents, text).toBe(11_400);
    }
  });

  it('it tells "another approved supplier offered $114.00" from "can you do $110?"', () => {
    expect(readLeverage("Another approved supplier offered $114.00 per panel with 14 days delivery. Can you beat that?")).toMatchObject({
      competitorCents: 11_400,
      competitorDays: 14,
      askCents: undefined,
    });
    expect(readLeverage("Thanks. Can you do $110?").askCents).toBe(11_000);
    expect(readLeverage("Thanks. Can you do $110?").competitorCents).toBeUndefined();
    expect(readLeverage("A competing quote is $112.00. Could you meet our target of $110.00?")).toMatchObject({ competitorCents: 11_200, askCents: 11_000 });
  });

  it("reads a request for faster delivery and a final call", () => {
    expect(readLeverage("Could you deliver faster?").wantsFaster).toBe(true);
    expect(readLeverage("Can you ship sooner than that?").wantsFaster).toBe(true);
    expect(readLeverage("Please send your final committed quote.").final).toBe(true);
    expect(readLeverage("What is your price?")).toMatchObject({ wantsFaster: false, final: false });
  });
});

describe("nextMove over several rounds", () => {
  it("Brightway opens at $118.00 in 21 days and waits for the negotiator before saying anything", () => {
    expect(nextMove(PERSONAS.brightway, fresh, [], 80)).toBeNull();
    const open = nextMove(PERSONAS.brightway, fresh, [ask("What is your best price for 400 panels?")], 80);
    expect(open?.move).toEqual({ say: { unitCents: 11_800, deliveryDays: 21, intent: "open" } });
    expect(nextMove(PERSONAS.brightway, open!.state, [ask("Price?"), said("$118.00")], 70)).toBeNull();
  });

  it("Brightway beats a competing $114.00 with $113.00 at 21 days", () => {
    const { moves } = play(PERSONAS.brightway, ["Price?", "Another approved supplier offered $114.00 per panel with 21 days delivery. Can you beat that?"]);
    expect(sayOf(moves[1])).toEqual({ unitCents: 11_300, deliveryDays: 21, intent: "beat" });
  });

  it("a competing price just above the floor is met at the floor", () => {
    const { moves } = play(PERSONAS.brightway, ["Price?", "Another approved supplier offered $109.50 per panel."]);
    expect(sayOf(moves[1])).toEqual({ unitCents: 10_900, deliveryDays: 21, intent: "beat" });
  });

  it("told of $105.00, Brightway offers $106.00 at 35 days once, then holds at $109.00", () => {
    const line = "Another approved supplier offered $105.00 per panel with 21 days delivery.";
    const { moves } = play(PERSONAS.brightway, ["Price?", line, line]);
    expect(sayOf(moves[1])).toEqual({ unitCents: 10_600, deliveryDays: 35, intent: "trade" });
    expect(sayOf(moves[2])).toEqual({ unitCents: 10_900, deliveryDays: 21, intent: "hold" });
  });

  it("asked for faster delivery, Sunpeak offers 10 days at its price plus $5.00, once", () => {
    const { moves } = play(PERSONAS.sunpeak, ["Price?", "Could you deliver faster?", "Even faster?"]);
    expect(sayOf(moves[1])).toEqual({ unitCents: 13_100, deliveryDays: 10, intent: "trade" });
    expect(sayOf(moves[2])?.intent).not.toBe("trade");
  });

  it("a competitor with faster delivery and no lower price earns the rush option", () => {
    const { moves } = play(PERSONAS.brightway, ["Price?", "Another approved supplier offered $126.00 per panel with 14 days delivery."]);
    expect(sayOf(moves[1])).toEqual({ unitCents: 12_200, deliveryDays: 16, intent: "trade" });
  });

  it("without leverage a supplier counters halfway twice in whole dollars, then holds", () => {
    const { moves, state } = play(PERSONAS.brightway, ["Price?", "Can you do $105.00? We need a better price.", "Lower please, $100.00?", "Any lower?"]);
    expect(moves.map(sayOf)).toEqual([
      { unitCents: 11_800, deliveryDays: 21, intent: "open" },
      { unitCents: 11_400, deliveryDays: 21, intent: "counter" },
      { unitCents: 11_200, deliveryDays: 21, intent: "counter" },
      { unitCents: 11_200, deliveryDays: 21, intent: "hold" },
    ]);
    expect(state.priceCents).toBeGreaterThanOrEqual(PERSONAS.brightway.floorUnitCents);
  });

  it("counters toward the target whatever words the negotiator uses for it (the dry run said USD 110.00)", () => {
    const { moves } = play(PERSONAS.brightway, ["Price?", "Thank you. Could you meet our target unit price of USD 110.00 for 400 panels, CIF Durban?"]);
    expect(sayOf(moves[1])).toEqual({ unitCents: 11_400, deliveryDays: 21, intent: "counter" });
  });

  it("a buyer's question with no price push is answered at the same price and days (12 Nov: questions never cost a supplier money)", () => {
    const { moves } = play(PERSONAS.brightway, ["Price?", "Are the panels IEC 61215 certified, and do you have an NRCS letter of authority for South Africa?"]);
    expect(sayOf(moves[1])).toEqual({ unitCents: 11_800, deliveryDays: 21, intent: "answer" });
    const thanks = play(PERSONAS.sunpeak, ["Price?", "That works for us. I'll take it to the buyer and come back within one business day."]);
    expect(sayOf(thanks.moves[1])).toEqual({ unitCents: 12_600, deliveryDays: 14, intent: "answer" });
  });

  it("a push without a number still counts as a push", () => {
    for (const line of ["Can you sharpen your price?", "Any discount for 400 units?", "Could you come down a bit?"]) {
      expect(sayOf(play(PERSONAS.brightway, ["Price?", line]).moves[1])?.intent, line).toBe("counter");
    }
  });

  it("a competing quote in other words is still read as a competitor", () => {
    const elsewhere = readLeverage("We have a quote elsewhere at $117.00 with 14 days delivery.");
    expect(elsewhere).toMatchObject({ competitorCents: 11_700, competitorDays: 14 });
    expect(elsewhere.askCents).toBeUndefined();
    expect(readLeverage("The best offer on the table is $117.00 in 14 days.")).toMatchObject({ competitorCents: 11_700 });
  });

  it('"final" commits at the current price and days, and the form carries those days', () => {
    const { moves } = play(PERSONAS.brightway, ["Price?", "Another approved supplier offered $105.00 per panel.", "We accept 35 days. Please send your final committed quote."]);
    expect(moves[2]).toEqual({
      commit: { quoteNumber: expect.stringMatching(/^Q-[A-Z0-9-]+$/), quantity: 400, unitCents: 10_600, incoterm: "CIF", port: "Durban", deliveryDays: 35, notes: "" },
    });
  });

  it("a request to use the quote form commits too, so a negotiation with no countdown can close (14 Nov)", () => {
    expect(readLeverage("That works for us. Please put the offer on the Surety quote form now.").final).toBe(true);
    expect(readLeverage("Can you quote a better price?").final).toBe(false);
    const { moves } = play(PERSONAS.sunpeak, ["Price?", "That works. I will take it to the buyer. Please put the offer on the Surety quote form now."]);
    expect(moves[1]).toMatchObject({ commit: { unitCents: PERSONAS.sunpeak.openingUnitCents, deliveryDays: PERSONAS.sunpeak.deliveryDays } });
    // With a month still to run, nothing but being asked makes a supplier commit.
    expect(nextMove(PERSONAS.brightway, { ...fresh, priceCents: 11_800 }, [ask("Price?"), said("x")], 30 * 86_400)).toBeNull();
  });

  it("everyone commits with 15 s left, at their standard days when nothing was traded", () => {
    for (const p of [PERSONAS.brightway, PERSONAS.sunpeak]) {
      const r = nextMove(p, { ...fresh, priceCents: p.openingUnitCents }, [ask("Price?"), said("x")], 15);
      expect(r?.move).toEqual({ commit: { quoteNumber: expect.stringMatching(/^Q-[A-Z0-9-]+$/), quantity: 400, unitCents: p.openingUnitCents, incoterm: "CIF", port: "Durban", deliveryDays: p.deliveryDays, notes: "" } });
      expect(r?.state.committed).toBe(true);
    }
    expect(nextMove(PERSONAS.brightway, { ...fresh, committed: true }, [ask("Price?")], 10)).toBeNull();
  });

  it("Coastline still commits only after its script", () => {
    const p = PERSONAS.coastline;
    expect(nextMove(p, fresh, [], 10)).toBeNull();
    expect(nextMove(p, { ...fresh, scriptIndex: 1 }, [ask("Price?"), said("x")], 10)).toBeNull();
    expect(nextMove(p, { ...fresh, scriptIndex: 2, priceCents: 10_400 }, [ask("x")], 10)?.move).toMatchObject({ commit: { unitCents: 10_400, deliveryDays: 18 } });
    const { moves } = play(p, ["Price?", "Anything else?", "Another approved supplier offered $99.00.", "Please send your final committed quote."]);
    expect(moves[0]).toEqual({ script: p.script?.[0] });
    expect(moves[1]).toEqual({ script: p.script?.[1] });
    expect(sayOf(moves[2])).toEqual({ unitCents: 10_400, deliveryDays: 18, intent: "hold" });
    expect(moves[3]).toMatchObject({ commit: { unitCents: 10_400 } });
  });

  it("no sequence of 200 seeded random negotiator messages takes a supplier below its floor at standard or rush days, or below floor minus the slow discount", () => {
    let seed = 20_261_110;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)] as T;
    const dollars = () => `$${(50 + Math.floor(rand() * 100)).toFixed(2)}`;
    const lines = [
      () => `Another approved supplier offered ${dollars()} per panel with ${1 + Math.floor(rand() * 40)} days delivery.`,
      () => `Can you do ${dollars()}?`,
      () => `A competing quote is ${dollars()}. Could you deliver faster?`,
      () => "Could you ship sooner?",
      () => "Any better price?",
      () => `USD ${50 + Math.floor(rand() * 100)} would work for us.`,
    ];
    for (const p of [PERSONAS.brightway, PERSONAS.sunpeak]) {
      for (let run = 0; run < 20; run++) {
        const negotiator = Array.from({ length: 10 }, () => pick(lines)());
        const { moves } = play(p, ["Price?", ...negotiator, "Please send your final committed quote."]);
        for (const m of moves) {
          const offer = "say" in m ? m.say : "commit" in m ? m.commit : null;
          if (!offer) continue;
          const floor = offer.deliveryDays === p.slow?.days ? p.floorUnitCents - (p.slow?.discountCents ?? 0) : p.floorUnitCents;
          expect(offer.unitCents, `${p.key} ${JSON.stringify(negotiator)}`).toBeGreaterThanOrEqual(floor);
          expect([p.deliveryDays, p.slow?.days, p.rush?.days]).toContain(offer.deliveryDays);
        }
      }
    }
  });
});
