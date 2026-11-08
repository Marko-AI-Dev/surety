import { describe, expect, it } from "vitest";
import { type EvaluationResult, POLICY_V1, POLICY_V2 } from "@surety/gate";
import { type CalibrationRow, badApproved, calibrationExitCode, inBand } from "../scripts/calibration-verdict";

function row(file: string, label: "good" | "bad", split: "train" | "holdout", sat: number, inj: number): CalibrationRow {
  const result: EvaluationResult = {
    status: "ok",
    mode: "live",
    satisfaction: sat,
    injectionRisk: inj,
    provider: "TypeSafe",
    model: "typesafe/jev-1.14-20261014",
    latencyMs: 500,
    reasonCodes: [],
    requestId: file,
    evaluatedAt: "2026-11-09T00:00:00.000Z",
    costUsd: 0.00003,
  };
  return { file, label, split, result };
}

const CLEAN = [
  row("good/a.json", "good", "train", 0.95, 0.02),
  row("good/b.json", "good", "holdout", 0.11, 0.03), // escalated honest work does not fail the run
  row("bad/a.json", "bad", "train", 0.02, 0.99),
  row("bad/b.json", "bad", "holdout", 0.3, 0.05), // escalated bad work does not fail the run
];

describe("calibration exit code", () => {
  it("is 0 when no bad file is approved and the cost is under budget", () => {
    expect(badApproved(CLEAN, POLICY_V2)).toEqual([]);
    expect(calibrationExitCode(CLEAN, POLICY_V2, 0.001, 0.01)).toBe(0);
  });

  it("is 1 when a bad holdout file is approved under the policy checked", () => {
    const rows = [...CLEAN, row("bad/polite.json", "bad", "holdout", 0.8, 0.03)];
    expect(badApproved(rows, POLICY_V2)).toEqual(["bad/polite.json"]);
    expect(calibrationExitCode(rows, POLICY_V2, 0.001, 0.01)).toBe(1);
    // The same row is only escalated under v1, so v1 passes.
    expect(calibrationExitCode(rows, POLICY_V1, 0.001, 0.01)).toBe(0);
  });

  it("is 1 when a bad train file is approved", () => {
    const rows = [...CLEAN, row("bad/train.json", "bad", "train", 0.97, 0.01)];
    expect(calibrationExitCode(rows, POLICY_V1, 0.001, 0.01)).toBe(1);
  });

  it("is 1 when the run cost reached the budget", () => {
    expect(calibrationExitCode(CLEAN, POLICY_V2, 0.01, 0.01)).toBe(1);
  });

  it("selects the rows whose satisfaction lies in a band, lower bound inclusive", () => {
    const rows = [...CLEAN, row("good/c.json", "good", "holdout", 0.7, 0.02), row("good/d.json", "good", "holdout", 0.9, 0.02)];
    expect(inBand(rows, 0.7, 0.9).map((r) => r.file)).toEqual(["good/c.json"]);
  });
});
