import { describe, expect, it } from "vitest";
import { TESTUSD_CURRENCY_HEX, testUsdAmount, tokenValueToCents } from "../src/token";

const ISSUER = "rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXX";

describe("TESTUSD amounts", () => {
  it("uses TESTUSD as a 160-bit currency code", () => {
    expect(TESTUSD_CURRENCY_HEX).toBe("5445535455534400000000000000000000000000");
    expect(Buffer.from(TESTUSD_CURRENCY_HEX, "hex").toString("ascii").replace(/\0+$/, "")).toBe("TESTUSD");
  });

  it.each([
    ["4800000", "48000"],
    ["1250050", "12500.5"],
    ["1", "0.01"],
    ["99", "0.99"],
    ["100000000000", "1000000000"],
  ])("cents %s become the ledger value %s", (cents, value) => {
    expect(testUsdAmount(ISSUER, cents)).toEqual({ currency: TESTUSD_CURRENCY_HEX, issuer: ISSUER, value });
  });

  it.each([
    ["48000", "4800000"],
    ["12500.5", "1250050"],
    ["12500.50", "1250050"],
    ["0.01", "1"],
  ])("the ledger value %s is %s cents", (value, cents) => {
    expect(tokenValueToCents(value)).toBe(cents);
  });

  it.each(["0", "0.00", "-1", "0.001", "1e3", "4.8e4", "", "01", " 1", "1."])("refuses the ledger value %j", (value) => {
    expect(tokenValueToCents(value)).toBeNull();
  });

  it.each(["1", "99", "4800000", "100000000000"])("round-trips %s cents", (cents) => {
    expect(tokenValueToCents(testUsdAmount(ISSUER, cents).value)).toBe(cents);
  });
});
