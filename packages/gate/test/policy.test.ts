import { describe, expect, it } from "vitest";
import {
  CURRENT_POLICY,
  type EvaluationResult,
  POLICIES,
  POLICY_V1,
  POLICY_V2,
  RULE_IDS,
  type RulesReport,
  decide,
  policyFor,
} from "../src/index";

const PASSED: RulesReport = { passed: true, results: RULE_IDS.map((id) => ({ id, status: "pass" })) };

function failed(...ids: (typeof RULE_IDS)[number][]): RulesReport {
  return {
    passed: false,
    results: RULE_IDS.map((id) => (ids.includes(id) ? { id, status: "fail", detail: "x" } : { id, status: "pass" })),
  };
}

function scores(satisfaction: number | null, injectionRisk: number | null): EvaluationResult {
  return {
    status: "ok",
    mode: "live",
    satisfaction,
    injectionRisk,
    provider: "TypeSafe",
    model: "typesafe/jev-1.14-20261014",
    latencyMs: 500,
    reasonCodes: [],
    requestId: "r",
    evaluatedAt: new Date().toISOString(),
    costUsd: 0.00003,
  };
}

const unavailable = (reasonCodes: string[]): EvaluationResult => ({
  ...scores(null, null),
  status: "unavailable",
  reasonCodes,
});

describe("POLICY_V1", () => {
  it("holds the starting thresholds in one versioned object", () => {
    expect(POLICY_V1).toEqual({
      version: "policy-v1",
      approveMinSatisfaction: 0.9,
      approveMaxInjection: 0.1,
      declineMinInjection: 0.5,
      declineMaxSatisfaction: 0.1,
    });
    expect(Object.isFrozen(POLICY_V1)).toBe(true);
  });

  it("is found by its version, and unknown versions are not", () => {
    expect(policyFor("policy-v1")).toBe(POLICY_V1);
    expect(POLICIES.map((p) => p.version)).toContain("policy-v1");
    expect(policyFor("phase2-0")).toBeUndefined();
  });
});

describe("POLICY_V2 (from the labelled train split, docs/research/05-jev-calibration.md)", () => {
  it("only lowers the approve satisfaction to 0.70; v1 stays unchanged beside it", () => {
    expect(POLICY_V2).toEqual({
      version: "policy-v2",
      approveMinSatisfaction: 0.7,
      approveMaxInjection: 0.1,
      declineMinInjection: 0.5,
      declineMaxSatisfaction: 0.1,
    });
    expect(Object.isFrozen(POLICY_V2)).toBe(true);
    expect(POLICY_V1.approveMinSatisfaction).toBe(0.9);
    expect(POLICIES.map((p) => p.version)).toEqual(["policy-v1", "policy-v2", "policy-v3-trade"]);
    expect(policyFor("policy-v2")).toBe(POLICY_V2);
  });

  it("is the policy new jobs freeze", () => {
    expect(CURRENT_POLICY).toBe(POLICY_V2);
  });

  it.each([
    // [satisfaction, injection, under v1, under v2]: live calibration scores and the new boundary
    [0.75, 0.02, "ESCALATE", "APPROVE"], // good/long-summary
    [0.77, 0.02, "ESCALATE", "APPROVE"], // good/lowercase-descriptions
    [0.11, 0.03, "ESCALATE", "ESCALATE"], // good/empty-summary stays held for review
    [0.02, 0.03, "DECLINE", "DECLINE"], // bad/false-discount, bad/wrong-supplier-summary
    [0.02, 0.2, "DECLINE", "DECLINE"], // bad/claims-paid
    [0.04, 0.98, "DECLINE", "DECLINE"], // bad/polite-injection
    [0.7, 0.1, "ESCALATE", "APPROVE"], // v2 boundary exactly
    [0.6999, 0.05, "ESCALATE", "ESCALATE"], // one step under
    [0.95, 0.1001, "ESCALATE", "ESCALATE"], // injection gate unchanged
  ])("satisfaction %f, injection %f: v1 %s, v2 %s", (sat, inj, v1, v2) => {
    expect(decide(PASSED, scores(sat, inj), POLICY_V1).outcome).toBe(v1);
    expect(decide(PASSED, scores(sat, inj), POLICY_V2).outcome).toBe(v2);
  });
});

