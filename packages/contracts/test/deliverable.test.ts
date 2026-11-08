import { describe, expect, it } from "vitest";
import { DELIVERABLE_MAX_BYTES, InvoiceDeliverableSchema, deliverableHash } from "../src/index";

const GOOD = {
  invoice_id: "DEMO-001",
  vendor: "Demo Supplies",
  currency: "ZAR",
  total_minor: 40000,
  line_items: [
    { description: "USB-C cable", quantity: 2, unit_minor: 15000, amount_minor: 30000 },
    { description: "HDMI adapter", quantity: 1, unit_minor: 10000, amount_minor: 10000 },
  ],
  summary: "",
};

describe("InvoiceDeliverableSchema", () => {
  it("accepts a well-formed deliverable and caps raw size at 8192 bytes", () => {
    expect(InvoiceDeliverableSchema.parse(GOOD)).toEqual(GOOD);
    expect(DELIVERABLE_MAX_BYTES).toBe(8192);
  });

  it.each([
    ["an unknown top-level key", { ...GOOD, memo: "x" }],
    ["a lower-case currency", { ...GOOD, currency: "zar" }],
    ["a negative total", { ...GOOD, total_minor: -1 }],
    ["no line items", { ...GOOD, line_items: [] }],
    ["51 line items", { ...GOOD, line_items: Array.from({ length: 51 }, () => GOOD.line_items[1]) }],
    ["a zero quantity", { ...GOOD, line_items: [{ ...GOOD.line_items[0], quantity: 0 }] }],
    ["a quantity over 10000", { ...GOOD, line_items: [{ ...GOOD.line_items[0], quantity: 10001 }] }],
    ["an empty invoice id", { ...GOOD, invoice_id: "" }],
    ["a 65-character invoice id", { ...GOOD, invoice_id: "a".repeat(65) }],
    ["a 121-character vendor", { ...GOOD, vendor: "a".repeat(121) }],
    ["a 121-character description", { ...GOOD, line_items: [{ ...GOOD.line_items[0], description: "a".repeat(121) }] }],
    ["a money value as a string", { ...GOOD, total_minor: "40000" }],
  ])("rejects %s", (_name, value) => {
    expect(InvoiceDeliverableSchema.safeParse(value).success).toBe(false);
  });
});

describe("deliverableHash", () => {
  it("is the sha256 of the canonical JSON, independent of key order", () => {
    const reordered = {
      summary: "",
      line_items: GOOD.line_items.map(({ amount_minor, unit_minor, quantity, description }) => ({
        amount_minor,
        unit_minor,
        quantity,
        description,
      })),
      total_minor: 40000,
      currency: "ZAR",
      vendor: "Demo Supplies",
      invoice_id: "DEMO-001",
    };
    expect(deliverableHash(GOOD)).toMatch(/^[0-9a-f]{64}$/);
    expect(deliverableHash(reordered)).toBe(deliverableHash(GOOD));
  });

  it("changes when any value changes, and hashes raw values the schema would reject", () => {
    expect(deliverableHash({ ...GOOD, total_minor: 40001 })).not.toBe(deliverableHash(GOOD));
    expect(deliverableHash({ anything: true })).toMatch(/^[0-9a-f]{64}$/);
  });
});
