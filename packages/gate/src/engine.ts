import type { InvoiceDeliverable } from "@surety/contracts";

// What the gate asks a judge about one delivered job. No keys, payout instructions or secrets.
export interface EvaluationInput {
  requestId: string;
  criteria: string;
  sourceText: string;
  deliverable: InvoiceDeliverable;
  deliverableHash: string;
  jobSnapshotHash: string;
  policyVersion: string;
  // Seconds left before the decision cutoff (CancelAfter minus 30, by ledger time).
  secondsRemaining: number;
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
}

export interface DecisionEngine {
  readonly mode: "live" | "fixture";
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}
