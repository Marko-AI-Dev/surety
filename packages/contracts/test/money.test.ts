import { describe, expect, it } from "vitest";
import { isDrops } from "../src/money";

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
