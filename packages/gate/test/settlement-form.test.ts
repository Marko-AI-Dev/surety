import { describe, expect, it } from "vitest";
import { buildSettlementDocuments, parseTradeDocuments, runTradeRules, settlementDraft } from "../src/index";
import { ATTACKER, SUPPLIER, honest, intent, quote, remarks } from "../../../scripts/deal-fixtures";

const form = {
  invoiceNumber: "INV-88213",
  blNumber: "SZXDUR-55120",
  vessel: "MSC AURORA V.214E",
  portOfLoading: "Shenzhen (Yantian)",
  remarks,
};

const lock = { destination: SUPPLIER, amount: { asset: "TESTUSD" as const, cents: String(quote.totalCents) } };
const failedRules = (docs: ReturnType<typeof buildSettlementDocuments>) =>
  runTradeRules({ intent, quote, documents: docs, readerFields: parseTradeDocuments(docs), lock })
    .results.filter((r) => r.status === "fail")
    .map((r) => r.id);

describe("the settlement form", () => {
  it("the draft fixes every field the deal decides and suggests the rest", () => {
    const draft = settlementDraft(intent, quote);
    expect(draft.fixed.invoice).toMatchObject({
      poNumber: "PO-2026-0412",
      seller: intent.supplier.name,
      buyer: intent.buyer.name,
      payTo: SUPPLIER,
      currency: "USD",
      lines: [{ description: intent.goods.description, quantity: 400, unitCents: 12_000, amountCents: 4_800_000 }],
      totalCents: 4_800_000,
    });
    expect(draft.fixed.billOfLading).toEqual({
      shipper: intent.supplier.name,
      consignee: intent.buyer.name,
      portOfDischarge: "Durban",
      goodsDescription: intent.goods.description,
      goodsQuantity: 400,
    });
    expect(draft.suggested).toEqual({
      invoiceNumber: "INV-88213",
      remarks: { invoice: "Goods as per quote Q-88213.", billOfLading: "Clean on board. Freight prepaid." },
    });
  });

  it("the draft with no edits renders exactly the 4b honest documents, given the fixture's invoice and B/L values", () => {
    const docs = buildSettlementDocuments(intent, quote, form);
    expect(docs).toEqual(honest);
    expect(failedRules(docs)).toEqual([]);
  });

  it("edits.payTo produces a pay_to failure under runTradeRules", () => {
    expect(failedRules(buildSettlementDocuments(intent, quote, { ...form, edits: { payTo: ATTACKER } }))).toContain("pay_to");
  });

  it("edits.blQuantity produces a shipment failure and edits.totalCents an arithmetic failure", () => {
    expect(failedRules(buildSettlementDocuments(intent, quote, { ...form, edits: { blQuantity: 380 } }))).toContain("shipment");
    expect(failedRules(buildSettlementDocuments(intent, quote, { ...form, edits: { totalCents: 5_200_000 } }))).toContain("arithmetic");
  });
});
