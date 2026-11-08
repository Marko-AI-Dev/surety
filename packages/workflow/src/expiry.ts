import { type SignerClient, SignerClientError } from "@surety/signer-client";
import { fundJob } from "./fund";
import { operationId } from "./operation-id";
import { type EscrowRow, type Job, type JobsRepo, TransitionConflict } from "./repo";
import { TransitionError } from "./states";

export const EXPIRY_ACTOR = "expiry-worker";

export interface SweepDeps {
  repo: JobsRepo;
  signer: SignerClient;
  // Validated ledger close time in Ripple seconds. Never the laptop clock.
  ledgerCloseTime: () => Promise<number>;
  log?: (line: string) => void;
}

export interface SweepReport {
  closeTime: number;
  refunded: string[];
  pending: string[];
  reconciliation: string[];
}

// The escrow is not where the database says: someone else settled it, or the mirror is wrong.
// A person must look; the job is frozen and never reported as refunded.
const RECONCILE = new Set(["escrow_not_found", "escrow_mismatch"]);

// op_failed means this attempt's cancel is dead (failed on the ledger or can never be included); the
// next attempt gets a new opId so the signer re-checks the escrow and signs afresh. Bounded, then a person.
const MAX_CANCEL_ATTEMPTS = 3;

// A pending create younger than this may still belong to a live caller; leave it to them.
const RESUME_FUNDING_AFTER_SECONDS = 30;

const reasonOf = (e: unknown) => (e instanceof SignerClientError ? e.code : e instanceof Error ? e.message : String(e));

type Outcome = "refunded" | "reconciliation";

// One pass over every job whose escrow is past CancelAfter by ledger time. All progress lives in the
// database and the opIds are deterministic, so a fresh process picks up exactly where a dead one stopped.
export async function runExpirySweep(deps: SweepDeps): Promise<SweepReport> {
  const log = deps.log ?? (() => {});
  const closeTime = await deps.ledgerCloseTime();
  const report: SweepReport = { closeTime, refunded: [], pending: [], reconciliation: [] };

  // Funding a crash interrupted after the signer may have locked money: finish it, so the escrow
  // becomes visible to the refund pass below. fundJob replays by opId and never attaches twice.
  for (const job of await deps.repo.listFundingToResume(RESUME_FUNDING_AFTER_SECONDS)) {
    try {
      const resumed = await fundJob({ repo: deps.repo, signer: deps.signer, actor: EXPIRY_ACTOR }, job.id);
      log(`resumed funding ${job.ref} (${job.id}): ${resumed.state}`);
    } catch (e) {
      // Its original caller finished it first.
      if (e instanceof TransitionConflict || e instanceof TransitionError) continue;
      report.pending.push(job.id);
      log(`pending ${job.ref} (${job.id}): funding not resumed: ${reasonOf(e)}`);
    }
  }

  for (const { job, escrow } of await deps.repo.listDueForCancel(closeTime)) {
    try {
      const outcome = await cancelExpired(deps, job, escrow, closeTime);
      report[outcome].push(job.id);
      log(`${outcome} ${job.ref} (${job.id})`);
    } catch (e) {
      // Another sweep moved the job first; it owns the outcome.
      if (e instanceof TransitionConflict) continue;
      report.pending.push(job.id);
      log(`pending ${job.ref} (${job.id}): ${reasonOf(e)}`);
    }
  }
  return report;
}

async function cancelExpired(deps: SweepDeps, job: Job, escrow: EscrowRow, closeTime: number): Promise<Outcome> {
  const { repo, signer } = deps;
  const failedAttempts = (await repo.listTransactions(job.id)).filter(
    (t) => t.type === "cancel" && t.status === "failed",
  ).length;
  const opId = operationId(job.id, "cancel", failedAttempts);
  const event = (reasonCodes: string[], detail?: unknown) => ({
    actor: EXPIRY_ACTOR,
    reasonCodes,
    correlationId: opId,
    detail,
  });

  // Walk forward from wherever the last run stopped.
  let state = job.state;
  if (state !== "EXPIRED_AWAITING_CANCEL" && state !== "CANCEL_PENDING") {
    await repo.transition(
      job.id,
      state,
      "EXPIRED_AWAITING_CANCEL",
      event(["ledger_time_past_cancel_after"], { closeTime, cancelAfter: escrow.cancelAfter }),
    );
    state = "EXPIRED_AWAITING_CANCEL";
  }
  if (state === "EXPIRED_AWAITING_CANCEL") {
    await repo.transition(job.id, state, "CANCEL_PENDING", event(["cancel_requested"]));
  }

  const giveUp = async (): Promise<Outcome> => {
    await repo.transition(
      job.id,
      "CANCEL_PENDING",
      "RECONCILIATION_REQUIRED",
      event(["cancel_unresolved"], { failedAttempts: Math.max(failedAttempts, MAX_CANCEL_ATTEMPTS) }),
    );
    return "reconciliation";
  };
  if (failedAttempts >= MAX_CANCEL_ATTEMPTS) return giveUp();

  await repo.recordPendingTx({ operationId: opId, jobId: job.id, type: "cancel" });
  let res;
  try {
    res = await signer.cancelEscrow({ opId, owner: escrow.owner, offerSequence: escrow.offerSequence });
  } catch (e) {
    if (e instanceof SignerClientError && RECONCILE.has(e.code)) {
      await repo.completeTx(opId, { txHash: null, status: "failed", result: e.code });
      await repo.transition(job.id, "CANCEL_PENDING", "RECONCILIATION_REQUIRED", event([e.code], { message: e.message }));
      return "reconciliation";
    }
    if (e instanceof SignerClientError && e.code === "op_failed") {
      await repo.completeTx(opId, { txHash: null, status: "failed", result: e.code });
      if (failedAttempts + 1 >= MAX_CANCEL_ATTEMPTS) return giveUp();
    }
    throw e;
  }

  await repo.completeTx(opId, {
    txHash: res.txHash,
    status: "validated",
    result: res.result,
    ledgerIndex: res.ledgerIndex,
    feeDrops: res.feeDrops,
  });
  await repo.transition(
    job.id,
    "CANCEL_PENDING",
    "REFUNDED",
    event(["validated_tesSUCCESS"], { txHash: res.txHash, ledgerIndex: res.ledgerIndex, feeDrops: res.feeDrops }),
  );
  return "refunded";
}
