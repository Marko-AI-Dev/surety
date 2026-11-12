import { describe, expect, it } from "vitest";
import { loadApiConfig } from "../src/config";

const SUPPLIER = "rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U";
const token = (c: string) => c.repeat(40);

const base = {
  DATABASE_URL: "postgres://u:p@127.0.0.1:57722/postgres",
  SIGNER_URL: "http://127.0.0.1:4100",
  SIGNER_HMAC_SECRET: "h".repeat(40),
  XRPL_WS_URL: "wss://s.altnet.rippletest.net:51233",
  OPENROUTER_API_KEY: "sk-or-v1-test",
  API_TOKEN_LEAD: token("a"),
  API_TOKEN_SOURCING: token("b"),
  API_TOKEN_NEGOTIATOR: token("c"),
  API_TOKEN_VIEW: token("d"),
  API_TOKEN_INSPECTOR: token("f"),
  API_SUPPLIER_TOKENS: JSON.stringify({ [SUPPLIER]: token("e") }),
};

describe("loadApiConfig", () => {
  it("reads the defaults and every token", () => {
    const c = loadApiConfig(base);
    expect(c).toMatchObject({
      host: "127.0.0.1",
      port: 4200,
      directoryFile: "fixtures/sourcing/directory.json",
      tokens: { lead: token("a"), sourcing: token("b"), negotiator: token("c"), view: token("d"), inspector: token("f") },
      inspectorName: "Port inspector (demo)",
      supplierTokens: { [SUPPLIER]: token("e") },
    });
    expect(loadApiConfig({ ...base, API_HOST: "0.0.0.0", API_PORT: "4300" })).toMatchObject({ host: "0.0.0.0", port: 4300 });
  });

  it("loadApiConfig refuses a short or duplicated token without printing it", () => {
    const short = "s".repeat(31);
    expect(() => loadApiConfig({ ...base, API_TOKEN_LEAD: short })).toThrow(/API_TOKEN_LEAD/);
    try {
      loadApiConfig({ ...base, API_TOKEN_LEAD: short });
    } catch (e) {
      expect(String(e)).not.toContain(short);
    }
    expect(() => loadApiConfig({ ...base, API_TOKEN_VIEW: token("a") })).toThrow(/distinct/);
    try {
      loadApiConfig({ ...base, API_TOKEN_VIEW: token("a") });
    } catch (e) {
      expect(String(e)).not.toContain(token("a"));
    }
  });

  it("loadApiConfig refuses a missing, short or duplicated API_TOKEN_INSPECTOR without printing it", () => {
    const { API_TOKEN_INSPECTOR: _i, ...missing } = base;
    expect(() => loadApiConfig(missing)).toThrow(/API_TOKEN_INSPECTOR is not set/);
    const short = "q".repeat(31);
    expect(() => loadApiConfig({ ...base, API_TOKEN_INSPECTOR: short })).toThrow(/API_TOKEN_INSPECTOR must be at least 32/);
    expect(() => loadApiConfig({ ...base, API_TOKEN_INSPECTOR: token("a") })).toThrow(/distinct/);
    expect(() => loadApiConfig({ ...base, API_TOKEN_INSPECTOR: token("e") })).toThrow(/distinct/);
    for (const bad of [short, token("a"), token("e")]) {
      let message = "";
      try {
        loadApiConfig({ ...base, API_TOKEN_INSPECTOR: bad });
      } catch (e) {
        message = String(e);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(bad);
    }
  });

  it("reads the inspector's display name from API_INSPECTOR_NAME", () => {
    expect(loadApiConfig({ ...base, API_INSPECTOR_NAME: "Durban port inspector" }).inspectorName).toBe("Durban port inspector");
  });

  it("refuses missing settings by name and bad supplier tokens", () => {
    const { DATABASE_URL: _d, ...missing } = base;
    expect(() => loadApiConfig(missing)).toThrow(/DATABASE_URL/);
    expect(() => loadApiConfig({ ...base, API_SUPPLIER_TOKENS: "not json" })).toThrow(/API_SUPPLIER_TOKENS/);
    expect(() => loadApiConfig({ ...base, API_SUPPLIER_TOKENS: JSON.stringify({ notAnAddress: token("e") }) })).toThrow(/API_SUPPLIER_TOKENS/);
  });
});
