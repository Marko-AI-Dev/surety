import { type SignerClient, SignerClientError } from "@surety/signer-client";
import { operationId } from "./operation-id";
import { type EscrowRow, type Job, type JobsRepo, TransitionConflict } from "./repo";

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

type Outcome = "refunded" | "reconciliation";

// One pass over every job whose escrow is past CancelAfter by ledger time. All progress lives in the
// database and the opIds are deterministic, so a fresh process picks up exactly where a dead one stopped.
export async function runExpirySweep(deps: SweepDeps): Promise<SweepReport> {
  const log = deps.log ?? (() => {});
  const closeTime = await deps.ledgerCloseTime();
  const report: SweepReport = { closeTime, refunded: [], pending: [], reconciliation: [] };

  for (const { job, escrow } of await deps.repo.listDueForCancel(closeTime)) {
    try {
      const outcome = await cancelExpired(deps, job, escrow, closeTime);
      report[outcome].push(job.id);
      log(`${outcome} ${job.ref} (${job.id})`);
    } catch (e) {
      // Another sweep moved the job first; it owns the outcome.
      if (e instanceof TransitionConflict) continue;
      report.pending.push(job.id);
      const reason = e instanceof SignerClientError ? e.code : e instanceof Error ? e.message : String(e);
      log(`pending ${job.ref} (${job.id}): ${reason}`);
    }
  }
  return report;
}

async function cancelExpired(deps: SweepDeps, job: Job, escrow: EscrowRow, closeTime: number): Promise<Outcome> {
  const { repo, signer } = deps;
  const opId = operationId(job.id, "cancel");
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
