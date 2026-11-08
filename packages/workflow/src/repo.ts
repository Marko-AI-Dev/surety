import { isDrops } from "@surety/contracts";
import type { Operation } from "./operation-id";
import type { JobState } from "./states";

export interface Job {
  id: string;
  ref: string;
  network: "testnet";
  buyerAddress: string;
  sellerAddress: string;
  amountDrops: string;
  sourceText: string;
  criteria: unknown;
  snapshotHash: string;
  policyVersion: string;
  cancelAfterSeconds: number;
  // What the judge is asked to check, frozen with the job. Null for jobs created before the gate.
  criteriaText: string | null;
  // The seller's answer exactly as delivered, and its canonical hash. Null until delivery.
  deliverable: unknown;
  deliverableHash: string | null;
  state: JobState;
  version: number;
}

export type NewJob = Omit<
  Job,
  "id" | "network" | "snapshotHash" | "state" | "version" | "criteriaText" | "deliverable" | "deliverableHash"
> & { criteriaText?: string };

export type DecisionOutcome = "APPROVE" | "DECLINE" | "ESCALATE" | "UNAVAILABLE";

// One judgement of one deliverable. mode, provider and model are null when no engine was asked.
export interface NewDecision {
  jobId: string;
  requestId: string;
  mode: "live" | "fixture" | null;
  outcome: DecisionOutcome;
  satisfaction: number | null;
  injectionRisk: number | null;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  reasonCodes: string[];
  rules: unknown;
  policyVersion: string;
  deliverableHash: string;
}

export interface Decision extends NewDecision {
  id: string;
  decidedAt: string;
}

export interface NewAuthorization {
  decisionId: string;
  jobId: string;
  attempt: number;
  operationId: string;
  bindingHash: string;
  signed: unknown;
  // ISO timestamp.
  expiresAt: string;
}

export interface AuthorizationRow extends NewAuthorization {
  id: string;
  consumedAt: string | null;
}

export interface EscrowRow {
  jobId: string;
  owner: string;
  offerSequence: number;
  destination: string;
  amountDrops: string;
  condition: string;
  // Ripple epoch seconds.
  cancelAfter: number;
  createTxHash: string;
  createLedgerIndex: number;
}

export interface JobEvent {
  id: number;
  jobId: string;
  fromState: JobState | null;
  toState: JobState;
  actor: string;
  reasonCodes: string[];
  correlationId: string | null;
  detail: unknown;
  createdAt: string;
}

export interface TransitionEvent {
  actor: string;
  reasonCodes: string[];
  correlationId?: string;
  detail?: unknown;
}

export interface PendingTx {
  operationId: string;
  jobId: string;
  type: Operation;
}

export interface TxOutcome {
  // null when the signer refused before anything reached the ledger.
  txHash: string | null;
  status: "validated" | "failed";
  result: string;
  ledgerIndex?: number;
  feeDrops?: string;
}

export interface TxRecord {
  operationId: string;
  jobId: string;
  type: Operation;
  txHash: string | null;
  status: "pending" | "validated" | "failed";
  result: string | null;
  ledgerIndex: number | null;
  feeDrops: string | null;
}

export interface DueForCancel {
  job: Job;
  escrow: EscrowRow;
}

// The database is a mirror of the ledger. Every state change goes through transition(), which
// checks the allowed-transition map and the current state and appends the event atomically.
export interface JobsRepo {
  createJob(input: NewJob): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  getEscrow(jobId: string): Promise<EscrowRow | null>;
  transition(jobId: string, from: JobState, to: JobState, event: TransitionEvent): Promise<Job>;
  attachEscrow(row: EscrowRow): Promise<void>;
  recordPendingTx(t: PendingTx): Promise<void>;
  completeTx(operationId: string, r: TxOutcome): Promise<void>;
  listTransactions(jobId: string): Promise<TxRecord[]>;
  listDueForCancel(ledgerCloseTime: number): Promise<DueForCancel[]>;
  // CREATE_PENDING jobs a crash may have left behind: any with an escrow row, or with a pending create
  // transaction at least minPendingAgeSeconds old by the store's clock (database time for Postgres).
  listFundingToResume(minPendingAgeSeconds: number): Promise<Job[]>;
  listEvents(jobId: string): Promise<JobEvent[]>;
  listJobsInStates(states: JobState[]): Promise<Job[]>;
  // Stores the first deliverable for a job. The same hash again is "duplicate" and changes nothing; a
  // different hash throws DeliverableConflict: a delivered answer is never replaced.
  saveDeliverable(jobId: string, raw: unknown, hash: string): Promise<"saved" | "duplicate">;
  // Throws DecisionConflict when the job already has a decision for this deliverable hash.
  recordDecision(d: NewDecision): Promise<Decision>;
  // Adds one to the job's evaluation resume count and returns the new count.
  noteEvaluationResume(jobId: string): Promise<number>;
  latestDecision(jobId: string): Promise<Decision | null>;
  // Throws AuthorizationConflict when the decision already has this attempt or the opId is taken.
  recordAuthorization(a: NewAuthorization): Promise<AuthorizationRow>;
  // The highest-attempt authorization for the decision that has not been consumed.
  openAuthorization(decisionId: string): Promise<AuthorizationRow | null>;
  consumeAuthorization(id: string): Promise<void>;
  close(): Promise<void>;
}

const HASH = /^[0-9a-f]{64}$/;

export function assertHash(value: string): void {
  if (!HASH.test(value)) throw new RangeError("deliverable hash must be 64 lowercase hex characters");
}

// A different deliverable arrived for a job that already has one. Changed submissions are refused.
export class DeliverableConflict extends Error {
  constructor(
    readonly jobId: string,
    readonly storedHash: string,
    readonly givenHash: string,
  ) {
    super(`job ${jobId} already has a different deliverable`);
    this.name = "DeliverableConflict";
  }
}

// The job already has a decision for this deliverable: another evaluator recorded it first.
export class DecisionConflict extends Error {
  constructor(
    readonly jobId: string,
    readonly deliverableHash: string,
  ) {
    super(`job ${jobId} already has a decision for this deliverable`);
    this.name = "DecisionConflict";
  }
}

// This decision already has an authorization for the attempt, or the operation id is in use:
// another pass minted it first.
export class AuthorizationConflict extends Error {
  constructor(
    readonly decisionId: string,
    readonly attempt: number,
  ) {
    super(`decision ${decisionId} already has authorization attempt ${attempt}`);
    this.name = "AuthorizationConflict";
  }
}

// numeric(20,0) would silently round "1.5" or parse "1e6", leaving the snapshot hash describing a
// different amount from the one stored. Reject before writing anything.
export function assertDrops(value: string): void {
  if (!isDrops(value)) throw new RangeError("amountDrops must be a positive integer drop string");
}

// The row was not in the expected from-state: another actor moved it first.
export class TransitionConflict extends Error {
  constructor(
    readonly jobId: string,
    readonly from: JobState,
  ) {
    super(`job ${jobId} is no longer in state ${from}`);
    this.name = "TransitionConflict";
  }
}
