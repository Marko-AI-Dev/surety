import { randomUUID } from "node:crypto";
import {
  type DealIntent,
  DealIntentSchema,
  type SupplierQuote,
  SupplierQuoteSchema,
  type TradeDocuments,
  TradeDocumentsSchema,
} from "@surety/contracts";
import {
  type DecisionEngine,
  type DocumentReader,
  type EvaluationInput,
  type EvaluationResult,
  type Decision as GateDecision,
  type Policy,
  type ReadResult,
  type RulesReport,
  decide,
  invoiceState,
  parserReader,
  policyFor,
  runRules,
  runTradeRules,
  tradeState,
  withReask,
} from "@surety/gate";
import {
  type Decision,
  DecisionConflict,
  type DecisionOutcome,
  type EscrowRow,
  type Job,
  type JobsRepo,
  TransitionConflict,
  type TransitionEvent,
} from "./repo";
import type { Attestation, InspectionRepo } from "./inspection-repo";
import type { JobState } from "./states";
import { TransitionError } from "./states";

export const GATE_ACTOR = "gate";

// How many times an EVALUATING job may be picked up again before it is held for review.
export const MAX_EVALUATION_RESUMES = 3;

// No evaluation and no settlement in the last 30 seconds before CancelAfter, by ledger time: the
// job waits for expiry and refunds instead.
export const DECISION_CUTOFF_SECONDS = 30;

