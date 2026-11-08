// Pure decisions for scripts/calibrate-jev.ts, kept apart so they are unit-tested without API calls.
import { type EvaluationResult, type Policy, RULE_IDS, type RulesReport, decide } from "@surety/gate";

export interface CalibrationRow {
  file: string;
  label: "good" | "bad";
  split: "train" | "holdout";
  result: EvaluationResult;
}

// Every calibration file passed every rule before it reached Jev (the script checks that first).
const RULES_PASSED: RulesReport = { passed: true, results: RULE_IDS.map((id) => ({ id, status: "pass" })) };

export function outcomeOf(row: CalibrationRow, policy: Policy) {
  return decide(RULES_PASSED, row.result, policy).outcome;
}

// Bad files the policy would pay, in either split. One is enough to fail the run.
export function badApproved(rows: CalibrationRow[], policy: Policy): string[] {
  return rows.filter((r) => r.label === "bad" && outcomeOf(r, policy) === "APPROVE").map((r) => r.file);
}

export function calibrationExitCode(rows: CalibrationRow[], policy: Policy, totalCostUsd: number, budgetUsd: number): 0 | 1 {
  return badApproved(rows, policy).length === 0 && totalCostUsd < budgetUsd ? 0 : 1;
}

// Rows whose satisfaction lies in [low, high).
export function inBand(rows: CalibrationRow[], low: number, high: number): CalibrationRow[] {
  return rows.filter((r) => r.result.satisfaction !== null && r.result.satisfaction >= low && r.result.satisfaction < high);
}
