import type { DecisionEngine, Policy } from "@surety/gate";
import { type SignerClient, SignerClientError } from "@surety/signer-client";
import { evaluateJob } from "./evaluate";
import { type SweepReport, runExpirySweep } from "./expiry";
import { AuthorizationConflict, type Job, type JobsRepo, TransitionConflict } from "./repo";
import { settleJob } from "./settle";
import { TransitionError } from "./states";

export interface EngineDeps {
  repo: JobsRepo;
  signer: SignerClient;
  engine: DecisionEngine;
  gateSecret: string;
  ledgerCloseTime: () => Promise<number>;
  policy?: Policy;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface EngineReport {
  evaluated: string[];
  paid: string[];
  pending: string[];
  sweep: SweepReport;
}

const reasonOf = (e: unknown) => (e instanceof SignerClientError ? e.code : e instanceof Error ? e.message : String(e));

// Another pass or process moved the job first; it owns the outcome.
const lostRace = (e: unknown) =>
  e instanceof TransitionConflict || e instanceof AuthorizationConflict || e instanceof TransitionError;

// One pass of the job engine: judge delivered work, pay approved work, then refund whatever has
// expired. Every step reads its state from the database, so a restarted process carries on.
export async function runEngineOnce(deps: EngineDeps): Promise<EngineReport> {
  const log = deps.log ?? (() => {});
  const report: Omit<EngineReport, "sweep"> = { evaluated: [], paid: [], pending: [] };

  const each = async (jobs: Job[], step: (job: Job) => Promise<Job>, onDone: (before: Job, after: Job) => void) => {
    for (const job of jobs) {
      try {
        onDone(job, await step(job));
      } catch (e) {
        if (lostRace(e)) continue;
        report.pending.push(job.id);
        log(`pending ${job.ref} (${job.id}): ${reasonOf(e)}`);
      }
    }
  };

  // EVALUATING jobs are ones a dead worker left behind: passes never overlap and one worker runs.
  await each(
    await deps.repo.listJobsInStates(["DELIVERED", "EVALUATING"]),
    (job) => evaluateJob(deps, job.id),
    (job, after) => {
      report.evaluated.push(job.id);
      log(`evaluated ${job.ref} (${job.id}): ${after.state}`);
    },
  );

  await each(
    await deps.repo.listJobsInStates(["APPROVED", "FINISH_PENDING"]),
    (job) => settleJob(deps, job.id),
    (job, after) => {
      if (after.state === "PAID") {
        report.paid.push(job.id);
        log(`paid ${job.ref} (${job.id})`);
      } else if (after.state !== job.state) {
        log(`settle ${job.ref} (${job.id}): ${after.state}`);
      }
    },
  );

  const sweep = await runExpirySweep({ repo: deps.repo, signer: deps.signer, ledgerCloseTime: deps.ledgerCloseTime, log });
  return { ...report, sweep };
}
