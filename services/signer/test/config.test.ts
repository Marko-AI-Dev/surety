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
