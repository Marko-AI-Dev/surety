import { describe, expect, it } from "vitest";
import { assetAmountOf, isCents, isDrops, wireAmount } from "../src/money";

describe("isDrops", () => {
  it("accepts positive integer drop strings", () => {
    expect(isDrops("1000000")).toBe(true);
    expect(isDrops("1")).toBe(true);
  });

  it.each(["0", "01", "1.5", "-1", "", " 1", "1e6", "100000000000000001"])(
    "rejects %j",
    (value) => {
      expect(isDrops(value)).toBe(false);
    },
  );
});

describe("TESTUSD cents and asset amounts", () => {
  it("isCents accepts positive integer cent strings up to the maximum", () => {
    expect(isCents("1")).toBe(true);
    expect(isCents("100000000000")).toBe(true);
  });

  it.each(["0", "0123", "1.5", "1e6", "-1", "", "100000000001"])("isCents rejects %j", (value) => {
    expect(isCents(value)).toBe(false);
  });

  it("wireAmount gives only the TESTUSD field, with no undefined keys", () => {
    const wire = wireAmount({ asset: "TESTUSD", cents: "4800000" });
    expect(wire).toEqual({ amountTestUsdCents: "4800000" });
    expect(Object.keys(wire)).toEqual(["amountTestUsdCents"]);
  });

  it("wireAmount gives only the XRP field for XRP", () => {
    expect(Object.keys(wireAmount({ asset: "XRP", drops: "1000000" }))).toEqual(["amountDrops"]);
  });

  it("assetAmountOf reads exactly one valid field", () => {
    expect(assetAmountOf({ amountDrops: "1000000" })).toEqual({ asset: "XRP", drops: "1000000" });
    expect(assetAmountOf({ amountTestUsdCents: "4800000" })).toEqual({ asset: "TESTUSD", cents: "4800000" });
  });

  it("assetAmountOf throws unless exactly one field is present", () => {
    expect(() => assetAmountOf({ amountDrops: "1", amountTestUsdCents: "1" })).toThrow(/exactly one/);
    expect(() => assetAmountOf({})).toThrow(/exactly one/);
    expect(() => assetAmountOf({ amountTestUsdCents: "1.5" })).toThrow(RangeError);
  });
});
