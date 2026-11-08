import { deliverableHash } from "@surety/contracts";
import { DeliverableConflict, type Job, type JobsRepo, TransitionConflict } from "./repo";
import { TransitionError } from "./states";

export const SELLER_ACTOR = "seller";

export interface DeliverDeps {
  repo: JobsRepo;
}

// The seller hands in its answer once. The same bytes again (by canonical hash) are a no-op; a changed
// answer is refused. Nothing here judges the answer: that is evaluateJob's job.
export async function deliverJob(deps: DeliverDeps, jobId: string, raw: unknown): Promise<Job> {
  const { repo } = deps;
  let job = await repo.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const hash = deliverableHash(raw);

  if (job.deliverableHash !== null && job.deliverableHash !== hash) {
    throw new DeliverableConflict(job.id, job.deliverableHash, hash);
  }
  if (job.deliverableHash === null) {
    if (job.state !== "LOCKED" && job.state !== "IN_PROGRESS") throw new TransitionError(job.state, "DELIVERED");
    await repo.saveDeliverable(job.id, raw, hash);
  }

  // Walk forward from wherever an earlier call stopped; a finished delivery is returned as it is.
  const event = (reason: string) => ({ actor: SELLER_ACTOR, reasonCodes: [reason], detail: { deliverableHash: hash } });
  try {
    if (job.state === "LOCKED") job = await repo.transition(job.id, "LOCKED", "IN_PROGRESS", event("work_started"));
    if (job.state === "IN_PROGRESS") {
      job = await repo.transition(job.id, "IN_PROGRESS", "DELIVERED", event("deliverable_received"));
    }
  } catch (e) {
    // A concurrent delivery of the same bytes moved it first.
    if (!(e instanceof TransitionConflict)) throw e;
    const current = await repo.getJob(job.id);
    if (!current) throw e;
    return current;
  }
  return job;
}
