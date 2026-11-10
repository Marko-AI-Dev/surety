import type { DecisionEngine, DocumentReader, Policy } from "@surety/gate";
import { type SignerClient, SignerClientError } from "@surety/signer-client";
import { evaluateJob } from "./evaluate";
import { type SweepReport, runExpirySweep } from "./expiry";
import type { InspectionRepo } from "./inspection-repo";
import { AuthorizationConflict, type Job, type JobsRepo, TransitionConflict } from "./repo";
import { settleJob } from "./settle";
import { TransitionError } from "./states";

export interface EngineDeps {
  repo: JobsRepo & Pick<InspectionRepo, "getAttestation">;
  signer: SignerClient;
  engine: DecisionEngine;
  gateSecret: string;
  ledgerCloseTime: () => Promise<number>;
  policy?: Policy;
  reader?: DocumentReader;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface EngineReport {
  evaluated: string[];
  // Delivered deals still waiting for the inspector's attestation, left DELIVERED and unjudged.
  awaitingInspection: string[];
  paid: string[];
  pending: string[];
  sweep: SweepReport;
}

const reasonOf = (e: unknown) => (e instanceof SignerClientError ? e.code : e instanceof Error ? e.message : String(e));

// Another pass or process moved the job first; it owns the outcome.
const lostRace = (e: unknown) =>
  e instanceof TransitionConflict || e instanceof AuthorizationConflict || e instanceof TransitionError;

// One pass of the job engine: refund whatever has expired, judge delivered work, then pay approved
// work. Every step reads its state from the database, so a restarted process carries on.
export async function runEngineOnce(deps: EngineDeps): Promise<EngineReport> {
  const log = deps.log ?? (() => {});
  const report: Omit<EngineReport, "sweep"> = { evaluated: [], awaitingInspection: [], paid: [], pending: [] };

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

  // Refunds first: a slow or failing evaluation must never delay money owed back to a buyer.
  const sweep = await runExpirySweep({ repo: deps.repo, signer: deps.signer, ledgerCloseTime: deps.ledgerCloseTime, log });

  // EVALUATING jobs are ones an evaluator left behind; evaluateJob bounds how often they are resumed
  // and the one-decision-per-deliverable constraint keeps a racing twin from recording a second verdict.
  await each(
    await deps.repo.listJobsInStates(["DELIVERED", "EVALUATING"]),
    (job) => evaluateJob(deps, job.id),
    (job, after) => {
      if (after.state === "DELIVERED") {
        report.awaitingInspection.push(job.id);
        return;
      }
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

  return { ...report, sweep };
}
