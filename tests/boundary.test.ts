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

  it("allows the same code inside services/signer", () => {
    const root = fixture("services/signer/src/main.ts", `const w = Wallet.${"from"}Seed(process.env.BUYER${"_SE"}ED);`);
    expect(checkBoundaries(root)).toEqual([]);
  });
});
