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
  API_SUPPLIER_TOKENS: JSON.stringify({ [SUPPLIER]: token("e") }),
};

describe("loadApiConfig", () => {
  it("reads the defaults and every token", () => {
    const c = loadApiConfig(base);
    expect(c).toMatchObject({
      host: "127.0.0.1",
      port: 4200,
      directoryFile: "fixtures/sourcing/directory.json",
      tokens: { lead: token("a"), sourcing: token("b"), negotiator: token("c"), view: token("d") },
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

  it("refuses missing settings by name and bad supplier tokens", () => {
    const { DATABASE_URL: _d, ...missing } = base;
    expect(() => loadApiConfig(missing)).toThrow(/DATABASE_URL/);
    expect(() => loadApiConfig({ ...base, API_SUPPLIER_TOKENS: "not json" })).toThrow(/API_SUPPLIER_TOKENS/);
    expect(() => loadApiConfig({ ...base, API_SUPPLIER_TOKENS: JSON.stringify({ notAnAddress: token("e") }) })).toThrow(/API_SUPPLIER_TOKENS/);
  });
});