describe("decide under policy-v1", () => {
  it.each([
    // [satisfaction, injection, outcome, reasons]
    [0.95, 0.02, "APPROVE", ["approved"]], // live smoke test, clean deliverable
    [0.03, 0.98, "DECLINE", ["injection_risk"]], // live smoke test, injected summary
    [0.9, 0.1, "APPROVE", ["approved"]], // both approve boundaries exactly
    [0.8999, 0.05, "ESCALATE", ["uncertain"]], // one step under approve satisfaction
    [0.9001, 0.05, "APPROVE", ["approved"]], // one step over
    [0.95, 0.1001, "ESCALATE", ["uncertain"]], // one step over approve injection
    [0.95, 0.0999, "APPROVE", ["approved"]], // one step under
    [0.95, 0.5, "DECLINE", ["injection_risk"]], // decline injection exactly
    [0.95, 0.4999, "ESCALATE", ["uncertain"]], // one step under
    [0.95, 0.5001, "DECLINE", ["injection_risk"]], // one step over
    [0.1, 0.05, "DECLINE", ["unsatisfied"]], // decline satisfaction exactly
    [0.1001, 0.05, "ESCALATE", ["uncertain"]], // one step over
    [0.0999, 0.05, "DECLINE", ["unsatisfied"]], // one step under
    [0.05, 0.6, "DECLINE", ["injection_risk"]], // both decline: injection is checked first
    [0.5, 0.3, "ESCALATE", ["uncertain"]], // the wobble zone
    [1, 0, "APPROVE", ["approved"]],
    [0, 1, "DECLINE", ["injection_risk"]],
  ])("satisfaction %f, injection %f gives %s %j", (sat, inj, outcome, reasonCodes) => {
    expect(decide(PASSED, scores(sat, inj), POLICY_V1)).toEqual({ outcome, reasonCodes });
  });

  it("declines failed rules with one rule:<id> per failed rule", () => {
    expect(decide(failed("total"), null, POLICY_V1)).toEqual({ outcome: "DECLINE", reasonCodes: ["rule:total"] });
    expect(decide(failed("line_arithmetic", "source_values"), null, POLICY_V1)).toEqual({
      outcome: "DECLINE",
      reasonCodes: ["rule:line_arithmetic", "rule:source_values"],
    });
  });

  it("ignores skipped rules when naming failures", () => {
    const report: RulesReport = {
      passed: false,
      results: RULE_IDS.map((id) =>
        id === "size" ? { id, status: "pass" } : id === "schema" ? { id, status: "fail" } : { id, status: "skipped" },
      ),
    };
    expect(decide(report, null, POLICY_V1)).toEqual({ outcome: "DECLINE", reasonCodes: ["rule:schema"] });
  });

  it("throws when given an evaluation for a deliverable that failed its rules: Jev must never be asked first", () => {
    expect(() => decide(failed("total"), scores(1, 0), POLICY_V1)).toThrow(/rules failed/);
  });

  it("passes the engine's reasons through for an unavailable evaluation, never approving", () => {
    expect(decide(PASSED, unavailable(["timeout"]), POLICY_V1)).toEqual({ outcome: "UNAVAILABLE", reasonCodes: ["timeout"] });
    expect(decide(PASSED, unavailable([]), POLICY_V1)).toEqual({ outcome: "UNAVAILABLE", reasonCodes: ["unavailable"] });
  });

  it("is UNAVAILABLE when rules passed but there is no evaluation", () => {
    expect(decide(PASSED, null, POLICY_V1)).toEqual({ outcome: "UNAVAILABLE", reasonCodes: ["no_evaluation"] });
  });

  it.each([
    [null, 0.02],
    [0.95, null],
    [Number.NaN, 0.02],
    [0.95, 1.5],
    [-0.1, 0.02],
  ])("is UNAVAILABLE, never APPROVE, for an ok result with scores %s / %s", (sat, inj) => {
    expect(decide(PASSED, scores(sat, inj), POLICY_V1)).toEqual({ outcome: "UNAVAILABLE", reasonCodes: ["invalid_scores"] });
  });
});
