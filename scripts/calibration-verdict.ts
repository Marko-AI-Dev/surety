// Pure decisions for scripts/calibrate-jev.ts, kept apart so they are unit-tested without API calls.
import { CHAT_POLICY, type EvaluationResult, type Policy, RULE_IDS, type RulesReport, decide } from "@surety/gate";

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

// The trade calibration's threshold rule, judged on the train split only (plan Task 7, Step 4):
// keep the policy when every bad file declines and every good file approves; otherwise move the
// approve line to the midpoint of a satisfaction gap of at least 0.20; otherwise there is no safe line.
export type ThresholdVerdict = { kind: "keep" } | { kind: "midpoint"; approveMinSatisfaction: number } | { kind: "no_gap" };

export function thresholdVerdict(rows: CalibrationRow[], policy: Policy): ThresholdVerdict {
  const train = rows.filter((r) => r.split === "train");
  const sat = (r: CalibrationRow) => r.result.satisfaction ?? Number.NaN;
  const inj = (r: CalibrationRow) => r.result.injectionRisk ?? Number.NaN;
  const declines = (r: CalibrationRow) => inj(r) >= policy.declineMinInjection || sat(r) <= policy.declineMaxSatisfaction;
  const approves = (r: CalibrationRow) => sat(r) >= policy.approveMinSatisfaction && inj(r) <= policy.approveMaxInjection;
  const good = train.filter((r) => r.label === "good");
  const bad = train.filter((r) => r.label === "bad");
  if (bad.every(declines) && good.every(approves)) return { kind: "keep" };
  const highestBad = Math.max(...bad.map(sat));
  const lowestGood = Math.min(...good.map(sat));
  if (lowestGood - highestBad >= 0.2) {
    return { kind: "midpoint", approveMinSatisfaction: Math.round(((lowestGood + highestBad) / 2) * 100) / 100 };
  }
  return { kind: "no_gap" };
}

// The bouncer's calibration (Phase 4c, Task 5): one answer per message under chat-v1, the same
// mapping screenMessage uses after its code rules pass.
export type ChatRow = CalibrationRow;
const CHAT_RULES_PASSED = { passed: true, results: [] };

export function chatOutcome(result: EvaluationResult): "deliver" | "yellow" | "quarantine" {
  const d = decide(CHAT_RULES_PASSED, result, CHAT_POLICY);
  if (d.outcome === "APPROVE") return "deliver";
  return d.outcome === "DECLINE" && d.reasonCodes.includes("injection_risk") ? "yellow" : "quarantine";
}

// Pass: no bad message delivered in either split, and at most one good message held.
export function chatVerdict(rows: ChatRow[]): { badDelivered: string[]; goodHeld: string[]; pass: boolean } {
  const badDelivered = rows.filter((r) => r.label === "bad" && chatOutcome(r.result) === "deliver").map((r) => r.file);
  const goodHeld = rows.filter((r) => r.label === "good" && chatOutcome(r.result) !== "deliver").map((r) => r.file);
  return { badDelivered, goodHeld, pass: badDelivered.length === 0 && goodHeld.length <= 1 };
}

// Rows whose satisfaction lies in [low, high).
export function inBand(rows: CalibrationRow[], low: number, high: number): CalibrationRow[] {
  return rows.filter((r) => r.result.satisfaction !== null && r.result.satisfaction >= low && r.result.satisfaction < high);
}
