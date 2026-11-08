import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "../src/config";

const ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:57722/postgres",
  SIGNER_URL: "http://127.0.0.1:4100",
  SIGNER_HMAC_SECRET: "h".repeat(40),
  GATE_AUTH_SECRET: "g".repeat(40),
  XRPL_WS_URL: "wss://s.altnet.rippletest.net:51233/",
  OPENROUTER_API_KEY: "sk-or-v1-test-key-value",
};

describe("loadWorkerConfig", () => {
  it("reads the database, signer, gate and ledger settings: live Jev and a pass every 5000 ms by default", () => {
    expect(loadWorkerConfig(ENV)).toEqual({
      databaseUrl: ENV.DATABASE_URL,
      signerUrl: ENV.SIGNER_URL,
      hmacSecret: ENV.SIGNER_HMAC_SECRET,
      gateSecret: ENV.GATE_AUTH_SECRET,
      wsUrl: ENV.XRPL_WS_URL,
      intervalMs: 5_000,
      jevMode: "live",
      openrouterApiKey: ENV.OPENROUTER_API_KEY,
    });
  });

  it("runs on fixtures without an OpenRouter key when JEV_MODE is fixture", () => {
    const { OPENROUTER_API_KEY: _key, ...noKey } = ENV;
    expect(loadWorkerConfig({ ...noKey, JEV_MODE: "fixture" })).toMatchObject({ jevMode: "fixture", openrouterApiKey: "" });
  });

  it("requires the OpenRouter key for live Jev, and the gate secret always", () => {
    const { OPENROUTER_API_KEY: _key, GATE_AUTH_SECRET: _gate, ...rest } = ENV;
    const run = () => loadWorkerConfig({ ...rest, JEV_MODE: "live" });
    expect(run).toThrow(/OPENROUTER_API_KEY is required when JEV_MODE is live/);
    expect(run).toThrow(/GATE_AUTH_SECRET is required/);
  });

  it("refuses an unknown JEV_MODE without echoing it", () => {
    const run = () => loadWorkerConfig({ ...ENV, JEV_MODE: "pretend" });
    expect(run).toThrow(/JEV_MODE must be live or fixture/);
    expect(run).not.toThrow(/pretend/);
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
