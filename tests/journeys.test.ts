import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// AI journey testing drives a real browser with a model, so it is not part of `pnpm check`. What is
// checked here is that it can only ever be pointed at the practice backend, and that every journey is
// written the way AGENTS.md asks: a plain goal and a check against the record.
const root = resolve(import.meta.dirname, "..");
const runner = readFileSync(resolve(root, "journeys/surety_journeys.py"), "utf8");
const practice = readFileSync(resolve(root, "scripts/practice-backend.ts"), "utf8");

describe("the journeys runner", () => {
  it("refuses anything but the practice backend on this machine", () => {
    expect(runner).toContain("def must_be_practice()");
    expect(runner).toMatch(/main\(\):[\s\S]*must_be_practice\(\)[\s\S]*load_agent\(\)/);
    expect(runner).toContain('who.get("practice") is not True');
    expect(runner).toContain('("http://127.0.0.1:", "http://localhost:")');
  });

  it("holds no key and never prints one: the model keys stay in the agent checkout's own .env", () => {
    expect(runner).not.toMatch(/sk-[A-Za-z0-9-]{10,}/);
    expect(runner).not.toMatch(/print\([^)]*(KEY|environ)/);
    // The only token in the file is the practice backend's fixed, synthetic view token.
    expect(runner).toContain('VIEW = "V" * 40');
  });

  it("uses a headless browser of its own, never a person's", () => {
    for (const flag of ["--headless=new", "--user-data-dir=", "--disable-extensions"]) expect(runner).toContain(flag);
    expect(runner).toContain("tempfile.mkdtemp");
  });

  it("every journey has a name, a seed, a plain goal that names no button, and a check against the record", () => {
    const journeys = [...runner.matchAll(/dict\(\s*name="([^"]+)",\s*seed=(\w+),\s*goal=((?:\s*"[^"]*")+),\s*(?:#[^\n]*\n\s*)?ok=lambda s, d: ([^\n]+)/g)];
    expect(journeys.length).toBeGreaterThanOrEqual(6);
    for (const [, name, , goal, ok] of journeys) {
      expect(goal, name).not.toMatch(/\b(click|button|press|tap|switch|toggle|menu|panel|tab)\b/i);
      expect(ok, name).toMatch(/record\(\)|by_id\(d\)/);
    }
    // A no must be checked as "nothing moved", not only as "declined".
    expect(runner).toMatch(/"declined" and r\.get\("job"\) is None and r\.get\("create"\) is None/);
  });
});

describe("the practice backend", () => {
  it("listens on this machine only, uses the tests' stand-in signer, and says what it is", () => {
    expect(practice.match(/\.listen\(/g)?.length).toBe(2);
    expect(practice.match(/"127\.0\.0\.1"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(practice).toContain("FakeSigner");
    expect(practice).toContain("createMemoryRepo()");
    expect(practice).toContain("practice: true");
    expect(practice).not.toMatch(/process\.env\.(OPENROUTER|API_TOKEN|SIGNER|XRPL)/);
  });
});
