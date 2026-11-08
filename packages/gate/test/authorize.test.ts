import { describe, expect, it } from "vitest";
import { verifyAuthorization } from "@surety/contracts";
import { AUTHORIZATION_TTL_MS, mintAuthorization } from "../src/index";

const SECRET = "g".repeat(48);
const NOW = new Date("2026-11-09T10:00:00.000Z");

const BINDING = {
  owner: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
  offerSequence: 4242,
  amountDrops: "1000000",
  destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  jobSnapshotHash: "a".repeat(64),
  deliverableHash: "b".repeat(64),
  policyVersion: "policy-v1",
  decisionId: "5f0c6a52-1b7e-4a39-9b0e-7c8d9e0f1a2b",
};

const mint = (now = NOW) => mintAuthorization({ ...BINDING, gateSecret: SECRET, now });

describe("mintAuthorization", () => {
  it("binds the testnet escrow, job, deliverable, policy and decision, and verifies with the contracts verifier", () => {
    const auth = mint();
    expect(auth.payload).toMatchObject({ ...BINDING, network: "testnet" });
    const verdict = verifyAuthorization(auth, SECRET, NOW);
    expect(verdict.ok).toBe(true);
  });

  it("expires exactly 60 seconds after minting", () => {
    const auth = mint();
    expect(AUTHORIZATION_TTL_MS).toBe(60_000);
    expect(auth.payload.expiresAt).toBe("2026-11-09T10:01:00.000Z");
    expect(verifyAuthorization(auth, SECRET, new Date(NOW.getTime() + 59_999)).ok).toBe(true);
    expect(verifyAuthorization(auth, SECRET, new Date(NOW.getTime() + 60_000))).toEqual({ ok: false, reason: "expired" });
  });

  it("uses a fresh random 16-byte nonce, so two mints for the same binding differ", () => {
    const a = mint();
    const b = mint();
    expect(a.payload.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(b.payload.nonce).not.toBe(a.payload.nonce);
    expect(b.sig).not.toBe(a.sig);
  });

  it("does not verify under another secret, or once a bound field is changed", () => {
    const auth = mint();
    expect(verifyAuthorization(auth, "h".repeat(48), NOW)).toEqual({ ok: false, reason: "bad_signature" });
    const tampered = { ...auth, payload: { ...auth.payload, destination: "rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1" } };
    expect(verifyAuthorization(tampered, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses to mint for an amount or hash the signer would reject", () => {
    expect(() => mintAuthorization({ ...BINDING, amountDrops: "1.5", gateSecret: SECRET, now: NOW })).toThrow();
    expect(() => mintAuthorization({ ...BINDING, deliverableHash: "XYZ", gateSecret: SECRET, now: NOW })).toThrow();
  });
});
