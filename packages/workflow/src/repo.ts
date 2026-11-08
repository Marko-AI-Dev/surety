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
  state: JobState;
  version: number;
}

export type NewJob = Omit<Job, "id" | "network" | "snapshotHash" | "state" | "version">;

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
  close(): Promise<void>;
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
