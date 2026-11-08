import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "../src/config";

const ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:57722/postgres",
  SIGNER_URL: "http://127.0.0.1:4100",
  SIGNER_HMAC_SECRET: "h".repeat(40),
  XRPL_WS_URL: "wss://s.altnet.rippletest.net:51233/",
};

describe("loadWorkerConfig", () => {
  it("reads the database, signer and ledger settings, sweeping every 5000 ms by default", () => {
    expect(loadWorkerConfig(ENV)).toEqual({
      databaseUrl: ENV.DATABASE_URL,
      signerUrl: ENV.SIGNER_URL,
      hmacSecret: ENV.SIGNER_HMAC_SECRET,
      wsUrl: ENV.XRPL_WS_URL,
      intervalMs: 5_000,
    });
  });

  it("takes SWEEP_INTERVAL_MS when set", () => {
    expect(loadWorkerConfig({ ...ENV, SWEEP_INTERVAL_MS: "2000" }).intervalMs).toBe(2_000);
  });

  it("names every missing or invalid variable without echoing values", () => {
    const run = () => loadWorkerConfig({ SIGNER_HMAC_SECRET: "", SWEEP_INTERVAL_MS: "soon" });
    expect(run).toThrow(/DATABASE_URL is required/);
    expect(run).toThrow(/SIGNER_URL is required/);
    expect(run).toThrow(/SIGNER_HMAC_SECRET is required/);
    expect(run).toThrow(/XRPL_WS_URL is required/);
    expect(run).toThrow(/SWEEP_INTERVAL_MS must be a positive whole number/);
    expect(run).not.toThrow(/soon/);
  });
});
