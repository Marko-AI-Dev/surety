import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(import.meta.dirname, "../agents/paperclip");
const files = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => [f, readFileSync(resolve(DIR, f), "utf8")]));
const apiDoc = readFileSync(resolve(import.meta.dirname, "../docs/api.md"), "utf8");

// The routes docs/api.md defines, as "METHOD /path" with :params.
const documented = new Set([...apiDoc.matchAll(/^### `(GET|POST) ([^`]+)`/gm)].map((m) => `${m[1]} ${m[2]}`));
const toPattern = (route: string) => new RegExp(`^${route.replace(/:[a-z]+/gi, "[^/]+")}$`);

describe("the buyer team's Paperclip instructions", () => {
  it("has the lead, sourcing and negotiator instructions and the Surety API skill", () => {
    expect(Object.keys(files).sort()).toEqual(["lead.md", "negotiator.md", "sourcing.md", "surety-api.md"]);
  });

  it('no instruction file contains the maximum or the word "maximum" in the negotiator\'s file', () => {
    expect(files["negotiator.md"]).not.toMatch(/maximum|maxUnitCents|\bmax\b/i);
    for (const [name, text] of Object.entries(files)) {
      expect(text, name).not.toMatch(/12000|\$120(\.00)?\b|11000|\$110(\.00)?\b/);
    }
  });

  it("every curl in surety-api.md uses a route listed in docs/api.md", () => {
    const curls = [...files["surety-api.md"]!.matchAll(/curl[^\n]*?-X (GET|POST)[^\n]*?"\$SURETY_API_URL(\/[^"?]*)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(curls.length).toBeGreaterThanOrEqual(10);
    for (const c of curls) {
      const [method, path] = c.split(" ");
      const concrete = (path ?? "").replace(/\$[A-Z_]+/g, "00000000-0000-4000-8000-000000000000");
      const ok = [...documented].some((d) => {
        const [dm, dp] = d.split(" ");
        return dm === method && toPattern(dp ?? "").test(concrete);
      });
      expect(ok, c).toBe(true);
    }
  });

  it("no file contains a token-shaped string or a literal bearer token", () => {
    for (const [name, text] of Object.entries(files)) {
      expect(text, name).not.toMatch(/[A-Za-z0-9_-]{40,}/);
      for (const m of text.matchAll(/Bearer\s+(\S+)/g)) expect(m[1], name).toMatch(/^\$SURETY_API_TOKEN"?$/);
    }
  });

  it("every role is told to act only through the Surety API and never to open links", () => {
    for (const name of ["lead.md", "sourcing.md", "negotiator.md"]) {
      expect(files[name], name).toMatch(/surety-api\.md/);
      expect(files[name], name).toMatch(/never open links/i);
    }
  });
});

describe("the inspector's key stays with a person", () => {
  it("neither paperclip-team.ts, the supplier agents nor any instruction file mentions API_TOKEN_INSPECTOR or an /inspector route", () => {
    const root = resolve(import.meta.dirname, "..");
    const agentCode = [
      "scripts/paperclip-team.ts",
      ...readdirSync(resolve(root, "services/supplier-agents/src")).map((f) => `services/supplier-agents/src/${f}`),
    ];
    const sources: [string, string][] = [
      ...agentCode.map((f): [string, string] => [f, readFileSync(resolve(root, f), "utf8")]),
      ...Object.entries(files),
    ];
    expect(sources.length).toBeGreaterThanOrEqual(9);
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(/API_TOKEN_INSPECTOR|\/inspector\b|inspector:attest/);
    }
  });
});
