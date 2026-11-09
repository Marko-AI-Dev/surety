import { describe, expect, it } from "vitest";
import {
  DealIntentSchema,
  SupplierQuoteSchema,
  TradeDocumentsSchema,
  TradeFieldsSchema,
  budgetCents,
  type DealIntent,
} from "../src/index";

const TREASURY = "rHVVH877c6yuRMFuqVarsh8v3PkvxdCgk5";
const SUPPLIER = "rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U";

const intent: DealIntent = {
  poNumber: "PO-2026-0412",
  buyer: { name: "Karoo Solar Imports (Pty) Ltd", address: TREASURY },
  supplier: { name: "Shenzhen Brightway Solar Co., Ltd", address: SUPPLIER },
  goods: { description: "Monocrystalline solar panel 550 W", quantity: 400, maxUnitCents: 12_000 },
  incoterm: "CIF",
  port: "Durban",
  deadlineSeconds: 300,
};

const quote = {
  quoteNumber: "Q-88213",
  supplierAddress: SUPPLIER,
  quantity: 400,
  unitCents: 12_000,
  totalCents: 4_800_000,
  currency: "USD",
  incoterm: "CIF",
  port: "Durban",
  notes: "Ships within 21 days of the lock.",
};

const fields = {
  invoice: {
    invoiceNumber: "INV-88213",
    poNumber: "PO-2026-0412",
    seller: "Shenzhen Brightway Solar Co., Ltd",
    buyer: "Karoo Solar Imports (Pty) Ltd",
    payTo: SUPPLIER,
    currency: "USD",
    incoterm: "CIF",
    port: "Durban",
    lines: [{ description: "Monocrystalline solar panel 550 W", quantity: 400, unitCents: 12_000, amountCents: 4_800_000 }],
    totalCents: 4_800_000,
  },
  billOfLading: {
    blNumber: "SZXDUR-55120",
    shipper: "Shenzhen Brightway Solar Co., Ltd",
    consignee: "Karoo Solar Imports (Pty) Ltd",
    portOfLoading: "Shenzhen (Yantian)",
    portOfDischarge: "Durban",
    vessel: "MSC AURORA V.214E",
    goodsDescription: "Monocrystalline solar panel 550 W",
    goodsQuantity: 400,
  },
};

describe("deal contracts", () => {
  it("accepts the 400-panel CIF Durban intent", () => {
    expect(DealIntentSchema.parse(intent)).toEqual(intent);
  });

  it.each([
    ["unknown keys", { ...intent, note: "x" }],
    ["a float quantity", { ...intent, goods: { ...intent.goods, quantity: 400.5 } }],
    ["an unknown Incoterm", { ...intent, incoterm: "FAS" }],
    ["a 30-day deadline", { ...intent, deadlineSeconds: 30 * 86_400 }],
  ])("rejects %s", (_name, raw) => {
    expect(DealIntentSchema.safeParse(raw).success).toBe(false);
  });

  it("accepts the honest quote and rejects a quote in EUR", () => {
    expect(SupplierQuoteSchema.parse(quote)).toEqual(quote);
    expect(SupplierQuoteSchema.safeParse({ ...quote, currency: "EUR" }).success).toBe(false);
  });

  it("rejects a 4097-character document", () => {
    expect(TradeDocumentsSchema.safeParse({ commercialInvoice: "x", billOfLading: "y" }).success).toBe(true);
    expect(TradeDocumentsSchema.safeParse({ commercialInvoice: "x".repeat(4097), billOfLading: "y" }).success).toBe(false);
  });

  it("accepts the honest trade fields and rejects an invalid pay-to wallet", () => {
    expect(TradeFieldsSchema.parse(fields)).toEqual(fields);
    const bad = { ...fields, invoice: { ...fields.invoice, payTo: "not-a-wallet" } };
    expect(TradeFieldsSchema.safeParse(bad).success).toBe(false);
  });

  it("budgetCents is quantity times the maximum unit price", () => {
    expect(budgetCents(intent)).toBe(4_800_000n);
  });
});
