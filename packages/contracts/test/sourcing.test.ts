import { describe, expect, it } from "vitest";
import {
  ChatTextSchema,
  DealIntentSchema,
  LeadDecisionSchema,
  MESSAGE_MAX_CHARS,
  OfferReportSchema,
  QuoteFormSchema,
  SettlementFormSchema,
  SourcingBriefSchema,
  SupplierQuoteSchema,
} from "../src/index";
import { intent, quote } from "../../../scripts/deal-fixtures";

const TREASURY = "rHVVH877c6yuRMFuqVarsh8v3PkvxdCgk5";
const SUPPLIER = "rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U";

const brief = {
  buyer: { name: "Karoo Solar Imports (Pty) Ltd", address: TREASURY },
  goods: { description: "Monocrystalline solar panel 550 W", quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000 },
  incoterm: "CIF",
  port: "Durban",
  deadlineSeconds: 300,
  negotiationSeconds: 90,
};

const form = { quoteNumber: "Q-88213", quantity: 400, unitCents: 11_400, incoterm: "CIF", port: "Durban", deliveryDays: 21, notes: "Ships within 21 days." };

const settlement = {
  invoiceNumber: "INV-88213",
  blNumber: "SZXDUR-55120",
  vessel: "MSC AURORA V.214E",
  portOfLoading: "Shenzhen (Yantian)",
  remarks: { invoice: "Goods as per quote Q-88213.", billOfLading: "Clean on board. Freight prepaid." },
};

describe("sourcing contracts", () => {
  it("accepts the demo brief", () => {
    expect(SourcingBriefSchema.parse(brief)).toEqual(brief);
  });

  it("a brief with target above maximum is refused", () => {
    expect(SourcingBriefSchema.safeParse({ ...brief, goods: { ...brief.goods, targetUnitCents: 12_500 } }).success).toBe(false);
  });

  it("a brief needs a negotiation window of 30 to 3600 seconds and a deadline of 60 to 86400", () => {
    expect(SourcingBriefSchema.safeParse({ ...brief, negotiationSeconds: 29 }).success).toBe(false);
    expect(SourcingBriefSchema.safeParse({ ...brief, negotiationSeconds: 3601 }).success).toBe(false);
    expect(SourcingBriefSchema.safeParse({ ...brief, deadlineSeconds: 59 }).success).toBe(false);
  });

  it("a quote form with a wallet or total field is refused (strict)", () => {
    expect(QuoteFormSchema.parse(form)).toEqual(form);
    expect(QuoteFormSchema.safeParse({ ...form, supplierAddress: SUPPLIER }).success).toBe(false);
    expect(QuoteFormSchema.safeParse({ ...form, totalCents: 4_560_000 }).success).toBe(false);
    expect(QuoteFormSchema.safeParse({ ...form, unitCents: 0 }).success).toBe(false);
  });

  it("chat text over 1000 characters is refused and whitespace-only text is refused", () => {
    expect(MESSAGE_MAX_CHARS).toBe(1000);
    expect(ChatTextSchema.parse("  We can do $114.00 a panel.  ")).toBe("We can do $114.00 a panel.");
    expect(ChatTextSchema.safeParse("x".repeat(1001)).success).toBe(false);
    expect(ChatTextSchema.safeParse("   \n ").success).toBe(false);
  });

  it("an offer report carries the supplier, price, quantity, delivery and a short summary", () => {
    const report = { supplier: SUPPLIER, unitCents: 11_400, quantity: 400, deliveryDays: 21, summary: "Best price so far." };
    expect(OfferReportSchema.parse(report)).toEqual(report);
    expect(OfferReportSchema.safeParse({ ...report, deliveryDays: 0 }).success).toBe(false);
    expect(OfferReportSchema.safeParse({ ...report, summary: "x".repeat(501) }).success).toBe(false);
  });

  it("settlement edits accept only the five named fields", () => {
    expect(SettlementFormSchema.parse(settlement)).toEqual(settlement);
    const edits = { payTo: SUPPLIER, invoiceQuantity: 400, blQuantity: 380, unitCents: 12_000, totalCents: 4_800_000 };
    expect(SettlementFormSchema.parse({ ...settlement, edits })).toMatchObject({ edits });
    expect(SettlementFormSchema.safeParse({ ...settlement, edits: { vessel: "OTHER" } }).success).toBe(false);
    expect(SettlementFormSchema.safeParse({ ...settlement, payTo: SUPPLIER }).success).toBe(false);
  });

  it("a lead decision is accept or decline with a reason", () => {
    expect(LeadDecisionSchema.parse({ outcome: "accept", reason: "Cheapest committed quote within the brief." })).toBeTruthy();
    expect(LeadDecisionSchema.safeParse({ outcome: "accept", reason: "" }).success).toBe(false);
    expect(LeadDecisionSchema.safeParse({ outcome: "approve", reason: "x" }).success).toBe(false);
  });

  it("a quote form without deliveryDays, or with 0 or 366, is refused", () => {
    const { deliveryDays: _d, ...without } = form;
    expect(QuoteFormSchema.safeParse(without).success).toBe(false);
    expect(QuoteFormSchema.safeParse({ ...form, deliveryDays: 0 }).success).toBe(false);
    expect(QuoteFormSchema.safeParse({ ...form, deliveryDays: 366 }).success).toBe(false);
    expect(QuoteFormSchema.safeParse({ ...form, deliveryDays: 14.5 }).success).toBe(false);
    expect(QuoteFormSchema.parse({ ...form, deliveryDays: 1 }).deliveryDays).toBe(1);
    expect(QuoteFormSchema.parse({ ...form, deliveryDays: 365 }).deliveryDays).toBe(365);
  });

  it("the deal schemas still accept the 4b fixtures", () => {
    expect(DealIntentSchema.parse(intent)).toEqual(intent);
    expect(SupplierQuoteSchema.parse(quote)).toEqual(quote);
  });
});
