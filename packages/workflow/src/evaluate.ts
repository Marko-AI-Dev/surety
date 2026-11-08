import { randomUUID } from "node:crypto";
import {
  type DecisionEngine,
  type EvaluationResult,
  type Policy,
  type RulesReport,
  decide,
  policyFor,
  runRules,
} from "@surety/gate";
import type { DecisionOutcome, Job, JobsRepo } from "./repo";
import type { JobState } from "./states";
import { TransitionError } from "./states";

export const GATE_ACTOR = "gate";

// No evaluation and no settlement in the last 30 seconds before CancelAfter, by ledger time: the
// job waits for expiry and refunds instead.
export const DECISION_CUTOFF_SECONDS = 30;

export interface EvaluateDeps {
  repo: JobsRepo;
  engine: DecisionEngine;
  // Validated ledger close time in Ripple seconds. Never the laptop clock.
  ledgerCloseTime: () => Promise<number>;
  // Defaults to the policy the job froze at creation.
  policy?: Policy;
}

const NEXT_STATE: Record<DecisionOutcome, JobState> = {
  APPROVE: "APPROVED",
  DECLINE: "REJECTED_AWAITING_EXPIRY",
  ESCALATE: "REVIEW_REQUIRED",
  UNAVAILABLE: "REVIEW_REQUIRED",
};

// The permitted currencies are part of the buyer's frozen criteria. Absent means none: fail closed.
function allowedCurrencies(criteria: unknown): string[] {
  const list = (criteria as { allowedCurrencies?: unknown } | null)?.allowedCurrencies;
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string") : [];
}

// An engine is built never to throw; if one does, that is an outage, not a verdict.
async function askEngine(engine: DecisionEngine, input: Parameters<DecisionEngine["evaluate"]>[0]): Promise<EvaluationResult> {
  const started = Date.now();
  try {
    return await engine.evaluate(input);
  } catch {
    return {
      status: "unavailable",
      mode: engine.mode,
      satisfaction: null,
      injectionRisk: null,
      provider: "unknown",
      model: "unknown",
      latencyMs: Date.now() - started,
      reasonCodes: ["engine_error"],
      requestId: input.requestId,
      evaluatedAt: new Date().toISOString(),
      costUsd: null,
    };
  }
}

// Rules first; Jev only if every rule passed; then the policy. The verdict is recorded bound to the
// deliverable hash and policy version before the job moves.
export async function evaluateJob(deps: EvaluateDeps, jobId: string): Promise<Job> {
  const { repo } = deps;
  const job = await repo.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  if (job.state !== "DELIVERED" && job.state !== "EVALUATING") throw new TransitionError(job.state, "EVALUATING");
  const escrow = await repo.getEscrow(job.id);
  if (!escrow) throw new Error(`job ${job.id} has no escrow`);
  const deliverableHash = job.deliverableHash;
  if (deliverableHash === null) throw new Error(`job ${job.id} has no deliverable`);

  // An EVALUATING job here is one a dead worker claimed and never finished (one worker runs at a
  // time). A decision it recorded for this deliverable is applied as it stands, never asked again.
  if (job.state === "EVALUATING") {
    const prior = await repo.latestDecision(job.id);
    if (prior && prior.deliverableHash === deliverableHash) {
      return repo.transition(job.id, "EVALUATING", NEXT_STATE[prior.outcome], {
        actor: GATE_ACTOR,
        reasonCodes: prior.reasonCodes,
        correlationId: prior.id,
        detail: { decisionId: prior.id, outcome: prior.outcome, resumed: true, policyVersion: prior.policyVersion },
      });
    }
  }

  // Read ledger time before claiming the job, so an unreachable ledger leaves it DELIVERED.
  const closeTime = await deps.ledgerCloseTime();
  const cutoff = escrow.cancelAfter - DECISION_CUTOFF_SECONDS;
  const claimed =
    job.state === "EVALUATING"
      ? job
      : await repo.transition(job.id, "DELIVERED", "EVALUATING", {
          actor: GATE_ACTOR,
          reasonCodes: ["evaluation_started"],
          detail: { deliverableHash, closeTime, cutoff },
        });
  const hold = (reason: string) =>
    repo.transition(claimed.id, "EVALUATING", "REVIEW_REQUIRED", {
      actor: GATE_ACTOR,
      reasonCodes: [reason],
      detail: { closeTime, cutoff, policyVersion: job.policyVersion },
    });

  if (closeTime >= cutoff) return hold("decision_window_closed");
  const policy = deps.policy ?? policyFor(job.policyVersion);
  if (!policy) return hold("unknown_policy");

  const rules = runRules({
    sourceText: job.sourceText,
    allowedCurrencies: allowedCurrencies(job.criteria),
    deliverable: job.deliverable,
  });
  const requestId = randomUUID();
  let evaluation: EvaluationResult | null = null;
  if (rules.passed && rules.parsed) {
    evaluation = await askEngine(deps.engine, {
      requestId,
      criteria: job.criteriaText ?? JSON.stringify(job.criteria),
      sourceText: job.sourceText,
      deliverable: rules.parsed,
      deliverableHash,
      jobSnapshotHash: job.snapshotHash,
      policyVersion: policy.version,
      secondsRemaining: cutoff - closeTime,
    });
  }
  const verdict = decide(rules, evaluation, policy);
  const rulesRecord: Omit<RulesReport, "parsed"> = { passed: rules.passed, results: rules.results };

  const decision = await repo.recordDecision({
    jobId: job.id,
    requestId,
    mode: evaluation?.mode ?? null,
    outcome: verdict.outcome,
    satisfaction: evaluation?.satisfaction ?? null,
    injectionRisk: evaluation?.injectionRisk ?? null,
    provider: evaluation?.provider ?? null,
    model: evaluation?.model ?? null,
    latencyMs: evaluation?.latencyMs ?? null,
    costUsd: evaluation?.costUsd ?? null,
    reasonCodes: verdict.reasonCodes,
    rules: rulesRecord,
    policyVersion: policy.version,
    deliverableHash,
  });

  return repo.transition(claimed.id, "EVALUATING", NEXT_STATE[verdict.outcome], {
    actor: GATE_ACTOR,
    reasonCodes: verdict.reasonCodes,
    correlationId: decision.id,
    detail: {
      decisionId: decision.id,
      outcome: verdict.outcome,
      mode: decision.mode,
      satisfaction: decision.satisfaction,
      injectionRisk: decision.injectionRisk,
      policyVersion: policy.version,
    },
  });
}
