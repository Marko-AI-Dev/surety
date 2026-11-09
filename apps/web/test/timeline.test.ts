import { describe, expect, it } from "vitest";
import { recordedRun } from "../src/data/evidence";
import { buildTimeline, negotiatorEyes, openedAt, timelineBounds, viewAt } from "../src/data/timeline";
import type { SourcingRecord } from "../src/data/types";

const steps = buildTimeline(recordedRun);
const at = (id: string) => {
  const s = steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s.at;
};
const COASTLINE = "rJSkQt8iJSgRYDEaeE54uz26SYR5Pehhic";
const BRIGHTWAY = "rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U";

describe("the replay timeline of the recorded run", () => {
  it("opens at the negotiation end minus the negotiation length", () => {
    expect(new Date(openedAt(recordedRun)).toISOString()).toBe("2026-11-09T18:50:11.894Z");
    expect(steps[0]?.id).toBe("opened");
  });

  it("is ordered by time, and every message keeps its recorded time", () => {
    for (let i = 1; i < steps.length; i++) expect((steps[i]?.at ?? 0) >= (steps[i - 1]?.at ?? 0)).toBe(true);
    recordedRun.messages.forEach((m, i) => {
      const s = steps.find((x) => x.id === `message:${i}`);
      expect(s?.at).toBe(Date.parse(m.at));
      expect(s?.timed).toBe(true);
    });
  });

  it("marks every step the record does not time", () => {
    const untimed = steps.filter((s) => !s.timed).map((s) => s.kind);
    expect(new Set(untimed)).toEqual(new Set(["invited", "quote", "decision", "locked", "documents", "verified", "paid"]));
    expect(steps.filter((s) => s.kind === "opened" || s.kind === "closed" || s.kind === "suggested").every((s) => s.timed)).toBe(true);
  });

  it("keeps the true order after the negotiation: quotes, decision, lock, documents, Verify, payout", () => {
    const lastMessage = Math.max(...recordedRun.messages.map((m) => Date.parse(m.at)));
    const order = steps.filter((s) => s.at > lastMessage && s.kind !== "closed").map((s) => s.kind);
    expect(order).toEqual(["quote", "quote", "decision", "locked", "documents", "verified", "paid"]);
  });

  it("shows nothing before the sourcing opens", () => {
    const v = viewAt(recordedRun, steps, timelineBounds(steps).start);
    expect(v.phase).toBe("idle");
    expect(v.opened).toBe(false);
    expect(v.messages).toHaveLength(0);
    expect(v.invites.every((i) => !i.invited && i.quote === null)).toBe(true);
    expect(v.suggestions).toHaveLength(0);
    expect(v.money).toMatchObject({ treasuryCents: 995_100_000, escrowCents: 0, supplierCents: 0 });
  });

  it("moves exactly $45,600.00 out of the treasury at the lock, and not a moment earlier", () => {
    const justBefore = viewAt(recordedRun, steps, at("locked") - 1);
    expect(justBefore.locked).toBe(false);
    expect(justBefore.money.treasuryCents).toBe(995_100_000);
    expect(justBefore.money.escrowCents).toBe(0);

    const locked = viewAt(recordedRun, steps, at("locked"));
    expect(locked.phase).toBe("locked");
    expect(locked.money.treasuryCents).toBe(995_100_000 - 4_560_000);
    expect(locked.money.escrowCents).toBe(4_560_000);
    expect(locked.money.supplierCents).toBe(0);
  });

  it("releases the escrow to the supplier only at the payout", () => {
    const verifying = viewAt(recordedRun, steps, at("verified"));
    expect(verifying.money).toMatchObject({ escrowCents: 4_560_000, supplierCents: 0 });
    const paid = viewAt(recordedRun, steps, at("paid"));
    expect(paid.phase).toBe("paid");
    expect(paid.money).toMatchObject({ escrowCents: 0, supplierCents: 4_560_000 });
  });

  it("ends in the state the evidence recorded", () => {
    const v = viewAt(recordedRun, steps, Number.POSITIVE_INFINITY);
    expect(v.upcoming).toBe(0);
    expect(v.messages).toHaveLength(recordedRun.messages.length);
    expect(v.money.treasuryCents).toBe(Number(recordedRun.treasuryCents?.after));
    expect(v.accepted?.supplier.address).toBe(BRIGHTWAY);
    for (const inv of recordedRun.invites) {
      const mine = v.invites.find((i) => i.address === inv.address);
      expect(mine?.status).toBe(inv.status);
      expect((mine?.cards.yellow ?? 0) + (mine?.cards.red ?? 0)).toBe(inv.cards.length);
      expect(mine?.quote).toEqual(inv.quote);
    }
    expect(v.invites.find((i) => i.address === COASTLINE)).toMatchObject({ status: "out", cards: { yellow: 1, red: 1 } });
    expect(v.invites.filter((i) => i.unnamed)).toHaveLength(1);
  });

  it("Coastline is in after its yellow card and out at its red card", () => {
    const yellowAt = Date.parse("2026-11-09T18:51:31.000Z") + 1000;
    expect(viewAt(recordedRun, steps, yellowAt).invites.find((i) => i.address === COASTLINE)).toMatchObject({ status: "in", cards: { yellow: 1, red: 0 } });
  });
});

