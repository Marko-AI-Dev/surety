import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The working rules every session starts from, and the one command that must pass before a commit.
const root = resolve(import.meta.dirname, "..");
const read = (name: string) => (existsSync(resolve(root, name)) ? readFileSync(resolve(root, name), "utf8") : "");

describe("the rules files", () => {
  it("AGENTS.md holds the non-negotiables and how to work, and points at the product and design files", () => {
    const agents = read("AGENTS.md");
    expect(agents).toMatch(/^# AGENTS\.md/);
    for (const heading of ["## Non-negotiables", "## How to work"]) expect(agents).toContain(heading);
    for (const file of ["PRODUCT.md", "DESIGN.md", "docs/product-vision.md"]) expect(agents).toContain(file);
    // The rules that protect the money and the keys are written down, not remembered.
    for (const rule of [/testnet only/i, /pnpm check:boundaries/, /buyer's yes/i, /evidence\//, /existing migration/i, /never weaken a test/i, /fail closed/i]) expect(agents).toMatch(rule);
    expect(agents).toContain("pnpm check");
  });

  it("CLAUDE.md only sends the reader to AGENTS.md", () => {
    const claude = read("CLAUDE.md");
    expect(claude).toContain("AGENTS.md");
    expect(claude.trim().split("\n").length).toBeLessThanOrEqual(3);
  });

  it("DESIGN.md describes the design system the code really uses", () => {
    const design = read("DESIGN.md");
    for (const token of ["--money", "--ok", "--held", "--stop", "--glass", "data-theme"]) expect(design).toContain(token);
    for (const path of ["apps/web/src/styles.css", "apps/web/src/app.css", "apps/web/src/components/ui"]) {
      expect(design).toContain(path);
      expect(existsSync(resolve(root, path)), path).toBe(true);
    }
  });

  it("no rules file uses a long dash", () => {
    for (const name of ["AGENTS.md", "CLAUDE.md", "DESIGN.md"]) expect(read(name), name).not.toMatch(/[\u2013\u2014]| -- /);
  });
});

describe("the one check command", () => {
  it("pnpm check runs the typecheck, the tests, the key boundary check and the web build", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts.check).toBeDefined();
    for (const part of ["pnpm typecheck", "pnpm test", "pnpm check:boundaries", "pnpm web:build"]) expect(scripts.check).toContain(part);
  });
});
