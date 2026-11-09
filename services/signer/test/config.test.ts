import { describe, expect, it } from "vitest";
import { Wallet } from "xrpl";
import { loadConfig } from "../src/config";

const seller = Wallet.generate().classicAddress;

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    BUYER_SEED: Wallet.generate().seed,
    SERVICE_SEED: Wallet.generate().seed,
    PREIMAGE_KEY: "ab".repeat(32),
    SIGNER_HMAC_SECRET: "h".repeat(40),
    GATE_AUTH_SECRET: "g".repeat(40),
    DESTINATION_ALLOWLIST: seller,
    ...overrides,
  };
}

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    const { config } = loadConfig(env());
    expect(config.allowlist).toEqual([seller]);
    expect(config.maxJobDrops).toBe(2_000_000n);
    expect(config.minCancelSeconds).toBe(60);
    expect(config.maxCancelSeconds).toBe(86_400);
    expect(config.finishMarginSeconds).toBe(5);
    expect(config.port).toBe(4100);
    expect(config.wsUrl).toBe("wss://s.altnet.rippletest.net:51233/");
  });

  it("names a missing variable without echoing any secret value", () => {
    const values = env({ BUYER_SEED: undefined });
    expect(() => loadConfig(values)).toThrow(/BUYER_SEED/);
    try {
      loadConfig(values);
    } catch (e) {
      expect(String(e)).not.toContain(String(values.SERVICE_SEED));
      expect(String(e)).not.toContain("ab".repeat(32));
    }
  });

  it("rejects a short HMAC secret, a bad preimage key and an invalid allowlist address", () => {
    expect(() => loadConfig(env({ SIGNER_HMAC_SECRET: "short" }))).toThrow(/SIGNER_HMAC_SECRET/);
    expect(() => loadConfig(env({ PREIMAGE_KEY: "xyz" }))).toThrow(/PREIMAGE_KEY/);
    expect(() => loadConfig(env({ DESTINATION_ALLOWLIST: "rNotAnAddress" }))).toThrow(/DESTINATION_ALLOWLIST/);
  });
});

describe("loadConfig TESTUSD", () => {
  const issuer = Wallet.generate().classicAddress;
  const supplierA = Wallet.generate().classicAddress;
  const supplierB = Wallet.generate().classicAddress;
  const testUsdEnv = (overrides: Record<string, string | undefined> = {}) =>
    env({
      TESTUSD_ISSUER: issuer,
      APPROVED_SUPPLIERS: `${supplierA}, ${supplierB}`,
      OPERATOR_HMAC_SECRET: "o".repeat(40),
      ...overrides,
    });

  it("TESTUSD stays off unless TESTUSD_ISSUER is set", () => {
    expect(loadConfig(env()).config.testUsd).toBeNull();
  });

  it("applies TESTUSD cap defaults of 250000 cents, 2500000 cents and 5 open deals", () => {
    expect(loadConfig(testUsdEnv()).config.testUsd).toEqual({
      issuer,
      approvedSuppliers: [supplierA, supplierB],
      maxDealCents: 250_000n,
      dailyCents: 2_500_000n,
      maxOpenDeals: 5,
      operatorSecret: "o".repeat(40),
    });
  });

  it("reads the caps from the environment", () => {
    const t = loadConfig(
      testUsdEnv({ MAX_DEAL_TESTUSD_CENTS: "10000000", DAILY_TESTUSD_CENTS: "50000000", MAX_OPEN_TESTUSD_DEALS: "3" }),
    ).config.testUsd;
    expect(t?.maxDealCents).toBe(10_000_000n);
    expect(t?.dailyCents).toBe(50_000_000n);
    expect(t?.maxOpenDeals).toBe(3);
  });

  it.each([
    ["TESTUSD_ISSUER", { TESTUSD_ISSUER: "rNotAnAddress" }],
    ["APPROVED_SUPPLIERS", { APPROVED_SUPPLIERS: `${supplierA},rNotAnAddress` }],
    ["APPROVED_SUPPLIERS", { APPROVED_SUPPLIERS: undefined }],
    ["MAX_DEAL_TESTUSD_CENTS", { MAX_DEAL_TESTUSD_CENTS: "2500.00" }],
    ["DAILY_TESTUSD_CENTS", { DAILY_TESTUSD_CENTS: "0" }],
    ["MAX_OPEN_TESTUSD_DEALS", { MAX_OPEN_TESTUSD_DEALS: "0" }],
  ] as const)("rejects a bad %s without echoing its value", (name, overrides) => {
    const values = testUsdEnv(overrides);
    let message = "";
    try {
      loadConfig(values);
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain(name);
    for (const v of Object.values(overrides)) if (v) expect(message).not.toContain(v);
    expect(message).not.toContain("o".repeat(40));
  });

  it("requires OPERATOR_HMAC_SECRET when TESTUSD is on, and refuses one equal to SIGNER_HMAC_SECRET or GATE_AUTH_SECRET", () => {
    expect(() => loadConfig(testUsdEnv({ OPERATOR_HMAC_SECRET: undefined }))).toThrow(/OPERATOR_HMAC_SECRET is required/);
    expect(() => loadConfig(testUsdEnv({ OPERATOR_HMAC_SECRET: "short" }))).toThrow(/OPERATOR_HMAC_SECRET must be at least 32/);
    expect(() => loadConfig(testUsdEnv({ OPERATOR_HMAC_SECRET: "h".repeat(40) }))).toThrow(/OPERATOR_HMAC_SECRET must differ/);
    expect(() => loadConfig(testUsdEnv({ OPERATOR_HMAC_SECRET: "g".repeat(40) }))).toThrow(/OPERATOR_HMAC_SECRET must differ/);
  });
});
