import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../src/canonical";

describe("canonicalJson", () => {
  it("sorts keys recursively with no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("gives the same hash regardless of input key order", () => {
    const x = sha256Hex(canonicalJson({ amount: "1", to: "r1", list: [{ z: 1, y: 2 }] }));
    const y = sha256Hex(canonicalJson({ list: [{ y: 2, z: 1 }], to: "r1", amount: "1" }));
    expect(x).toBe(y);
  });

  it("keeps array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("throws on undefined, functions and non-finite numbers", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
  });
});

describe("sha256Hex", () => {
  it("returns lowercase hex", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
