import type { InvoiceDeliverable, SupplierQuote, TradeDocuments } from "@surety/contracts";

// What the gate asks a judge about one delivered job. No keys, payout instructions or secrets.
export interface EvaluationInput {
  requestId: string;
  // Which fixed question set the judge answers. The evidence goes in state, never in question text.
  questionSet: "invoice" | "trade";
  state: Record<string, unknown>;
  deliverableHash: string;
  jobSnapshotHash: string;
  policyVersion: string;
  // Seconds left before the decision cutoff (CancelAfter minus 30, by ledger time).
  secondsRemaining: number;
}

// The invoice job's evidence, keyed exactly as calibrated (docs/research/05-jev-calibration.md).
export function invoiceState(criteria: string, sourceText: string, deliverable: InvoiceDeliverable): Record<string, unknown> {
  return { task_criteria: criteria, source_invoice: sourceText, deliverable };
}

// A deal's evidence. Calibration and production both build it here, so they judge identical input.
// The quote goes in as agreed terms only: its free-text notes are supplier-written and stay out, so
// the model's reference for what was agreed carries no supplier instructions.
export function tradeState(purchaseOrder: string, quote: SupplierQuote, docs: TradeDocuments): Record<string, unknown> {
  const { notes: _notes, ...terms } = quote;
  return {
    purchase_order: purchaseOrder,
    accepted_quote: terms,
    commercial_invoice: docs.commercialInvoice,
    bill_of_lading: docs.billOfLading,
  };
}

export interface ScoreSample {
  satisfaction: number;
  injectionRisk: number;
}

// Normalized judge output. Scores are raw probabilities from the provider, or null when there are
// none: a missing score is never invented. "unavailable" can never approve.
export interface EvaluationResult {
  status: "ok" | "unavailable";
  mode: "live" | "fixture";
  satisfaction: number | null;
  injectionRisk: number | null;
  provider: string;
  model: string;
  latencyMs: number;
  reasonCodes: string[];
  requestId: string;
  evaluatedAt: string;
  costUsd: number | null;
  // Every answer behind the scores when a borderline result was asked again (median of three).
  samples?: ScoreSample[];
}

export interface DecisionEngine {
  readonly mode: "live" | "fixture";
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}
