import { createHash as nodeHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHash, sha256 } from "../src/shims/node-crypto";

// Practice mode runs the bouncer's code rules in the browser on this shim. If its SHA-256 were wrong,
// address checksums would never match and every hidden wallet would pass, so it is pinned to Node's.
describe("the browser stand-in for node:crypto", () => {
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

  it("matches Node's SHA-256 across block boundaries", () => {
    for (const n of [0, 1, 20, 21, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
      expect(hex(sha256(data))).toBe(nodeHash("sha256").update(data).digest("hex"));
    }
  });

  it("createHash chains updates and digests to bytes or hex", () => {
    const expected = nodeHash("sha256").update("abc").update("def").digest("hex");
    expect(createHash("sha256").update("abc").update("def").digest("hex")).toBe(expected);
    expect(hex(createHash("sha256").update("abcdef").digest() as Uint8Array)).toBe(expected);
  });
});
