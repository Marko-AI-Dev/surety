import { describe, expect, it } from "vitest";
import type { TradeDocuments, TradeFields } from "@surety/contracts";
import { RULE_IDS, TRADE_RULE_IDS, POLICY_V2, decide, parseTradeDocuments, runRules, runTradeRules } from "../src/index";
import { ATTACKER, SUPPLIER, intent, presets, quote } from "../../../scripts/deal-fixtures";

const lock = { destination: SUPPLIER, amountCents: "4800000" };

// The parser stands in for the document reader, so reader_agrees passes unless a test says otherwise.
function rules(documents: TradeDocuments, readerFields: TradeFields | null = parseTradeDocuments(documents)) {
  return runTradeRules({ intent, quote, documents, readerFields, lock });
}
const failed = (r: ReturnType<typeof rules>) => r.results.filter((x) => x.status === "fail").map((x) => x.id);
const doc = (name: string) => {
  const d = presets[name];
  if (!d) throw new Error(`no preset ${name}`);
  return d;
};

describe("runTradeRules", () => {
  it("honest documents pass all 12 rules", () => {
    const r = rules(doc("docs-honest"));
    expect(r.passed).toBe(true);
    expect(r.results.map((x) => x.id)).toEqual([...TRADE_RULE_IDS]);
    expect(r.results.every((x) => x.status === "pass")).toBe(true);
  });

  it("docs-wallet-changed fails pay_to and only pay_to, naming both wallets", () => {
    const r = rules(doc("docs-wallet-changed"));
    expect(failed(r)).toEqual(["pay_to"]);
    const detail = r.results.find((x) => x.id === "pay_to")?.detail ?? "";
    expect(detail).toContain(ATTACKER);
    expect(detail).toContain(SUPPLIER);
  });

  it("docs-quantity-edited fails shipment", () => {
    expect(failed(rules(doc("docs-quantity-edited")))).toEqual(["shipment"]);
  });

  it("docs-total-edited fails arithmetic and total_matches_lock", () => {
    expect(failed(rules(doc("docs-total-edited")))).toEqual(["arithmetic", "total_matches_lock"]);
  });

  it("docs-second-pay-to fails parse and skips the other 10 rules after it", () => {
    const r = rules(doc("docs-second-pay-to"), null);
    expect(r.passed).toBe(false);
    expect(r.results.find((x) => x.id === "size")?.status).toBe("pass");
    expect(r.results.find((x) => x.id === "parse")?.status).toBe("fail");
    expect(r.results.filter((x) => x.status === "skipped")).toHaveLength(10);
  });

  it("hidden instructions pass the rules: free text is the decision model's job", () => {
    expect(rules(doc("docs-hidden-instruction")).passed).toBe(true);
  });

  it("a reader that misreads the quantity fails reader_agrees", () => {
    const honest = doc("docs-honest");
    const parsed = parseTradeDocuments(honest) as TradeFields;
    const misread = { ...parsed, billOfLading: { ...parsed.billOfLading, goodsQuantity: 4000 } };
    expect(failed(rules(honest, misread))).toEqual(["reader_agrees"]);
  });

  it("null readerFields with parseable documents fails reader_agrees", () => {
    expect(failed(rules(doc("docs-honest"), null))).toEqual(["reader_agrees"]);
  });

  it("a lock to another wallet or for another amount fails", () => {
    const r = runTradeRules({ intent, quote, documents: doc("docs-honest"), readerFields: parseTradeDocuments(doc("docs-honest")), lock: { destination: ATTACKER, amountCents: "4700000" } });
    expect(failed(r)).toEqual(["total_matches_lock", "pay_to"]);
  });

  it("documents that are not the documents schema fail parse", () => {
    const r = runTradeRules({ intent, quote, documents: { invoice: "x" }, readerFields: null, lock });
    expect(failed(r)).toEqual(["parse"]);
  });

  it("decide declines a trade report with rule codes, and still declines an invoice-job RulesReport", () => {
    expect(decide(rules(doc("docs-wallet-changed")), null, POLICY_V2)).toEqual({ outcome: "DECLINE", reasonCodes: ["rule:pay_to"] });
    const invoice = runRules({ sourceText: "nothing", allowedCurrencies: ["ZAR"], deliverable: {} });
    expect(RULE_IDS).toContain("schema");
    expect(decide(invoice, null, POLICY_V2).reasonCodes).toEqual(["rule:schema"]);
  });
});
