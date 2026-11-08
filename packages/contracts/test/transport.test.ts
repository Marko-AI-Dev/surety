import { describe, expect, it } from "vitest";
import { signRequest, verifyRequest } from "../src/transport";

const SECRET = "transport-secret-for-tests-0123456789";
const TS = "1762614000000";

describe("request signing", () => {
  it("is deterministic", () => {
    expect(signRequest(SECRET, TS, "POST", "/escrows/create", "{}")).toBe(
      signRequest(SECRET, TS, "POST", "/escrows/create", "{}"),
    );
  });

  it.each([
    ["timestamp", ["1762614000001", "POST", "/escrows/create", "{}"]],
    ["method", [TS, "GET", "/escrows/create", "{}"]],
    ["path", [TS, "POST", "/escrows/finish", "{}"]],
    ["body", [TS, "POST", "/escrows/create", '{"a":1}']],
  ] as const)("changes when the %s changes", (_part, [ts, method, path, body]) => {
    const base = signRequest(SECRET, TS, "POST", "/escrows/create", "{}");
    expect(signRequest(SECRET, ts, method, path, body)).not.toBe(base);
  });

  it("verifies a fresh, correctly signed request", () => {
    const sig = signRequest(SECRET, TS, "POST", "/escrows/create", "{}");
    expect(verifyRequest(SECRET, TS, sig, "POST", "/escrows/create", "{}", Number(TS) + 1000)).toBe(true);
  });

  it("rejects a wrong signature, a stale timestamp and a missing header", () => {
    const sig = signRequest(SECRET, TS, "POST", "/escrows/create", "{}");
    expect(verifyRequest(SECRET, TS, "00".repeat(32), "POST", "/escrows/create", "{}", Number(TS))).toBe(false);
    expect(verifyRequest(SECRET, TS, sig, "POST", "/escrows/create", "{}", Number(TS) + 30_001)).toBe(false);
    expect(verifyRequest(SECRET, TS, sig, "POST", "/escrows/create", "{}", Number(TS) - 30_001)).toBe(false);
    expect(verifyRequest(SECRET, undefined, sig, "POST", "/escrows/create", "{}", Number(TS))).toBe(false);
    expect(verifyRequest(SECRET, TS, undefined, "POST", "/escrows/create", "{}", Number(TS))).toBe(false);
  });
});
