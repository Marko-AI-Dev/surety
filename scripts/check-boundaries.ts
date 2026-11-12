// A tripwire lint: fails if any file outside services/signer uses a known key-handling call or
// secret variable name. It catches mistakes, not a determined bypass; the real boundary is that
// the seeds live only in the signer's own secrets file and process.
// Patterns are assembled from pieces so this file does not match itself.
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface Violation {
  file: string;
  pattern: string;
}

const PATTERNS = [
  ["from", "Seed"],
  ["from", "Secret"],
  ["from", "Mnemonic"],
  ["from", "Entropy"],
  ["fund", "Wallet"],
  ["derive", "Keypair"],
  ["new ", "Wallet("],
  ["Wallet.", "generate"],
  ["_", "SEED"],
  ["PREIMAGE", "_KEY"],
  ["secret", "box"],
].map((parts) => parts.join(""));

// .worktrees holds git worktree copies of this repo, each with its own services/signer.
const SKIP_DIRS = new Set(["node_modules", ".git", ".superpowers", ".worktrees", "dist", "docs", "evidence"]);
const SIGNER_DIR = "services/signer";
const SCANNED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".sh", ".ps1", ".py",
]);

export function checkBoundaries(root: string): Violation[] {
  const violations: Violation[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split("\\").join("/");
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || rel === SIGNER_DIR) continue;
        walk(full);
      } else if (SCANNED_EXTENSIONS.has(extname(entry.name))) {
        const text = readFileSync(full, "utf8");
        for (const pattern of PATTERNS) {
          if (text.includes(pattern)) violations.push({ file: rel, pattern });
        }
      }
    }
  };
  walk(root);
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const found = checkBoundaries(resolve(import.meta.dirname, ".."));
  if (found.length > 0) {
    for (const v of found) console.error(`key boundary violation: ${v.file} contains "${v.pattern}"`);
    process.exit(1);
  }
  console.log("Key boundary OK: no key handling outside services/signer.");
}
