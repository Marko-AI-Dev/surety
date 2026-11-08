import { describe, expect, it } from "vitest";
import { newPreimage, preimageCondition } from "../src/conditions";

// Vectors from rippled src/test/conditions/PreimageSha256_test.cpp
describe("preimageCondition", () => {
  it("encodes the empty preimage exactly like rippled", () => {
    const { condition, fulfillment } = preimageCondition(new Uint8Array(0));
    expect(fulfillment).toBe("A0028000");
    expect(condition).toBe(
      "A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100",
    );
  });

  it("encodes the 'aaa' preimage exactly like rippled", () => {
    const { condition, fulfillment } = preimageCondition(Buffer.from("aaa"));
    expect(fulfillment).toBe("A0058003616161");
    expect(condition).toBe(
      "A02580209834876DCFB05CB167A5C24953EBA58C4AC89B1ADF57F28F2F9D09AF107EE8F0810103",
    );
  });

  it("encodes a 32-byte preimage with cost 32", () => {
    const { condition, fulfillment } = preimageCondition(new Uint8Array(32));
    expect(fulfillment).toBe("A0228020" + "00".repeat(32));
    expect(condition).toBe(
      "A025802066687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925810120",
    );
  });

  it("rejects preimages too long for single-byte DER lengths", () => {
    expect(() => preimageCondition(new Uint8Array(126))).toThrow(RangeError);
  });
});

describe("newPreimage", () => {
  it("returns 32 fresh random bytes each call", () => {
    const a = newPreimage();
    const b = newPreimage();
    expect(a.length).toBe(32);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});
