import { describe, expect, it } from "vitest";
import {
  type AuthorizationPayload,
  bindingHash,
  signAuthorization,
  verifyAuthorization,
} from "../src/authorization";

const SECRET = "gate-secret-for-tests-0123456789abcdef";
const NOW = new Date("2026-11-08T15:00:00.000Z");

function payload(overrides: Partial<AuthorizationPayload> = {}): AuthorizationPayload {
  return {
    network: "testnet",
    owner: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    offerSequence: 42,
    amountDrops: "1000000",
    destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    jobSnapshotHash: "a".repeat(64),
    deliverableHash: "b".repeat(64),
    policyVersion: "spike-0",
    decisionId: "decision-1",
    expiresAt: "2026-11-08T15:01:00.000Z",
    nonce: "0123456789abcdef0123456789abcdef",
    ...overrides,
  };
}

describe("authorization", () => {
  it("round-trips and reports the binding hash", () => {
    const signed = signAuthorization(payload(), SECRET);
    const result = verifyAuthorization(signed, SECRET, NOW);
    expect(result).toEqual({ ok: true, payload: payload(), bindingHash: bindingHash(payload()) });
  });

  it.each([
    ["amountDrops", { amountDrops: "2000000" }],
    ["destination", { destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe" }],
    ["deliverableHash", { deliverableHash: "c".repeat(64) }],
  ] as const)("rejects a payload whose %s changed after signing", (_field, change) => {
    const signed = signAuthorization(payload(), SECRET);
    const tampered = { ...signed, payload: { ...signed.payload, ...change } };
    expect(verifyAuthorization(tampered, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature made with another secret", () => {
    const signed = signAuthorization(payload(), "some-other-secret-0123456789abcdef");
    expect(verifyAuthorization(signed, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired authorization", () => {
    const signed = signAuthorization(payload({ expiresAt: "2026-11-08T14:59:59.000Z" }), SECRET);
    expect(verifyAuthorization(signed, SECRET, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects an authorization that lives longer than 120 seconds", () => {
    const signed = signAuthorization(payload({ expiresAt: "2026-11-08T15:02:01.000Z" }), SECRET);
    expect(verifyAuthorization(signed, SECRET, NOW)).toEqual({ ok: false, reason: "too_long_lived" });
  });

  it("rejects a malformed authorization", () => {
    const { nonce: _dropped, ...missingNonce } = payload();
    expect(verifyAuthorization({ payload: missingNonce, sig: "00" }, SECRET, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyAuthorization("not an object", SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("authorization amounts", () => {
  it("an XRP payload's binding hash is unchanged", () => {
    expect(bindingHash(payload())).toBe("4f6196f3c44584db7ca6b36a49dc76fde1092ee1043a14369ede8a9cc27b921d");
  });

  it("a TESTUSD payload round-trips", () => {
    const { amountDrops: _drop, ...rest } = payload();
    const testUsd = { ...rest, amountTestUsdCents: "4800000" } as AuthorizationPayload;
    const result = verifyAuthorization(signAuthorization(testUsd, SECRET), SECRET, NOW);
    expect(result.ok).toBe(true);
  });

  it("a payload with both amount fields is malformed", () => {
    const both = { ...payload(), amountTestUsdCents: "4800000" } as AuthorizationPayload;
    expect(verifyAuthorization(signAuthorization(both, SECRET), SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("a payload with no amount field is malformed", () => {
    const { amountDrops: _drop, ...none } = payload();
    expect(verifyAuthorization(signAuthorization(none as AuthorizationPayload, SECRET), SECRET, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
