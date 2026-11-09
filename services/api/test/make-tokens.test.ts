import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { loadApiConfig } from "../src/config";
import { renderApiEnv } from "../scripts/make-tokens";

const SUPPLIER = "rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U";
const SECOND = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";

describe("renderApiEnv", () => {
  it("writes four role tokens and one per supplier that Node's env parser and loadApiConfig read back", () => {
    let n = 0;
    const text = renderApiEnv([SUPPLIER, SECOND], () => `token-${++n}-${"x".repeat(40)}`);
    const env = parseEnv(text);
    expect(Object.keys(env).sort()).toEqual(["API_SUPPLIER_TOKENS", "API_TOKEN_LEAD", "API_TOKEN_NEGOTIATOR", "API_TOKEN_SOURCING", "API_TOKEN_VIEW"]);
    const config = loadApiConfig({
      ...env,
      DATABASE_URL: "postgres://x",
      SIGNER_URL: "http://127.0.0.1:4100",
      SIGNER_HMAC_SECRET: "h".repeat(40),
      XRPL_WS_URL: "wss://x",
      OPENROUTER_API_KEY: "k",
    });
    expect(Object.keys(config.supplierTokens)).toEqual([SUPPLIER, SECOND]);
    expect(new Set([...Object.values(config.tokens), ...Object.values(config.supplierTokens)]).size).toBe(6);
  });

  it("refuses an address that isn't an XRPL address", () => {
    expect(() => renderApiEnv(["not-an-address"], () => "t".repeat(40))).toThrow(/address/);
  });
});
