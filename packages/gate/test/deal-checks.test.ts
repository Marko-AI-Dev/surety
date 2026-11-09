import { describe, expect, it } from "vitest";
import type { SupplierQuote } from "@surety/contracts";
import { checkIntent, checkQuote, type CheckReport } from "../src/index";
import { ATTACKER, SUPPLIER, TREASURY, intent, quote } from "../../../scripts/deal-fixtures";

const policy = { perDealCents: "10000000", approvedSuppliers: [SUPPLIER] };
const line = { balanceCents: 0n, limitCents: 100_000_000_000n, frozenByIssuer: false };
const ctx = { treasury: TREASURY, testUsd: policy, supplierLine: line };

const statusOf = (r: CheckReport<string>, id: string) => r.results.find((x) => x.id === id);
const failed = (r: CheckReport<string>) => r.results.filter((x) => x.status === "fail").map((x) => x.id);

describe("checkIntent (the Policy step)", () => {
  it("passes the honest intent on every check", () => {
    const r = checkIntent(intent, ctx);
    expect(r.passed).toBe(true);
    expect(r.results.map((x) => x.id)).toEqual(["buyer_treasury", "asset_enabled", "approved_supplier", "budget_within_cap", "supplier_ready"]);
  });

  it.each([
    ["buyer_treasury", { ...intent, buyer: { ...intent.buyer, address: SUPPLIER } }, ctx],
    ["asset_enabled", intent, { ...ctx, testUsd: null }],
    ["approved_supplier", { ...intent, supplier: { ...intent.supplier, address: ATTACKER } }, ctx],
    ["budget_within_cap", { ...intent, goods: { ...intent.goods, maxUnitCents: 37_500 } }, ctx],
    ["supplier_ready", intent, { ...ctx, supplierLine: null }],
  ] as const)("fails %s", (id, given, context) => {
    const r = checkIntent(given, context);
    expect(r.passed).toBe(false);
    expect(failed(r)).toContain(id);
  });

  it("a frozen trust line or one without room for the budget is not ready", () => {
    expect(failed(checkIntent(intent, { ...ctx, supplierLine: { ...line, frozenByIssuer: true } }))).toEqual(["supplier_ready"]);
    const full = { balanceCents: 99_999_000_000n, limitCents: 100_000_000_000n, frozenByIssuer: false };
    expect(failed(checkIntent(intent, { ...ctx, supplierLine: full }))).toEqual(["supplier_ready"]);
  });

  it("a $150,000 budget names both amounts in plain English", () => {
    const r = checkIntent({ ...intent, goods: { ...intent.goods, maxUnitCents: 37_500 } }, ctx);
    expect(statusOf(r, "budget_within_cap")?.detail).toBe("the budget $150,000.00 is above the per-deal cap $100,000.00");
  });

  it("all checks run even when the first fails", () => {
    const r = checkIntent({ ...intent, buyer: { ...intent.buyer, address: SUPPLIER } }, { ...ctx, testUsd: null });
    expect(r.results).toHaveLength(5);
    expect(failed(r)).toEqual(["buyer_treasury", "asset_enabled", "approved_supplier", "budget_within_cap"]);
  });
});

describe("checkQuote", () => {
  it("the honest fixture intent and quote pass every check", () => {
    const r = checkQuote(intent, quote, policy);
    expect(r.passed).toBe(true);
    expect(r.results.map((x) => x.id)).toEqual([
      "supplier_wallet",
      "approved_supplier",
      "quantity",
      "unit_price",
      "arithmetic",
      "currency",
      "terms",
      "per_deal_cap",
    ]);
  });

  it.each([
    ["supplier_wallet", { ...quote, supplierAddress: ATTACKER }],
    ["quantity", { ...quote, quantity: 380, totalCents: 4_560_000 }],
    ["arithmetic", { ...quote, totalCents: 4_700_000 }],
    ["terms", { ...quote, incoterm: "FOB" as const }],
    ["terms", { ...quote, port: "Cape Town" }],
  ] as const)("fails %s", (id, given) => {
    expect(failed(checkQuote(intent, given as SupplierQuote, policy))).toContain(id);
  });

  it("approved_supplier fails when the policy no longer lists the supplier", () => {
    expect(failed(checkQuote(intent, quote, { ...policy, approvedSuppliers: [] }))).toEqual(["approved_supplier"]);
  });

  it("per_deal_cap fails above the cap", () => {
    expect(failed(checkQuote(intent, quote, { ...policy, perDealCents: "4799999" }))).toEqual(["per_deal_cap"]);
  });

  it("the port compares without case or surrounding spaces", () => {
    expect(checkQuote(intent, { ...quote, port: "  durban " }, policy).passed).toBe(true);
  });

  it("quote-over-max fails unit_price and per_deal_cap is still evaluated", () => {
    const over = { ...quote, unitCents: 13_500, totalCents: 5_400_000 };
    const r = checkQuote(intent, over, policy);
    expect(failed(r)).toEqual(["unit_price"]);
    expect(statusOf(r, "per_deal_cap")?.status).toBe("pass");
    expect(statusOf(r, "unit_price")?.detail).toBe("unit price $135.00 is above the intent's maximum $120.00");
  });
});
