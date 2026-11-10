import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { loadApiConfig } from "../src/config";
import { addMissingTokens, renderApiEnv, renderSupplierEnv } from "../scripts/make-tokens";

const SUPPLIER = "rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U";
const SECOND = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";

describe("renderApiEnv", () => {
  it("writes five role tokens and one per supplier that Node's env parser and loadApiConfig read back", () => {
    let n = 0;
    const text = renderApiEnv([SUPPLIER, SECOND], () => `token-${++n}-${"x".repeat(40)}`);
    const env = parseEnv(text);
    expect(Object.keys(env).sort()).toEqual(["API_SUPPLIER_TOKENS", "API_TOKEN_INSPECTOR", "API_TOKEN_LEAD", "API_TOKEN_NEGOTIATOR", "API_TOKEN_SOURCING", "API_TOKEN_VIEW"]);
    const config = loadApiConfig({
      ...env,
      DATABASE_URL: "postgres://x",
      SIGNER_URL: "http://127.0.0.1:4100",
      SIGNER_HMAC_SECRET: "h".repeat(40),
      XRPL_WS_URL: "wss://x",
      OPENROUTER_API_KEY: "k",
    });
    expect(Object.keys(config.supplierTokens)).toEqual([SUPPLIER, SECOND]);
    expect(new Set([...Object.values(config.tokens), ...Object.values(config.supplierTokens)]).size).toBe(7);
  });

  it("addMissingTokens appends only API_TOKEN_INSPECTOR and leaves every existing line byte-identical", () => {
    let n = 0;
    const old = renderApiEnv([SUPPLIER], () => `old-${++n}-${"x".repeat(40)}`)
      .split("\n")
      .filter((l) => !l.startsWith("API_TOKEN_INSPECTOR="))
      .join("\n");
    const { text, added } = addMissingTokens(old, () => `new-token-${"y".repeat(40)}`);
    expect(added).toEqual(["API_TOKEN_INSPECTOR"]);
    expect(text.startsWith(old)).toBe(true);
    expect(text.split("\n").filter((l) => l.startsWith("API_TOKEN_INSPECTOR="))).toEqual([`API_TOKEN_INSPECTOR=new-token-${"y".repeat(40)}`]);
    expect(parseEnv(text).API_TOKEN_LEAD).toBe(parseEnv(old).API_TOKEN_LEAD);
    expect(parseEnv(text).API_SUPPLIER_TOKENS).toBe(parseEnv(old).API_SUPPLIER_TOKENS);
  });

  it("addMissingTokens reports key names only and adds nothing when every key is there", () => {
    const full = renderApiEnv([SUPPLIER], () => "z".repeat(48));
    expect(addMissingTokens(full, () => "w".repeat(48))).toEqual({ text: full, added: [] });
    const partial = addMissingTokens(`API_TOKEN_LEAD=${"a".repeat(48)}\n`, () => "w".repeat(48));
    expect(partial.added).toEqual(["API_TOKEN_SOURCING", "API_TOKEN_NEGOTIATOR", "API_TOKEN_VIEW", "API_TOKEN_INSPECTOR"]);
    expect(partial.added.join(" ")).not.toContain("w".repeat(48));
  });

  it("refuses an address that isn't an XRPL address", () => {
    expect(() => renderApiEnv(["not-an-address"], () => "t".repeat(40))).toThrow(/address/);
  });
});

describe("the supplier agents' own env file (final review, 10 Nov)", () => {
  it("renderSupplierEnv carries API_SUPPLIER_TOKENS only, with the same value, and no role token", () => {
    let n = 0;
    const api = renderApiEnv([SUPPLIER, SECOND], () => `token-${++n}-${"x".repeat(40)}`);
    const text = renderSupplierEnv(api);
    const env = parseEnv(text);
    expect(Object.keys(env)).toEqual(["API_SUPPLIER_TOKENS"]);
    expect(env.API_SUPPLIER_TOKENS).toBe(parseEnv(api).API_SUPPLIER_TOKENS);
    expect(text).not.toMatch(/API_TOKEN_/);
  });

  it("renderSupplierEnv refuses an .env.api without supplier tokens", () => {
    expect(() => renderSupplierEnv("API_TOKEN_LEAD=" + "a".repeat(48) + "\n")).toThrow(/API_SUPPLIER_TOKENS/);
  });
});
