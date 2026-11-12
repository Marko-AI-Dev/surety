import type { DealIntent, SupplierQuote } from "@surety/contracts";
import type { CheckReport } from "@surety/gate";
import type { DealState } from "./deal-states";
import type { Job, NewJob } from "./repo";

// The deal agent's answer and what Surety did with it. final differs from agent.outcome only when
// the agent accepted a quote that fails the hard checks: the accept is overruled.
export interface QuoteDecision {
  agent: { outcome: "accept" | "decline"; reason: string; kind: "agent" | "stand-in"; model: string | null };
  final: "accept" | "decline";
  reasonCodes: string[];
}

export interface Deal {
  id: string;
  // The purchase order number. Also the escrow job's ref once the quote is accepted.
  ref: string;
  intent: DealIntent;
  intentHash: string;
  quote: SupplierQuote | null;
  quoteHash: string | null;
  quoteChecks: CheckReport<string> | null;
  decision: QuoteDecision | null;
  state: DealState;
  jobId: string | null;
  version: number;
  createdAt: string;
}

export interface DealEvent {
  id: number;
  dealId: string;
  fromState: DealState | null;
  toState: DealState;
  actor: string;
  reasonCodes: string[];
  detail: unknown;
  createdAt: string;
}

export interface DealEventInput {
  actor: string;
  reasonCodes: string[];
  detail?: unknown;
}

// Every deal change writes its event in the same step, and accepting a quote creates the escrow job
// in that same step, so a crash can never leave an accepted deal without its job or a job without its deal.
export interface DealsRepo {
  createDeal(intent: DealIntent, state: "AWAITING_QUOTE" | "POLICY_REFUSED", event: DealEventInput): Promise<Deal>;
  getDeal(id: string): Promise<Deal | null>;
  getDealByJob(jobId: string): Promise<Deal | null>;
  // Newest first.
  listDeals(limit: number): Promise<Deal[]>;
  listDealEvents(dealId: string): Promise<DealEvent[]>;
  // AWAITING_QUOTE to QUOTE_RECEIVED. The same quote hash again returns the deal unchanged; a different
  // quote throws QuoteConflict: a quote is never replaced.
  saveQuote(dealId: string, quote: SupplierQuote, quoteHash: string, checks: CheckReport<string>, event: DealEventInput): Promise<Deal>;
  // QUOTE_RECEIVED to DECLINED.
  declineDeal(dealId: string, decision: QuoteDecision, event: DealEventInput): Promise<Deal>;
  // QUOTE_RECEIVED to ACCEPTED, creating the job. An already ACCEPTED deal returns its existing pair.
  acceptDeal(dealId: string, decision: QuoteDecision, job: NewJob, event: DealEventInput): Promise<{ deal: Deal; job: Job }>;
  // A note in the deal's record that changes nothing: an event from and to its current state.
  // A missing deal throws DealTransitionConflict.
  addDealNote(dealId: string, event: DealEventInput): Promise<DealEvent>;
}

// Another deal already uses this purchase order number.
export class DealConflict extends Error {
  constructor(readonly ref: string) {
    super(`a deal with PO number ${ref} already exists`);
    this.name = "DealConflict";
  }
}

// A different quote arrived for a deal that already has one.
export class QuoteConflict extends Error {
  constructor(readonly dealId: string) {
    super(`deal ${dealId} already has a different quote`);
    this.name = "QuoteConflict";
  }
}

// The deal is not in a state that allows this step, or another actor moved it first.
export class DealTransitionConflict extends Error {
  constructor(
    readonly dealId: string,
    readonly state: DealState | "missing",
    readonly wanted: DealState,
  ) {
    super(`deal ${dealId} is ${state}; it cannot move to ${wanted}`);
    this.name = "DealTransitionConflict";
  }
}
