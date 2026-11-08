import { type SignedAuthorization, bindingHash } from "@surety/contracts";
import { mintAuthorization } from "@surety/gate";
import { type SignerClient, SignerClientError } from "@surety/signer-client";
import { DECISION_CUTOFF_SECONDS, GATE_ACTOR } from "./evaluate";
import { operationId } from "./operation-id";
import type { AuthorizationRow, Decision, EscrowRow, Job, JobsRepo } from "./repo";
import { TransitionError } from "./states";

export interface SettleDeps {
  repo: JobsRepo;
  signer: SignerClient;
  gateSecret: string;
  // Validated ledger close time in Ripple seconds. Never the laptop clock.
  ledgerCloseTime: () => Promise<number>;
  // The clock authorizations expire by (the signer checks them by its own clock too).
  now?: () => Date;
}

// The escrow is not where the mirror says: a person must look. Never retried, never paid.
const RECONCILE = new Set(["escrow_not_found", "escrow_mismatch"]);
// The signer refused the authorization itself. Only an expired one is replaced, by the next attempt.
const REFUSED = new Set(["authorization_invalid", "authorization_consumed"]);
// Anything else recorded as failed (op_failed, finish_window_closed, a non-success result) is final
// for payment: the job waits for the expiry sweep to refund it.

// Pays an APPROVED job through the signer with a one-use authorization bound to the approved
// deliverable. Only a validated tesSUCCESS makes it PAID. Every retry replays the open
// authorization's opId first, so a finish the signer already submitted is found, never repeated.
export async function settleJob(deps: SettleDeps, jobId: string): Promise<Job> {
  const { repo, signer } = deps;
  const now = deps.now ?? (() => new Date());
  let job = await repo.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  if (job.state !== "APPROVED" && job.state !== "FINISH_PENDING") throw new TransitionError(job.state, "FINISH_PENDING");
  const escrow = await repo.getEscrow(job.id);
  if (!escrow) throw new Error(`job ${job.id} has no escrow`);
  const decision = await repo.latestDecision(job.id);
  if (!decision || decision.outcome !== "APPROVE" || decision.deliverableHash !== job.deliverableHash) {
    throw new Error(`job ${job.id} has no approval bound to its deliverable`);
  }

  const finishes = (await repo.listTransactions(job.id)).filter((t) => t.type === "finish");
  if (finishes.some((t) => t.status === "failed" && !REFUSED.has(t.result ?? ""))) return job;

  const closeTime = await deps.ledgerCloseTime();
  if (closeTime >= escrow.cancelAfter - DECISION_CUTOFF_SECONDS) return job;

  if (job.state === "APPROVED") {
    job = await repo.transition(job.id, "APPROVED", "FINISH_PENDING", {
      actor: GATE_ACTOR,
      reasonCodes: ["settlement_started"],
      correlationId: decision.id,
      detail: { decisionId: decision.id, closeTime },
    });
  }

  const mint = (attempt: number) => mintAndRecord(deps, now(), job, escrow, decision, attempt);
  let auth = (await repo.openAuthorization(decision.id)) ?? (await mint(0));
  for (;;) {
    const expired = Date.parse(auth.expiresAt) <= now().getTime();
    try {
      return await finish(deps, job, decision, auth);
    } catch (e) {
      if (!(e instanceof SignerClientError && REFUSED.has(e.code) && expired)) throw e;
      // The signer found no journaled finish for this opId and the authorization is dead: replace it.
      await repo.completeTx(auth.operationId, { txHash: null, status: "failed", result: e.code });
      auth = await mint(auth.attempt + 1);
    }
  }
}

async function mintAndRecord(
  deps: SettleDeps,
  now: Date,
  job: Job,
  escrow: EscrowRow,
  decision: Decision,
  attempt: number,
): Promise<AuthorizationRow> {
  const signed = mintAuthorization({
    owner: escrow.owner,
    offerSequence: escrow.offerSequence,
    amountDrops: escrow.amountDrops,
    destination: escrow.destination,
    jobSnapshotHash: job.snapshotHash,
    deliverableHash: decision.deliverableHash,
    policyVersion: decision.policyVersion,
    decisionId: decision.id,
    gateSecret: deps.gateSecret,
    now,
  });
  return deps.repo.recordAuthorization({
    decisionId: decision.id,
    jobId: job.id,
    attempt,
    operationId: operationId(job.id, "finish", attempt),
    bindingHash: bindingHash(signed.payload),
    signed,
    expiresAt: signed.payload.expiresAt,
  });
}

async function finish(deps: SettleDeps, job: Job, decision: Decision, auth: AuthorizationRow): Promise<Job> {
  const { repo, signer } = deps;
  const opId = auth.operationId;
  const event = (reasonCodes: string[], detail?: unknown) => ({ actor: GATE_ACTOR, reasonCodes, correlationId: opId, detail });
  await repo.recordPendingTx({ operationId: opId, jobId: job.id, type: "finish" });

  let res;
  try {
    res = await signer.finishEscrow({ opId, authorization: auth.signed as SignedAuthorization });
  } catch (e) {
    if (e instanceof SignerClientError && RECONCILE.has(e.code)) {
      await repo.completeTx(opId, { txHash: null, status: "failed", result: e.code });
      return repo.transition(job.id, "FINISH_PENDING", "RECONCILIATION_REQUIRED", event([e.code], { message: e.message }));
    }
    if (e instanceof SignerClientError && (e.code === "op_failed" || e.code === "finish_window_closed")) {
      await repo.completeTx(opId, { txHash: null, status: "failed", result: e.code });
      return job;
    }
    // ledger_failure, op_pending, a network error: the outcome is unknown; the next pass replays this opId.
    throw e;
  }

  if (res.result !== "tesSUCCESS") {
    await repo.completeTx(opId, { txHash: res.txHash, status: "failed", result: res.result, ledgerIndex: res.ledgerIndex });
    return job;
  }
  await repo.completeTx(opId, {
    txHash: res.txHash,
    status: "validated",
    result: res.result,
    ledgerIndex: res.ledgerIndex,
    feeDrops: res.feeDrops,
  });
  const paid = await repo.transition(
    job.id,
    "FINISH_PENDING",
    "PAID",
    event(["validated_tesSUCCESS"], {
      txHash: res.txHash,
      ledgerIndex: res.ledgerIndex,
      feeDrops: res.feeDrops,
      decisionId: decision.id,
      attempt: auth.attempt,
      authorizationBindingHash: auth.bindingHash,
    }),
  );
  await repo.consumeAuthorization(auth.id);
  return paid;
}
