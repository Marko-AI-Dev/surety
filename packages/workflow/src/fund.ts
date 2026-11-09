import { wireAmount } from "@surety/contracts";
import { type SignerClient, SignerClientError } from "@surety/signer-client";
import { operationId } from "./operation-id";
import type { Job, JobsRepo } from "./repo";
import { TransitionError } from "./states";

export interface FundDeps {
  repo: JobsRepo;
  signer: SignerClient;
  actor: string;
}

// Conclusive failures, safe to record as CREATE_FAILED: the signer refused before anything reached the
// ledger, or (op_failed) the create failed on the ledger or can never be included.
const CONCLUSIVE = new Set([
  "destination_not_allowed",
  "amount_over_cap",
  "cancel_window_invalid",
  "bad_request",
  "op_failed",
  "daily_cap_reached",
  "open_deal_limit_reached",
  "destination_not_ready",
  "insufficient_funds",
  "asset_not_enabled",
]);

// Locks the job's escrow through the signer. Anything inconclusive (ledger_failure, op_pending, a
// network error) leaves the job CREATE_PENDING and rethrows; calling again resumes with the same
// opId, so the signer replays instead of creating a second escrow.
export async function fundJob(deps: FundDeps, jobId: string): Promise<Job> {
  const { repo, signer, actor } = deps;
  let job = await repo.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  if (job.state === "DRAFT") {
    job = await repo.transition(job.id, "DRAFT", "CREATE_PENDING", { actor, reasonCodes: ["fund_requested"] });
  } else if (job.state !== "CREATE_PENDING") {
    throw new TransitionError(job.state, "CREATE_PENDING");
  }

  const opId = operationId(job.id, "create");
  await repo.recordPendingTx({ operationId: opId, jobId: job.id, type: "create" });

  let res;
  try {
    res = await signer.createEscrow({
      opId,
      jobRef: job.ref,
      destination: job.sellerAddress,
      ...wireAmount(job.amount),
      cancelAfterSeconds: job.cancelAfterSeconds,
    });
  } catch (e) {
    if (e instanceof SignerClientError && CONCLUSIVE.has(e.code)) {
      await repo.completeTx(opId, { txHash: null, status: "failed", result: e.code });
      return repo.transition(job.id, "CREATE_PENDING", "CREATE_FAILED", {
        actor,
        reasonCodes: [e.code],
        correlationId: opId,
        detail: { message: e.message },
      });
    }
    throw e;
  }

  // A resumed call may find the escrow already stored by an attempt that died before LOCKED.
  if (!(await repo.getEscrow(job.id))) {
    await repo.attachEscrow({
      jobId: job.id,
      owner: res.owner,
      offerSequence: res.offerSequence,
      destination: job.sellerAddress,
      amount: job.amount,
      issuer: res.issuer ?? null,
      condition: res.condition,
      cancelAfter: res.cancelAfter,
      createTxHash: res.txHash,
      createLedgerIndex: res.ledgerIndex,
    });
  }
  await repo.completeTx(opId, {
    txHash: res.txHash,
    status: "validated",
    result: res.result,
    ledgerIndex: res.ledgerIndex,
  });
  return repo.transition(job.id, "CREATE_PENDING", "LOCKED", {
    actor,
    reasonCodes: ["validated_tesSUCCESS"],
    correlationId: opId,
    detail: { txHash: res.txHash, ledgerIndex: res.ledgerIndex, offerSequence: res.offerSequence },
  });
}