describe("the negotiator's eyes", () => {
  const all = viewAt(recordedRun, steps, Number.POSITIVE_INFINITY).messages;
  const inbox = negotiatorEyes(all);

  it("never carries the text of a held message, at any moment of the run", () => {
    const held = recordedRun.messages.filter((m) => m.kind === "from_supplier" && !m.delivered);
    expect(held).toHaveLength(2);
    for (const s of steps) {
      const text = JSON.stringify(negotiatorEyes(viewAt(recordedRun, steps, s.at).messages));
      for (const m of held) expect(text).not.toContain(m.body);
    }
  });

  it("shows held messages only as withheld, with their card", () => {
    const withheld = inbox.filter((i) => "withheld" in i);
    expect(withheld.map((i) => ("withheld" in i ? i.card : null))).toEqual(["yellow", "red"]);
    expect(withheld.every((i) => i.supplier === COASTLINE)).toBe(true);
  });

  it("carries neither the maximum price nor the reports to the Lead", () => {
    const text = JSON.stringify(inbox);
    expect(text).not.toContain("maxUnitCents");
    expect(text).not.toContain("12000");
    expect(text).not.toMatch(/120(\.00)?\b/);
    expect(inbox.some((i) => (i.kind as string) === "report")).toBe(false);
  });
});

describe("a live record that is still in progress", () => {
  it("builds a timeline with nothing after the negotiation and leaves the money where it is", () => {
    const partial: SourcingRecord = {
      network: recordedRun.network,
      sourcing: { ...recordedRun.sourcing, state: "OPEN" },
      invites: recordedRun.invites.map((i) => ({ ...i, quote: null, dealId: null })),
      suggestions: [],
      messages: recordedRun.messages.slice(0, 6),
    };
    const s = buildTimeline(partial);
    const v = viewAt(partial, s, Number.POSITIVE_INFINITY);
    expect(s.some((x) => ["decision", "locked", "paid"].includes(x.kind))).toBe(false);
    expect(v.messages).toHaveLength(6);
    expect(v.locked).toBe(false);
    expect(v.money).toEqual({ treasuryCents: null, escrowCents: 0, supplierCents: 0, totalCents: 0 });
  });

  it("a refunded deal puts the money back in the treasury", () => {
    const refunded: SourcingRecord = {
      ...recordedRun,
      finish: null,
      cancel: { txHash: "AB".repeat(32), validated: true, result: "tesSUCCESS", ledgerIndex: 1, explorer: "" },
      verify: { outcome: "DECLINE", satisfaction: null, injectionRisk: null, reasonCodes: ["rule:pay_to"], policyVersion: "policy-v4-trade" },
    };
    const s = buildTimeline(refunded);
    const v = viewAt(refunded, s, Number.POSITIVE_INFINITY);
    expect(v.phase).toBe("refunded");
    expect(v.money).toMatchObject({ treasuryCents: 995_100_000, escrowCents: 0, supplierCents: 0 });
  });
});
