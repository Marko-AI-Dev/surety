import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBoundaries } from "../scripts/check-boundaries";

const ROOT = resolve(import.meta.dirname, "..");
// Pattern names assembled from pieces so this file does not trip the check it tests.
const wantFromSeed = "from" + "Seed";
const wantEnvSeed = "_SE" + "ED";
const wantPreimageKey = "PREIMAGE" + "_KEY";

function fixture(relativePath: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), "surety-boundary-"));
  const file = join(root, relativePath);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
  return root;
}

describe("key boundary", () => {
  it("skips git worktree copies under .worktrees, which hold their own services/signer", () => {
    const root = fixture(".worktrees/review/services/signer/scripts/init.ts", `Wallet.${wantFromSeed}(process.env.BUYER${wantEnvSeed})`);
    expect(checkBoundaries(root)).toEqual([]);
  });

  it("finds no key handling outside services/signer in this repo", () => {
    expect(checkBoundaries(ROOT)).toEqual([]);
  });

  it("flags a seed being turned into a wallet outside the signer", () => {
    const root = fixture("packages/web/src/bad.ts", `const w = Wallet.${"from"}Seed(process.env.X);`);
    expect(checkBoundaries(root)).toEqual([{ file: "packages/web/src/bad.ts", pattern: wantFromSeed }]);
  });

  it("flags reading a seed or the preimage key from the environment", () => {
    const seed = fixture("scripts/leak.ts", `console.log(process.env.BUYER${"_SE"}ED)`);
    expect(checkBoundaries(seed)).toEqual([{ file: "scripts/leak.ts", pattern: wantEnvSeed }]);
    const key = fixture("apps/api/src/k.ts", `const k = process.env.PREIMAGE${"_KEY"}`);
    expect(checkBoundaries(key)).toEqual([{ file: "apps/api/src/k.ts", pattern: wantPreimageKey }]);
  });

  it.each([
    ["from", "Secret("],
    ["from", "Mnemonic("],
    ["from", "Entropy("],
    ["fund", "Wallet("],
    ["derive", "Keypair("],
    ["new ", "Wallet("],
  ])("flags the key-handling alias %s%s", (a, b) => {
    const root = fixture("packages/web/src/alias.ts", `const w = x.${a}${b}y);`);
    expect(checkBoundaries(root).map((v) => v.file)).toEqual(["packages/web/src/alias.ts"]);
  });

  it("scans scripts and config files, not only code", () => {
    const ps1 = fixture("scripts/setup.ps1", `Write-Host $env:BUYER${"_SE"}ED`);
    expect(checkBoundaries(ps1)).toEqual([{ file: "scripts/setup.ps1", pattern: wantEnvSeed }]);
    const json = fixture("config/x.json", `{"k": "PREIMAGE${"_KEY"}"}`);
    expect(checkBoundaries(json)).toEqual([{ file: "config/x.json", pattern: wantPreimageKey }]);
  });

  it("allows the same code inside services/signer", () => {
    const root = fixture("services/signer/src/main.ts", `const w = Wallet.${"from"}Seed(process.env.BUYER${"_SE"}ED);`);
    expect(checkBoundaries(root)).toEqual([]);
  });
});
