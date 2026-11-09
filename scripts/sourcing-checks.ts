// The pass/fail checks for the agent team's live testnet run (Phase 4c, Task 12), pure so they are
// unit-tested. scripts/sourcing-evidence.ts gathers the data from the database, the API and the ledger.

export interface SourcingEvidence {
  maxUnitCents: number;
  crook: string;
  stranger: string;
  invites: { address: string; status: "in" | "out"; cards: string[]; quote: { unitCents: number; quantity: number; totalCents: number } | null }[];
  // Every message the bouncer held, as the supplier wrote it.
  quarantinedBodies: string[];
  // The negotiator's view and inbox exactly as its token received them, at the end of the run.
  negotiatorView: string;
  negotiatorInbox: string;
  suggestions: string[];
  selectedSupplier: string | null;
  jobState: string | null;
  finishResult: string | null;
  treasury: { before: bigint | null; after: bigint | null };
  totalCents: bigint;
  leadReasons: string[];
}

export function sourcingChecks(e: SourcingEvidence) {
  const crook = e.invites.find((i) => i.address === e.crook);
  const valid = e.invites.filter((i) => i.status === "in" && i.quote !== null && i.quote.unitCents <= e.maxUnitCents);
  const cheapest = valid.reduce<(typeof valid)[number] | null>((best, i) => (!best || (i.quote?.unitCents ?? 0) < (best.quote?.unitCents ?? 0) ? i : best), null);
  const max = String(e.maxUnitCents);
  return {
    crookOut: crook !== undefined && crook.status === "out" && crook.cards.length > 0,
    quarantinedNeverInInbox: e.quarantinedBodies.every((b) => !e.negotiatorInbox.includes(b)),
    maxNeverShownToNegotiator: [e.negotiatorView, e.negotiatorInbox].every((t) => !t.includes("maxUnitCents") && !t.includes(max)),
    strangerSuggestedNotInvited: e.suggestions.includes(e.stranger) && !e.invites.some((i) => i.address === e.stranger),
    winnerIsCheapestValidCommitted: cheapest !== null && e.selectedSupplier === cheapest.address,
    paidFinishValidated: e.jobState === "PAID" && e.finishResult === "tesSUCCESS",
    treasuryDownByExactlyTotal: e.treasury.before !== null && e.treasury.after !== null && e.treasury.before - e.treasury.after === e.totalCents,
    everyLeadDecisionHasReason: e.leadReasons.length > 0 && e.leadReasons.every((r) => r.trim().length > 0),
  };
}
