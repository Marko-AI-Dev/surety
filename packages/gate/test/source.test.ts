import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseInvoiceSource } from "../src/index";

const SOURCE = readFileSync(resolve(import.meta.dirname, "../../../fixtures/invoice-demo-001.txt"), "utf8");

describe("parseInvoiceSource", () => {
  it("parses DEMO-001 into its fields, lines and total in integer minor units", () => {
    expect(parseInvoiceSource(SOURCE)).toEqual({
      invoiceId: "DEMO-001",
      supplier: "Demo Supplies",
      currency: "ZAR",
      lines: [
        { description: "USB-C cable", quantity: 2, unitMinor: 15000, amountMinor: 30000 },
        { description: "HDMI adapter", quantity: 1, unitMinor: 10000, amountMinor: 10000 },
      ],
      totalMinor: 40000,
    });
  });

  it("reads Windows line endings the same way", () => {
    expect(parseInvoiceSource(SOURCE.replace(/\n/g, "\r\n"))).toEqual(parseInvoiceSource(SOURCE));
  });

  it("converts money by splitting on the dot, with no float rounding", () => {
    const text = [
      "Invoice number: X-1",
      "Supplier: S",
      "Currency: ZAR",
      "3 x Item @ R0.29 = R0.87",
      "1 x Big @ R1234567.89 = R1234567.89",
      "Total due: R1234568.76",
    ].join("\n");
    const parsed = parseInvoiceSource(text);
    expect(parsed?.lines.map((l) => [l.unitMinor, l.amountMinor])).toEqual([
      [29, 87],
      [123456789, 123456789],
    ]);
    expect(parsed?.totalMinor).toBe(123456876);
  });

  it.each([
    ["the invoice number", /^Invoice number:.*$/m],
    ["the supplier", /^Supplier:.*$/m],
    ["the currency", /^Currency:.*$/m],
    ["the total", /^Total due:.*$/m],
    ["every line item", /^\d+ x .*$/gm],
  ])("returns null when %s is missing", (_name, pattern) => {
    expect(parseInvoiceSource(SOURCE.replace(pattern, ""))).toBeNull();
  });

  it("returns null when a header line appears twice, rather than guessing which one counts", () => {
    expect(parseInvoiceSource(`${SOURCE}Total due: R1.00\n`)).toBeNull();
    expect(parseInvoiceSource(`Supplier: Acme\n${SOURCE}`)).toBeNull();
  });

  it("returns null for free text", () => {
    expect(parseInvoiceSource("hello")).toBeNull();
  });
});
