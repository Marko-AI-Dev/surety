// The job lifecycle. The database check constraint lists the same 16 states.
export const JOB_STATES = [
  "DRAFT",
  "CREATE_PENDING",
  "LOCKED",
  "IN_PROGRESS",
  "DELIVERED",
  "EVALUATING",
  "APPROVED",
  "FINISH_PENDING",
  "PAID",
  "REJECTED_AWAITING_EXPIRY",
  "REVIEW_REQUIRED",
  "EXPIRED_AWAITING_CANCEL",
  "CANCEL_PENDING",
  "REFUNDED",
  "CREATE_FAILED",
  "RECONCILIATION_REQUIRED",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_STATES = ["PAID", "REFUNDED", "CREATE_FAILED"] as const satisfies readonly JobState[];

// Funded and unsettled: the escrow exists, so expiry must end in a cancel. RECONCILIATION_REQUIRED
// is frozen until a person resolves it, so the worker leaves it alone.
export const CANCELLABLE_STATES = [
  "LOCKED",
  "IN_PROGRESS",
  "DELIVERED",
  "EVALUATING",
  "APPROVED",
  "FINISH_PENDING",
  "REJECTED_AWAITING_EXPIRY",
  "REVIEW_REQUIRED",
  "EXPIRED_AWAITING_CANCEL",
  "CANCEL_PENDING",
] as const satisfies readonly JobState[];

const TRANSITIONS: Record<JobState, readonly JobState[]> = {
  DRAFT: ["CREATE_PENDING"],
  CREATE_PENDING: ["LOCKED", "CREATE_FAILED", "RECONCILIATION_REQUIRED"],
  LOCKED: ["IN_PROGRESS", "EXPIRED_AWAITING_CANCEL"],
  IN_PROGRESS: ["DELIVERED", "EXPIRED_AWAITING_CANCEL"],
  DELIVERED: ["EVALUATING", "EXPIRED_AWAITING_CANCEL"],
  EVALUATING: ["APPROVED", "REJECTED_AWAITING_EXPIRY", "REVIEW_REQUIRED", "EXPIRED_AWAITING_CANCEL"],
  APPROVED: ["FINISH_PENDING", "EXPIRED_AWAITING_CANCEL"],
  FINISH_PENDING: ["PAID", "RECONCILIATION_REQUIRED", "EXPIRED_AWAITING_CANCEL"],
  PAID: [],
  REJECTED_AWAITING_EXPIRY: ["EXPIRED_AWAITING_CANCEL"],
  REVIEW_REQUIRED: ["EXPIRED_AWAITING_CANCEL"],
  EXPIRED_AWAITING_CANCEL: ["CANCEL_PENDING"],
  CANCEL_PENDING: ["REFUNDED", "RECONCILIATION_REQUIRED"],
  REFUNDED: [],
  CREATE_FAILED: [],
  RECONCILIATION_REQUIRED: [],
};

export class TransitionError extends Error {
  constructor(
    readonly from: JobState,
    readonly to: JobState,
  ) {
    super(`transition ${from} -> ${to} is not allowed`);
    this.name = "TransitionError";
  }
}

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}
