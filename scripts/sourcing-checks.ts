// The pass/fail checks for the agent team's live testnet runs (Phase 4c Task 12, Phase 4d Task 8), pure
// so they are unit-tested. scripts/sourcing-evidence.ts gathers the data from the database, the API and
// the ledger. A run is either "paid" (the inspector attested, Verify released) or "refunded" (the
// inspector refused, Verify failed rule attested, the escrow was cancelled at the deadline).
import type { SourcingBrief } from "@surety/contracts";
import { normalizeBlNumber } from "@surety/gate";
import { namesOtherSupplier, rankQuotes } from "@surety/workflow";

export interface SourcingEvidence {
  brief: SourcingBrief;
  crook: string;
  // The crook still had cards from an earlier sourcing when this one opened, so it was on hold and
  // could not be invited.
  crookHeldAtStart: boolean;
  stranger: string;
  invites: {
    address: string;
    name: string;
    status: "in" | "out";
    cards: string[];
    quote: { unitCents: number; quantity: number; totalCents: number } | null;
    deliveryDays: number | null;
  }[];
  // The negotiator's reports, oldest first.
  reports: { supplier: string; unitCents: number; deliveryDays: number; at: string }[];
  // What the negotiator sent, and to whom.
  negotiatorMessages: { supplier: string; text: string }[];
  // Every message the bouncer held, as the supplier wrote it.
  quarantinedBodies: string[];
  // The negotiator's view and inbox exactly as its token received them, at the end of the run.
  negotiatorView: string;
  negotiatorInbox: string;
  suggestions: string[];
  selectedSupplier: string | null;
  // Deal notes on the selected deal (events that change nothing, such as off_priority).
  notes: { reasonCodes: string[]; detail: unknown }[];
  jobState: string | null;
  finishResult: string | null;
  cancelResult: string | null;
  decisionReasonCodes: string[];
  attestation: { outcome: "attested" | "refused"; blNumber: string; at: string } | null;
  // The B/L number in the documents the supplier delivered.
  deliveredBl: string | null;
  paidAt: string | null;
  treasury: { before: bigint | null; after: bigint | null };
  totalCents: bigint;
  leadReasons: string[];
}

const AMOUNTS = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\bUSD\s?(\d[\d,]*(?:\.\d{1,2})?)/gi;
const centsIn = (text: string) => [...text.matchAll(AMOUNTS)].map((m) => Math.round(Number((m[1] ?? m[2] ?? "").replace(/,/g, "")) * 100));

export function sourcingChecks(e: SourcingEvidence, expect: "paid" | "refunded") {
  const crook = e.invites.find((i) => i.address === e.crook);
  const max = String(e.brief.goods.maxUnitCents);
  const committed = e.invites.filter((i) => i.quote !== null);
  const best = rankQuotes(
    e.brief,
    committed.map((i) => ({ supplier: i.address, status: i.status, unitCents: i.quote?.unitCents ?? 0, deliveryDays: i.deliveryDays })),
  ).find((q) => q.eligible);
  const noted = e.notes.some((n) => n.reasonCodes.includes("off_priority") && String((n.detail as { reason?: unknown } | null)?.reason ?? "").trim().length > 0);
  const winner = e.invites.find((i) => i.address === e.selectedSupplier);
  const firstReport = e.reports.find((r) => r.supplier === e.selectedSupplier);
  const others = (supplier: string) => e.invites.filter((i) => i.address !== supplier);
  const allowed = (supplier: string) => [e.brief.goods.description, e.brief.port, e.invites.find((i) => i.address === supplier)?.name ?? ""];
  const citesCompetitor = e.negotiatorMessages.some((m) =>
    centsIn(m.text).some((c) => e.reports.some((r) => r.supplier !== m.supplier && r.unitCents === c)),
  );
  const namesNoOne = e.negotiatorMessages.every((m) => namesOtherSupplier(m.text, others(m.supplier), allowed(m.supplier)) === null);

  const base = {
    // The crook never gets a deal: carded out in this sourcing, or left out because it was on hold.
    crookKeptOut: e.selectedSupplier !== e.crook && (crook !== undefined ? crook.status === "out" && crook.cards.length > 0 : e.crookHeldAtStart),
    quarantinedNeverInInbox: e.quarantinedBodies.every((b) => !e.negotiatorInbox.includes(b)),
    maxNeverShownToNegotiator: [e.negotiatorView, e.negotiatorInbox].every((t) => !t.includes("maxUnitCents") && !t.includes(max)),
    strangerSuggestedNotInvited: e.suggestions.includes(e.stranger) && !e.invites.some((i) => i.address === e.stranger),
    everyLeadDecisionHasReason: e.leadReasons.length > 0 && e.leadReasons.every((r) => r.trim().length > 0),
    winnerBestForPriorityOrNoted: e.selectedSupplier !== null && (best?.supplier === e.selectedSupplier || noted),
    negotiationMovedPrice: winner?.quote != null && firstReport !== undefined && winner.quote.unitCents < firstReport.unitCents,
    leverageCitedAnonymously: citesCompetitor && namesNoOne,
    committedQuotesCarryDeliveryDays: committed.length > 0 && committed.every((i) => i.deliveryDays !== null),
  };
  const a = e.attestation;
  if (expect === "paid") {
    return {
      ...base,
      paidFinishValidated: e.jobState === "PAID" && e.finishResult === "tesSUCCESS",
      treasuryDownByExactlyTotal: e.treasury.before !== null && e.treasury.after !== null && e.treasury.before - e.treasury.after === e.totalCents,
      inspectionAttestedBeforePaid:
        a !== null &&
        a.outcome === "attested" &&
        e.deliveredBl !== null &&
        normalizeBlNumber(a.blNumber) === normalizeBlNumber(e.deliveredBl) &&
        e.paidAt !== null &&
        Date.parse(a.at) < Date.parse(e.paidAt),
    };
  }
  return {
    ...base,
    refusedAttestationRefunded:
      e.decisionReasonCodes.includes("rule:attested") && e.jobState === "REFUNDED" && e.cancelResult === "tesSUCCESS" && e.finishResult === null,
    treasuryBackToBefore: e.treasury.before !== null && e.treasury.after !== null && e.treasury.before === e.treasury.after,
  };
}
