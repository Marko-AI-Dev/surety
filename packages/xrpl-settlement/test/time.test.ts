import { describe, expect, it } from "vitest";
import { RIPPLE_EPOCH_OFFSET, cancelAfterFrom, rippleToIso } from "../src/time";

describe("ledger time", () => {
  it("uses the Ripple epoch offset of 946684800 seconds", () => {
    expect(RIPPLE_EPOCH_OFFSET).toBe(946684800);
  });

  it("adds seconds to the validated ledger close time", () => {
    expect(cancelAfterFrom(800000000, 180)).toBe(800000180);
  });

  it("rejects non-integer or negative inputs", () => {
    expect(() => cancelAfterFrom(800000000.5, 180)).toThrow(RangeError);
    expect(() => cancelAfterFrom(800000000, -1)).toThrow(RangeError);
  });

  it("converts Ripple time zero to the year 2000", () => {
    expect(rippleToIso(0)).toBe("2000-01-01T00:00:00.000Z");
  });
});
