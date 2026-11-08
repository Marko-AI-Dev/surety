import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, seal } from "../src/secretbox";

describe("secretbox", () => {
  const key = randomBytes(32);

  it("round-trips a fulfillment", () => {
    expect(open(key, seal(key, "A0228020DEADBEEF"))).toBe("A0228020DEADBEEF");
  });

  it("does not store the plaintext", () => {
    expect(JSON.stringify(seal(key, "A0228020DEADBEEF"))).not.toContain("DEADBEEF");
  });

  it("throws on tampered ciphertext", () => {
    const sealed = seal(key, "A0228020DEADBEEF");
    const flipped = Buffer.from(sealed.ct, "hex");
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() => open(key, { ...sealed, ct: flipped.toString("hex") })).toThrow();
  });

  it("throws with the wrong key", () => {
    expect(() => open(randomBytes(32), seal(key, "A0228020DEADBEEF"))).toThrow();
  });
});
