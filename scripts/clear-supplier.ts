// The operator clears a supplier's cards after looking into them (for example a phone call to a known
// number). A supplier with any card since its last review is on hold and can't be invited.
// Run: pnpm supplier:clear <address> "<note>"
import { resolve } from "node:path";
import { Address } from "@surety/contracts";
import { type SourcingRepo, type SupplierReview, createPgRepo } from "@surety/workflow";

export async function clearSupplier(repo: Pick<SourcingRepo, "addReview">, address: string, note: string): Promise<SupplierReview> {
  if (!Address.safeParse(address).success) throw new Error(`${address} is not an XRPL address`);
  if (!note.trim()) throw new Error("a note is required: say why the cards are cleared");
  return repo.addReview(address, note.trim());
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [address = "", note = ""] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (run with pnpm supplier:clear)");
  const repo = createPgRepo(url);
  try {
    const review = await clearSupplier(repo, address, note);
    console.log(`Cleared ${review.address} at ${review.clearedAt}: ${review.note}`);
  } finally {
    await repo.close();
  }
}
