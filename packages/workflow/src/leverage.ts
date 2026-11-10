import type { OfferReport } from "@surety/contracts";
import type { Invite, SourcingMessage } from "./sourcing-repo";
// A cycle with sourcing.ts, safe because supplierStatus is only called at run time.
import { supplierStatus } from "./sourcing";

// Leverage for the negotiator (Phase 4d): the competing offers it may play against each other. Only
// committed quotes and reports whose summary reached the lead count; never a held message, never an
// out supplier. Nothing here is derived from the buyer's maximum, so an offer above it still appears.

export interface Offer {
  supplier: string;
  unitCents: number;
  deliveryDays: number | null;
  source: "committed" | "reported";
  // When the report was made; null for a committed quote (its commit time isn't recorded).
  at: string | null;
}

export function leverageOffers(messages: SourcingMessage[], invites: Invite[]): Offer[] {
  const out: Offer[] = [];
  for (const i of invites) {
    if (supplierStatus(messages.filter((m) => m.supplier === i.address)) === "out") continue;
    if (i.quote) {
      out.push({ supplier: i.address, unitCents: i.quote.unitCents, deliveryDays: i.deliveryDays, source: "committed", at: null });
      continue;
    }
    const reports = messages.filter((m) => m.kind === "report" && m.supplier === i.address && m.verdict === "deliver" && m.offer);
    const latest = reports.at(-1);
    if (!latest) continue;
    const offer = latest.offer as OfferReport;
    out.push({ supplier: i.address, unitCents: offer.unitCents, deliveryDays: offer.deliveryDays, source: "reported", at: latest.createdAt });
  }
  return out;
}

const STOP_WORDS = new Set(["limited", "trading", "energy", "company", "solar"]);
const wordsOf = (text: string) => text.normalize("NFKC").toLowerCase().match(/\p{L}+/gu) ?? [];

// The first address or distinctive name word of another supplier that the text names, or null. Name
// words are 6 letters or more, minus common company words and any word in `allowed` (the goods, the
// port, the recipient's own name).
export function namesOtherSupplier(text: string, others: { address: string; name: string }[], allowed: string[]): string | null {
  const folded = text.normalize("NFKC");
  const said = new Set(wordsOf(text));
  const free = new Set(allowed.flatMap(wordsOf));
  for (const o of others) {
    if (folded.includes(o.address)) return o.address;
    for (const w of wordsOf(o.name)) {
      if (w.length >= 6 && !STOP_WORDS.has(w) && !free.has(w) && said.has(w)) return w;
    }
  }
  return null;
}
