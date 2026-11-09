import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Wallet } from "xrpl";
import { createPolicyStore } from "../src/policy";

const NOW = () => new Date("2026-11-09T12:00:00.000Z");
let dataDir: string;
let supplier: string;
let other: string;
const treasury = Wallet.generate().classicAddress;
const service = Wallet.generate().classicAddress;
const issuer = Wallet.generate().classicAddress;
const guard = { forbidden: [treasury, service, issuer] };

const initial = () => ({ perDealCents: "250000", dailyCents: "2500000", maxOpenDeals: 5, approvedSuppliers: [supplier] });

function update(overrides: Record<string, unknown> = {}) {
  return {
    opId: randomUUID(),
    expectedVersion: 1,
    perDealCents: "100000",
    dailyCents: "2500000",
    maxOpenDeals: 5,
    approvedSuppliers: [supplier, other],
    ...overrides,
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "surety-policy-"));
  supplier = Wallet.generate().classicAddress;
  other = Wallet.generate().classicAddress;
});

describe("policy store", () => {
  it("first boot writes version 1 from config, and a later boot keeps the operator's change over new config defaults", () => {
    const store = createPolicyStore(dataDir, initial(), NOW);
    expect(store.current()).toEqual({ ...initial(), version: 1, updatedAt: NOW().toISOString() });
    store.update(update(), guard);
    const rebooted = createPolicyStore(dataDir, { ...initial(), perDealCents: "999999" }, NOW);
    expect(rebooted.current().version).toBe(2);
    expect(rebooted.current().perDealCents).toBe("100000");
  });

  it("an update with the current expectedVersion bumps the version and appends history", () => {
    const store = createPolicyStore(dataDir, initial(), NOW);
    const view = store.update(update(), guard);
    expect(view).toMatchObject({ version: 2, perDealCents: "100000", approvedSuppliers: [supplier, other] });
    const history = JSON.parse(readFileSync(join(dataDir, "policy-history.json"), "utf8"));
    expect(history.map((h: { view: { version: number } }) => h.view.version)).toEqual([1, 2]);
  });

  it("a stale expectedVersion is refused with policy_conflict", () => {
    const store = createPolicyStore(dataDir, initial(), NOW);
    store.update(update(), guard);
    expect(() => store.update(update({ expectedVersion: 1 }), guard)).toThrow(expect.objectContaining({ code: "policy_conflict" }));
  });

  it("replaying the same opId and body returns the stored view; the same opId with a different body is op_conflict", () => {
    const store = createPolicyStore(dataDir, initial(), NOW);
    const req = update();
    const first = store.update(req, guard);
    expect(store.update(req, guard)).toEqual(first);
    expect(store.current().version).toBe(2);
    expect(() => store.update({ ...req, perDealCents: "1" }, guard)).toThrow(expect.objectContaining({ code: "op_conflict" }));
  });

  it.each([
    ["treasury", treasury],
    ["service", service],
    ["issuer", issuer],
  ])("refuses the %s as an approved supplier", (_name, address) => {
    const store = createPolicyStore(dataDir, initial(), NOW);
    expect(() => store.update(update({ approvedSuppliers: [supplier, address] }), guard)).toThrow(
      expect.objectContaining({ code: "bad_request" }),
    );
    expect(store.current().version).toBe(1);
  });

  it("refuses a per-deal cap above the 24-hour cap", () => {
    const store = createPolicyStore(dataDir, initial(), NOW);
    expect(() => store.update(update({ perDealCents: "2500001" }), guard)).toThrow(
      /the per-deal cap cannot exceed the 24-hour cap/,
    );
  });
});
