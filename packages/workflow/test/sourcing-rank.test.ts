import { describe, expect, it } from "vitest";
import { type SourcingBrief, SourcingBriefSchema } from "@surety/contracts";
import { rankQuotes } from "../src/index";

const base = SourcingBriefSchema.parse({
  buyer: { name: "Karoo Solar Imports (Pty) Ltd", address: "rHVVH877c6yuRMFuqVarsh8v3PkvxdCgk5" },
  goods: { description: "Monocrystalline solar panel 550 W", quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000 },
  incoterm: "CIF",
  port: "Durban",
  deadlineSeconds: 300,
  negotiationSeconds: 90,
});
const brief = (overrides: Partial<SourcingBrief> = {}): SourcingBrief => ({ ...base, ...overrides });
const offer = (supplier: string, unitCents: number, deliveryDays: number | null, status: "in" | "out" = "in") => ({ supplier, status, unitCents, deliveryDays });
const order = (r: ReturnType<typeof rankQuotes>) => r.map((q) => q.supplier);

describe("rankQuotes: Surety's ranking for the buyer's priority", () => {
  const cheapSlow = offer("rBRIGHTWAY", 10_900, 21);
  const dearFast = offer("rSUNPEAK", 11_800, 14);

  it("price puts $109.00 in 21 days first", () => {
    const r = rankQuotes(brief({ priority: "price" }), [dearFast, cheapSlow]);
    expect(order(r)).toEqual(["rBRIGHTWAY", "rSUNPEAK"]);
    expect(r[0]).toEqual({ supplier: "rBRIGHTWAY", unitCents: 10_900, deliveryDays: 21, eligible: true, why: null });
  });

  it("speed puts $118.00 in 14 days first", () => {
    expect(order(rankQuotes(brief({ priority: "speed" }), [cheapSlow, dearFast]))).toEqual(["rSUNPEAK", "rBRIGHTWAY"]);
  });

  it("balanced prefers $118.00 in 14 days over $109.00 in 21 days, and $109.00 in 21 days over $118.00 in 20 days", () => {
    expect(order(rankQuotes(brief({ priority: "balanced" }), [cheapSlow, dearFast]))).toEqual(["rSUNPEAK", "rBRIGHTWAY"]);
    expect(order(rankQuotes(brief({ priority: "balanced" }), [offer("rSUNPEAK", 11_800, 20), cheapSlow]))).toEqual(["rBRIGHTWAY", "rSUNPEAK"]);
  });

  it("a brief with no priority ranks as balanced", () => {
    expect(base.priority).toBe("balanced");
    expect(order(rankQuotes(base, [cheapSlow, dearFast]))).toEqual(["rSUNPEAK", "rBRIGHTWAY"]);
  });

  it("an out supplier, a quote above $120.00, one without days and one slower than 30 days are ranked last with their reasons", () => {
    const r = rankQuotes(brief({ priority: "price", latestDeliveryDays: 30 }), [
      offer("rOUT", 10_000, 14, "out"),
      offer("rDEAR", 12_001, 10),
      offer("rNODAYS", 10_100, null),
      offer("rSLOW", 10_200, 31),
      cheapSlow,
    ]);
    expect(r[0]).toMatchObject({ supplier: "rBRIGHTWAY", eligible: true, why: null });
    const why = Object.fromEntries(r.slice(1).map((q) => [q.supplier, [q.eligible, q.why]]));
    expect(why).toEqual({
      rOUT: [false, "out"],
      rDEAR: [false, "above the maximum"],
      rNODAYS: [false, "no delivery days"],
      rSLOW: [false, "slower than 30 days"],
    });
  });

  it("a quote at exactly the maximum and exactly the latest day is eligible", () => {
    expect(rankQuotes(brief({ latestDeliveryDays: 30 }), [offer("rEDGE", 12_000, 30)])[0]).toMatchObject({ eligible: true, why: null });
  });

  it("an exact tie on the score breaks on price, then address", () => {
    // min price 10000, min days 10: 10000 x 10 + 20 x 10000 = 20000 x 10 + 10 x 10000 = 300000.
    const tied = rankQuotes(brief({ priority: "balanced", goods: { ...base.goods, maxUnitCents: 30_000 } }), [offer("rB", 20_000, 10), offer("rA", 10_000, 20)]);
    expect(order(tied)).toEqual(["rA", "rB"]);
    const same = rankQuotes(brief({ priority: "price" }), [offer("rZ", 11_000, 14), offer("rM", 11_000, 14)]);
    expect(order(same)).toEqual(["rM", "rZ"]);
  });

  it("no quotes rank to an empty list", () => {
    expect(rankQuotes(base, [])).toEqual([]);
  });
});