export interface EvaluateDeps {
  // getAttestation reads the inspector's second key for deals that froze inspection: "required".
  repo: JobsRepo & Pick<InspectionRepo, "getAttestation">;
  engine: DecisionEngine;
  // Validated ledger close time in Ripple seconds. Never the laptop clock.
  ledgerCloseTime: () => Promise<number>;
  // Defaults to the policy the job froze at creation. Overrides invoice jobs only; deals keep theirs.
  policy?: Policy;
  // Reads a deal's documents into fields. Defaults to the template parser.
  reader?: DocumentReader;
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

type TradeTerms = { intent: DealIntent; quote: SupplierQuote; inspection: "required" | "none" };

// A deal's escrow job freezes { kind: "trade", intent, quote }, plus inspection: "required" for a
// sourcing deal (Phase 4d). Anything else is an invoice job. A trade job whose frozen terms do not
// parse, or that names any other inspection value, is held, never judged against guesses.
function tradeTermsOf(criteria: unknown): TradeTerms | "invalid" | null {
  const c = criteria as { kind?: unknown; intent?: unknown; quote?: unknown; inspection?: unknown } | null;
  if (c?.kind !== "trade") return null;
  const intent = DealIntentSchema.safeParse(c.intent);
  const quote = SupplierQuoteSchema.safeParse(c.quote);
  const inspection = c.inspection === undefined ? "none" : c.inspection === "required" ? "required" : null;
  return intent.success && quote.success && inspection ? { intent: intent.data, quote: quote.data, inspection } : "invalid";
}

// What the decision records about the second key: absent for a 4b deal, null when none was found.
function inspectionRecord(terms: TradeTerms, attestation: Attestation | null) {
  if (terms.inspection === "none") return {};
  return { inspection: attestation ? { attestationId: attestation.id, outcome: attestation.outcome, blNumber: attestation.blNumber } : null };
}

type Ask = Omit<EvaluationInput, "questionSet" | "state">;
interface Judgement {
  rulesRecord: unknown;
  evaluation: EvaluationResult | null;
  verdict: GateDecision;
}

// The invoice job: invoice rules, then the invoice questions.
async function judgeInvoice(engine: DecisionEngine, job: Job, policy: Policy, ask: Ask): Promise<Judgement> {
  const rules = runRules({ sourceText: job.sourceText, allowedCurrencies: allowedCurrencies(job.criteria), deliverable: job.deliverable });
  let evaluation: EvaluationResult | null = null;
  if (rules.passed && rules.parsed) {
    evaluation = await askEngine(engine, {
      ...ask,
      questionSet: "invoice",
      state: invoiceState(job.criteriaText ?? JSON.stringify(job.criteria), job.sourceText, rules.parsed),
    });
  }
  const rulesRecord: Omit<RulesReport, "parsed"> = { passed: rules.passed, results: rules.results };
  return { rulesRecord, evaluation, verdict: decide(rules, evaluation, policy) };
}

// A reader is built never to throw; if one does, that is an outage, not a reading.
async function askReader(reader: DocumentReader, docs: TradeDocuments): Promise<ReadResult> {
  try {
    return await reader.read(docs);
  } catch {
    return { status: "unavailable", reason: "reader_error" };
  }
}

// A deal: the documents must parse; then the reader; then the 12 trade rules; then the trade questions.
async function judgeTrade(
  reader: DocumentReader,
  engine: DecisionEngine,
  job: Job,
  terms: TradeTerms,
  attestation: Attestation | null,
  escrow: EscrowRow,
  policy: Policy,
  ask: Ask,
): Promise<Judgement> {
  const input = {
    intent: terms.intent,
    quote: terms.quote,
    documents: job.deliverable,
    lock: { destination: escrow.destination, amount: escrow.amount },
    // The inspector's note is display text: only the outcome and the number reach the rules, never Jev.
    ...(terms.inspection === "required" ? { inspection: { attestation: attestation ? { outcome: attestation.outcome, blNumber: attestation.blNumber } : null } } : {}),
  };
  const readerInfo = { kind: reader.kind, model: reader.model };
  const inspected = inspectionRecord(terms, attestation);
  const first = runTradeRules({ ...input, readerFields: null });
  const readable = first.results.every((r) => (r.id === "size" || r.id === "parse" ? r.status === "pass" : true));
  const docs = TradeDocumentsSchema.safeParse(job.deliverable);
  if (!readable || !docs.success) {
    return { rulesRecord: { passed: first.passed, results: first.results, reader: readerInfo, ...inspected }, evaluation: null, verdict: decide(first, null, policy) };
  }

  const read = await askReader(reader, docs.data);
  if (read.status === "unavailable") {
    return {
      rulesRecord: { passed: false, results: [], reader: { ...readerInfo, status: "unavailable", reason: read.reason }, ...inspected },
      evaluation: null,
      verdict: { outcome: "UNAVAILABLE", reasonCodes: [`reader_${read.reason}`] },
    };
  }
  const rules = runTradeRules({ ...input, readerFields: read.fields });
  let evaluation: EvaluationResult | null = null;
  if (rules.passed) {
    evaluation = await askEngine(engine, { ...ask, questionSet: "trade", state: tradeState(job.sourceText, terms.quote, docs.data) });
  }
  return { rulesRecord: { passed: rules.passed, results: rules.results, reader: readerInfo, ...inspected }, evaluation, verdict: decide(rules, evaluation, policy) };
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

  // Every move out of EVALUATING is guarded; if another evaluator moved the job first, its outcome
  // stands and this call returns the job as that one left it.
  const current = async () => (await repo.getJob(job.id)) ?? job;
  const move = async (to: JobState, event: TransitionEvent): Promise<Job> => {
    try {
      return await repo.transition(job.id, "EVALUATING", to, event);
    } catch (e) {
      if (e instanceof TransitionConflict) return current();
      throw e;
    }
  };
  let resumes = 0;
  const apply = (d: Decision) =>
    move(NEXT_STATE[d.outcome], {
      actor: GATE_ACTOR,
      reasonCodes: d.reasonCodes,
      correlationId: d.id,
      detail: {
        decisionId: d.id,
        outcome: d.outcome,
        mode: d.mode,
        satisfaction: d.satisfaction,
        injectionRisk: d.injectionRisk,
        policyVersion: d.policyVersion,
        ...(d.samples ? { samples: d.samples } : {}),
        ...(resumes > 0 ? { resumes } : {}),
      },
    });

  // An EVALUATING job here was claimed by an evaluator that died, or by a twin still running. A
  // decision already recorded for this deliverable is applied, never asked again. Resumes are
  // counted and bounded, so a job whose evaluation fails every time is held for review (and
  // refunds at expiry) instead of costing a Jev call every pass.
  if (job.state === "EVALUATING") {
    resumes = await repo.noteEvaluationResume(job.id);
    const prior = await repo.latestDecision(job.id);
    if (prior && prior.deliverableHash === deliverableHash) return apply(prior);
    if (resumes >= MAX_EVALUATION_RESUMES) {
      return move("REVIEW_REQUIRED", {
        actor: GATE_ACTOR,
        reasonCodes: ["evaluation_resume_exhausted"],
        detail: { resumes },
      });
    }
  }

  // Read ledger time before claiming the job, so an unreachable ledger leaves it DELIVERED.
  const closeTime = await deps.ledgerCloseTime();
  const cutoff = escrow.cancelAfter - DECISION_CUTOFF_SECONDS;
  const trade = tradeTermsOf(job.criteria);
  const needsInspection = trade !== null && trade !== "invalid" && trade.inspection === "required";
  const attestation = needsInspection ? await repo.getAttestation(job.id) : null;
  // The second key: a deal that needs the inspector's attestation and has none waits, unjudged and with
  // no model call, until it arrives. At the cutoff it is held instead, and refunds at the deadline.
  if (job.state === "DELIVERED" && needsInspection && attestation === null && closeTime < cutoff) return job;
  if (job.state === "DELIVERED") {
    try {
      await repo.transition(job.id, "DELIVERED", "EVALUATING", {
        actor: GATE_ACTOR,
        reasonCodes: ["evaluation_started"],
        detail: { deliverableHash, closeTime, cutoff },
      });
    } catch (e) {
      // Another evaluator claimed it first and owns the verdict.
      if (e instanceof TransitionConflict) return current();
      throw e;
    }
  }
  const hold = (reason: string) =>
    move("REVIEW_REQUIRED", {
      actor: GATE_ACTOR,
      reasonCodes: [reason],
      detail: { closeTime, cutoff, policyVersion: job.policyVersion, ...(resumes > 0 ? { resumes } : {}) },
    });

  if (closeTime >= cutoff) return hold(needsInspection && attestation === null ? "inspection_missing" : "decision_window_closed");
  // A deal always judges under the policy it froze at acceptance; deps.policy overrides invoice jobs only.
  const policy = trade ? policyFor(job.policyVersion) : (deps.policy ?? policyFor(job.policyVersion));
  if (!policy) return hold("unknown_policy");
  if (trade === "invalid") return hold("trade_terms_invalid");

  const requestId = randomUUID();
  const ask = { requestId, deliverableHash, jobSnapshotHash: job.snapshotHash, policyVersion: policy.version, secondsRemaining: cutoff - closeTime };
  const engine = policy.reaskBand ? withReask(deps.engine, policy.reaskBand) : deps.engine;
  const { rulesRecord, evaluation, verdict } = trade
    ? await judgeTrade(deps.reader ?? parserReader, engine, job, trade, attestation, escrow, policy, ask)
    : await judgeInvoice(engine, job, policy, ask);

  let decision: Decision;
  try {
    decision = await repo.recordDecision({
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
      samples: evaluation?.samples ?? null,
    });
  } catch (e) {
    // Another evaluator recorded its verdict for this deliverable first: that one is the decision.
    if (!(e instanceof DecisionConflict)) throw e;
    const winner = await repo.latestDecision(job.id);
    if (!winner || winner.deliverableHash !== deliverableHash) throw e;
    decision = winner;
  }
  return apply(decision);
}
