import type { OfferReport } from "@surety/contracts";
import { foldText } from "@surety/gate";
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
// Folded (NFKC, no format characters, look-alikes to Latin), accents stripped, lower case.
const plain = (text: string) => foldText(text).normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
const wordsOf = (text: string) => plain(text).match(/\p{L}+/gu) ?? [];

// The first address or distinctive name word of another supplier that the text names, or null. Name
// words are 6 letters or more, minus common company words and any word in `allowed` (the goods, the
// port, the recipient's own name).
// The text is searched with everything but letters and digits removed, so spacing, hyphens or
// zero-width characters inside a name or a wallet don't hide it.
export function namesOtherSupplier(text: string, others: { address: string; name: string }[], allowed: string[]): string | null {
  const compactAddress = foldText(text).replace(/[^\p{L}\p{N}]/gu, "");
  const compactLetters = plain(text).replace(/[^\p{L}]/gu, "");
  const free = new Set(allowed.flatMap(wordsOf));
  for (const o of others) {
    if (compactAddress.includes(o.address)) return o.address;
    for (const w of wordsOf(o.name)) {
      if (w.length >= 6 && !STOP_WORDS.has(w) && !free.has(w) && compactLetters.includes(w)) return w;
    }
  }
  return null;
}
