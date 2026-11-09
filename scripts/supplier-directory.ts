// The demo supplier directory: display names and personas for the signer's approved suppliers, plus
// the stranger the sourcing agent may suggest. Addresses only; no secrets.
// Run: pnpm suppliers:directory  (needs the signer up; writes fixtures/sourcing/directory.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createSignerClient } from "@surety/signer-client";
import { ATTACKER, SUPPLIER, SUPPLIER_NAME } from "./deal-fixtures";

export interface DirectoryEntry {
  address: string;
  name: string;
  persona: "brightway" | "sunpeak" | "coastline" | "lowtide";
}

// Brightway is the 4b demo supplier; the next two approved wallets become Sunpeak (too expensive) and
// Coastline (the crook); the stranger, Lowtide, is not approved and can only be suggested.
export function buildDirectory(approved: string[], stranger: string): DirectoryEntry[] {
  if (!approved.includes(SUPPLIER)) throw new Error(`the Brightway wallet ${SUPPLIER} must be an approved supplier`);
  const others = approved.filter((a) => a !== SUPPLIER && a !== stranger);
  if (others.length < 2) throw new Error("the demo needs three approved suppliers: Brightway and two more");
  return [
    { address: SUPPLIER, name: SUPPLIER_NAME, persona: "brightway" },
    { address: others[0] as string, name: "Sunpeak Energy Ltd", persona: "sunpeak" },
    { address: others[1] as string, name: "Coastline Trading Co.", persona: "coastline" },
    { address: stranger, name: "Lowtide Trading", persona: "lowtide" },
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const url = process.env.SIGNER_URL;
  const secret = process.env.SIGNER_HMAC_SECRET;
  if (!url || !secret) throw new Error("SIGNER_URL and SIGNER_HMAC_SECRET are not set (run with pnpm suppliers:directory)");
  const health = await createSignerClient({ url, hmacSecret: secret }).health();
  if (!health.testUsd) throw new Error("the signer has TESTUSD off; start it with .env.testusd");
  const entries = buildDirectory(health.testUsd.approvedSuppliers, ATTACKER);
  const out = resolve(import.meta.dirname, "../fixtures/sourcing/directory.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(entries, null, 2)}\n`);
  for (const e of entries) console.log(`${e.persona.padEnd(10)} ${e.address}  ${e.name}`);
}
