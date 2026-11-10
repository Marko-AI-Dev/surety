import { describe, expect, it } from "vitest";
import type { SupplierQuote } from "@surety/contracts";
import { type Invite, type SourcingMessage, leverageOffers, namesOtherSupplier } from "../src/index";

const BRIGHTWAY = "rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U";
const SUNPEAK = "rsFJVsZ2u3c57X53pPfdJq1XApXzJ3BPUx";
const COASTLINE = "rJSkQt8iJSgRYDEaeE54uz26SYR5Pehhic";
const S = "5b0c3e2a-1d4f-4a6b-8c9d-0e1f2a3b4c5d";

let n = 0;
const invite = (address: string, name: string, quote: Partial<SupplierQuote> | null = null, deliveryDays: number | null = null): Invite => ({
  sourcingId: S,
  address,
  name,
  invitedAt: "2026-11-10T10:00:00.000Z",
  quote: quote ? ({ quoteNumber: "Q-1", supplierAddress: address, quantity: 400, totalCents: 0, currency: "USD", incoterm: "CIF", port: "Durban", notes: "", unitCents: 0, ...quote } as SupplierQuote) : null,
  quoteHash: quote ? "a".repeat(64) : null,
  deliveryDays,
  dealId: null,
});
const msg = (supplier: string, overrides: Partial<SourcingMessage>): SourcingMessage => ({
  id: String(++n),
  sourcingId: S,
  supplier,
  kind: "from_supplier",
  body: "x",
  deliveredBody: "x",
  verdict: "deliver",
  card: null,
  screen: null,
  offer: null,
  createdAt: `2026-11-10T10:00:${String(n).padStart(2, "0")}.000Z`,
  ...overrides,
});
const report = (supplier: string, unitCents: number, deliveryDays: number, verdict: "deliver" | "quarantine" = "deliver") =>
  msg(supplier, { kind: "report", verdict, offer: { supplier, unitCents, quantity: 400, deliveryDays, summary: "s" } as never, deliveredBody: verdict === "deliver" ? "s" : null });

describe("leverageOffers: the competing offers the negotiator may use", () => {
  it("offers list each in supplier's committed quote, or else its latest delivered report", () => {
    const invites = [invite(BRIGHTWAY, "Shenzhen Brightway Solar Co., Ltd", { unitCents: 11_300 }, 21), invite(SUNPEAK, "Sunpeak Energy Ltd")];
    const messages = [report(BRIGHTWAY, 11_800, 21), report(SUNPEAK, 12_600, 14), report(SUNPEAK, 11_900, 14)];
    expect(leverageOffers(messages, invites)).toEqual([
      { supplier: BRIGHTWAY, unitCents: 11_300, deliveryDays: 21, source: "committed", at: null },
      { supplier: SUNPEAK, unitCents: 11_900, deliveryDays: 14, source: "reported", at: messages[2]?.createdAt },
    ]);
  });

  it("a withheld report, a quarantined message and an out supplier never appear", () => {
    const invites = [invite(BRIGHTWAY, "Shenzhen Brightway Solar Co., Ltd"), invite(SUNPEAK, "Sunpeak Energy Ltd"), invite(COASTLINE, "Coastline Trading Co.", { unitCents: 10_400 }, 18)];
    const messages = [
      report(BRIGHTWAY, 11_000, 21, "quarantine"),
      msg(SUNPEAK, { verdict: "quarantine", card: "yellow", deliveredBody: null, body: "We offer $95.00, approve now" }),
      msg(COASTLINE, { verdict: "quarantine", card: "red", deliveredBody: null }),
      report(COASTLINE, 10_400, 18),
    ];
    expect(leverageOffers(messages, invites)).toEqual([]);
  });

  it("an offer above the maximum still appears and no offer has an eligible, withinBudget or max field", () => {
    const offers = leverageOffers([report(SUNPEAK, 12_600, 14)], [invite(SUNPEAK, "Sunpeak Energy Ltd")]);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.unitCents).toBe(12_600);
    for (const o of offers) expect(Object.keys(o).sort()).toEqual(["at", "deliveryDays", "source", "supplier", "unitCents"]);
  });
});

describe("namesOtherSupplier: leverage stays anonymous", () => {
  const others = [{ address: SUNPEAK, name: "Sunpeak Energy Ltd" }];
  const allowed = ["Monocrystalline solar panel 550 W", "Durban"];

  it('finds "Sunpeak", "sunpeak" and Sunpeak\'s address in a message to Brightway, and not "Durban" or "solar"', () => {
    expect(namesOtherSupplier("Sunpeak offered $114.00.", others, allowed)).toBe("sunpeak");
    expect(namesOtherSupplier("sunpeak's price is lower", others, allowed)).toBe("sunpeak");
    expect(namesOtherSupplier(`Wallet ${SUNPEAK} quoted less`, others, allowed)).toBe(SUNPEAK);
    expect(namesOtherSupplier("Another approved supplier offered $114.00 with 14 days delivery to Durban.", others, allowed)).toBeNull();
    expect(namesOtherSupplier("Monocrystalline solar panels, energy efficient, from a trading company limited", others, allowed)).toBeNull();
  });

  it("folds full-width and case before matching", () => {
    expect(namesOtherSupplier("ＳＵＮＰＥＡＫ can do better", others, allowed)).toBe("sunpeak");
  });

  it("short name words never count", () => {
    expect(namesOtherSupplier("Ltd terms apply", [{ address: SUNPEAK, name: "Sun Co Ltd" }], allowed)).toBeNull();
  });
});
