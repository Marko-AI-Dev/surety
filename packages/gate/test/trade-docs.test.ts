import { describe, expect, it } from "vitest";
import type { DealIntent, SupplierQuote, TradeFields } from "@surety/contracts";
import {
  formatDocUsd,
  parseDocUsd,
  parseTradeDocuments,
  renderPurchaseOrder,
  renderTradeDocuments,
} from "../src/index";

const SUPPLIER = "rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U";
const TREASURY = "rHVVH877c6yuRMFuqVarsh8v3PkvxdCgk5";

const fields: TradeFields = {
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
const remarks = { invoice: "Goods as per quote Q-88213.", billOfLading: "Clean on board. Freight prepaid." };
const honest = renderTradeDocuments(fields, remarks);

const intent: DealIntent = {
  poNumber: "PO-2026-0412",
  buyer: { name: "Karoo Solar Imports (Pty) Ltd", address: TREASURY },
  supplier: { name: "Shenzhen Brightway Solar Co., Ltd", address: SUPPLIER },
  goods: { description: "Monocrystalline solar panel 550 W", quantity: 400, maxUnitCents: 12_000 },
  incoterm: "CIF",
  port: "Durban",
  deadlineSeconds: 300,
};
const quote: SupplierQuote = {
  quoteNumber: "Q-88213",
  supplierAddress: SUPPLIER,
  quantity: 400,
  unitCents: 12_000,
  totalCents: 4_800_000,
  currency: "USD",
  incoterm: "CIF",
  port: "Durban",
  notes: "",
};

const editInvoice = (from: string, to: string) => ({ ...honest, commercialInvoice: honest.commercialInvoice.replace(from, to) });

describe("trade documents", () => {
  it("round-trips the honest documents: parse(render(fields)) deep-equals fields", () => {
    expect(honest.commercialInvoice).toContain("400 x Monocrystalline solar panel 550 W @ $120.00 = $48,000.00");
    expect(honest.commercialInvoice).toContain("Incoterm: CIF Durban");
    expect(honest.billOfLading).toContain("Goods: 400 x Monocrystalline solar panel 550 W");
    expect(parseTradeDocuments(honest)).toEqual(fields);
  });

  it('parseDocUsd accepts "$0.00", "$120.00", "$48,000.00" and "$1,000,000,000.00"', () => {
    expect(parseDocUsd("$0.00")).toBe(0);
    expect(parseDocUsd("$120.00")).toBe(12_000);
    expect(parseDocUsd("$48,000.00")).toBe(4_800_000);
    expect(parseDocUsd("$1,000,000,000.00")).toBe(100_000_000_000);
    expect(formatDocUsd(4_800_000)).toBe("$48,000.00");
    expect(formatDocUsd(5)).toBe("$0.05");
  });

  it.each(["$48000.00", "$48,000.5", "$ 48,000.00", "$48,00.00", "-$1.00", "$1,000,000,000,000.00", "$01.00", "48,000.00"])(
    "parseDocUsd refuses %s",
    (text) => {
      expect(parseDocUsd(text)).toBeNull();
    },
  );

  it("a missing Total due line is unparseable", () => {
    expect(parseTradeDocuments(editInvoice("Total due: $48,000.00", ""))).toBeNull();
  });

  it("a second Pay to wallet line is unparseable", () => {
    const twice = editInvoice(`Pay to wallet: ${SUPPLIER}`, `Pay to wallet: ${SUPPLIER}\nPay to wallet: rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh`);
    expect(parseTradeDocuments(twice)).toBeNull();
  });

  it("a line row with a non-integer quantity is unparseable", () => {
    expect(parseTradeDocuments(editInvoice("400 x Mono", "400.5 x Mono"))).toBeNull();
  });

  it("a line row with a malformed amount is unparseable", () => {
    expect(parseTradeDocuments(editInvoice("@ $120.00 =", "@ $120 ="))).toBeNull();
  });

  it("rows that match no label are ignored", () => {
    const extra = { ...honest, billOfLading: `${honest.billOfLading}\nHandle with care.\nThree pallets on deck.` };
    expect(parseTradeDocuments(extra)).toEqual(fields);
  });

  it("an empty remarks value leaves the Remarks line out", () => {
    const plain = renderTradeDocuments(fields, { invoice: "", billOfLading: "" });
    expect(plain.commercialInvoice).not.toContain("Remarks:");
    expect(parseTradeDocuments(plain)).toEqual(fields);
  });

  it("renderPurchaseOrder names the PO number, both parties, the goods, the unit price, the total, the Incoterm and port, and the supplier wallet", () => {
    const po = renderPurchaseOrder(intent, quote);
    for (const fact of [
      "PO-2026-0412",
      "Karoo Solar Imports (Pty) Ltd",
      "Shenzhen Brightway Solar Co., Ltd",
      "400 x Monocrystalline solar panel 550 W",
      "$120.00",
      "$48,000.00",
      "CIF Durban",
      SUPPLIER,
    ]) {
      expect(po).toContain(fact);
    }
  });
});
