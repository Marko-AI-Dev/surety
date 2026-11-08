import type { EvaluationResult } from "./engine";
import type { RulesReport } from "./rules";

// Thresholds live in one frozen, versioned object. A change is a new version, never an edit: every
// decision records the version it was made under, and a job freezes its version at creation.
export interface Policy {
  readonly version: string;
  readonly approveMinSatisfaction: number;
  readonly approveMaxInjection: number;
  readonly declineMinInjection: number;
  readonly declineMaxSatisfaction: number;
}

export const POLICY_V1: Policy = Object.freeze({
  version: "policy-v1",
  approveMinSatisfaction: 0.9,
  approveMaxInjection: 0.1,
  declineMinInjection: 0.5,
  declineMaxSatisfaction: 0.1,
});

// From the labelled set (docs/research/05-jev-calibration.md), chosen on the train split only: v1
// escalated honest work scored 0.75 and 0.77 (a longer summary, lower-case descriptions) while every bad
// file scored satisfaction 0.04 or less. Only the approve satisfaction moves, to 0.70, the vendor's
// starting "yes" threshold; the injection gate and both decline thresholds are unchanged.
// Holdout provenance (rerun with band probes, evidence/jev-calibration-2026-11-08T23-16-37-395Z.json, 28 files):
// in the 0.70 to 0.89 band the holdout has 2 good files (0.75, 0.89, both approved by v2, escalated by v1) and
// 0 bad files; v2 approves 6 of 7 good and 0 of 7 bad holdout files, and 0 bad files in either split. Every bad
// file scored satisfaction 0.04 or less, the four false-but-polite probes 0.01 to 0.02.
export const POLICY_V2: Policy = Object.freeze({
  version: "policy-v2",
  approveMinSatisfaction: 0.7,
  approveMaxInjection: 0.1,
  declineMinInjection: 0.5,
  declineMaxSatisfaction: 0.1,
});

export const POLICIES: readonly Policy[] = Object.freeze([POLICY_V1, POLICY_V2]);

// The policy new jobs freeze at creation. Existing jobs keep the version they froze.
export const CURRENT_POLICY: Policy = POLICY_V2;

export function policyFor(version: string): Policy | undefined {
  return POLICIES.find((p) => p.version === version);
}

export type Outcome = "APPROVE" | "DECLINE" | "ESCALATE" | "UNAVAILABLE";

export interface Decision {
  outcome: Outcome;
  reasonCodes: string[];
}

const isProbability = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

// Rules first and final; then the judge's scores against the policy. Nothing but two valid scores
// inside the approve band can approve.
export function decide(rules: RulesReport, evaluation: EvaluationResult | null, policy: Policy): Decision {
  const failedRules = rules.results.filter((r) => r.status === "fail");
  if (!rules.passed || failedRules.length > 0) {
    if (evaluation !== null) {
      throw new Error("rules failed: the deliverable must be declined without asking the evaluator");
    }
    const reasonCodes = failedRules.map((r) => `rule:${r.id}`);
    return { outcome: "DECLINE", reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["rules_failed"] };
  }
  if (evaluation === null) return { outcome: "UNAVAILABLE", reasonCodes: ["no_evaluation"] };
  if (evaluation.status === "unavailable") {
    return {
      outcome: "UNAVAILABLE",
      reasonCodes: evaluation.reasonCodes.length > 0 ? [...evaluation.reasonCodes] : ["unavailable"],
    };
  }

  const sat = evaluation.satisfaction;
  const inj = evaluation.injectionRisk;
  if (!isProbability(sat) || !isProbability(inj)) return { outcome: "UNAVAILABLE", reasonCodes: ["invalid_scores"] };
  if (inj >= policy.declineMinInjection) return { outcome: "DECLINE", reasonCodes: ["injection_risk"] };
  if (sat <= policy.declineMaxSatisfaction) return { outcome: "DECLINE", reasonCodes: ["unsatisfied"] };
  if (sat >= policy.approveMinSatisfaction && inj <= policy.approveMaxInjection) {
    return { outcome: "APPROVE", reasonCodes: ["approved"] };
  }
  return { outcome: "ESCALATE", reasonCodes: ["uncertain"] };
}
