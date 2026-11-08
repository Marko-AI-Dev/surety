import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deliverableHash } from "@surety/contracts";
import { type DecisionEngine, type EvaluationInput, type FixtureScores, createFixtureEngine } from "@surety/gate";
import { type Job, type JobsRepo, fundJob } from "../src/index";
import type { FakeSigner } from "./fake-signer";
import { newJob } from "./repo-contract";

// Shared setup for the gate flow tests: the DEMO-001 job, its fixture deliverables, and engines
// that count their calls.

const ROOT = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;

export const SOURCE = read("fixtures/invoice-demo-001.txt");
export const CRITERIA_TEXT = read("fixtures/criteria-demo-001.txt").trim();
export const EXACT = readJson("fixtures/deliverables/good/exact.json");
export const WRONG_TOTAL = readJson("fixtures/deliverables/rule-fail/wrong-total.json");
export const INJECTION = readJson("fixtures/deliverables/bad/direct-injection.json");

export const GATE_SECRET = "gate-secret-for-workflow-tests-0123456789";
// A well-formed classic address for the payee: the authorization schema checks the format.
export const SELLER = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
export const WINDOW = 120;

// Funded DEMO-001 job, LOCKED, with an escrow whose cancel_after is signer.closeTime + WINDOW.
export async function lockedGateJob(repo: JobsRepo, signer: FakeSigner, overrides: Parameters<typeof newJob>[0] = {}) {
  const job = await repo.createJob(
    newJob({
      buyerAddress: signer.buyer,
      sellerAddress: SELLER,
      sourceText: SOURCE,
      criteria: { allowedCurrencies: ["ZAR"], schema: "invoice-deliverable-v1" },
      criteriaText: CRITERIA_TEXT,
      policyVersion: "policy-v1",
      cancelAfterSeconds: WINDOW,
      ...overrides,
    }),
  );
  return fundJob({ repo, signer, actor: "buyer-agent" }, job.id);
}

export interface CountingEngine extends DecisionEngine {
  inputs: EvaluationInput[];
}

export function counting(inner: DecisionEngine): CountingEngine {
  const inputs: EvaluationInput[] = [];
  return {
    mode: inner.mode,
    inputs,
    evaluate(input) {
      inputs.push(input);
      return inner.evaluate(input);
    },
  };
}

// The live smoke-test scores, scripted: exact approves, the injection declines; anything else unavailable.
export function demoEngine(extra: Record<string, FixtureScores> = {}): CountingEngine {
  return counting(
    createFixtureEngine({
      [deliverableHash(EXACT)]: { satisfaction: 0.95, injectionRisk: 0.02 },
      [deliverableHash(INJECTION)]: { satisfaction: 0.03, injectionRisk: 0.98 },
      ...extra,
    }),
  );
}

export async function stateOf(repo: JobsRepo, job: Job) {
  return (await repo.getJob(job.id))?.state;
}
