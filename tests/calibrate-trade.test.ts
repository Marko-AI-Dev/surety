import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type TradeDocuments } from "@surety/contracts";
import { type EvaluationResult, POLICY_V3_TRADE, parseTradeDocuments, runTradeRules } from "@surety/gate";
import { SUPPLIER, intent, quote } from "../scripts/deal-fixtures";
import { thresholdVerdict, type CalibrationRow } from "../scripts/calibration-verdict";

const DIR = resolve(import.meta.dirname, "..", "fixtures", "deals", "labelled");
type Label = { label: "good" | "bad"; split: "train" | "holdout" };
const labels = JSON.parse(readFileSync(resolve(DIR, "labels.json"), "utf8")) as Record<string, Label>;

describe("trade calibration set", () => {
  it("has 10 good and 10 bad files, split 6 and 6 for training, 4 and 4 held out", () => {
    const count = (label: string, split: string) =>
      Object.values(labels).filter((l) => l.label === label && l.split === split).length;
    expect([count("good", "train"), count("bad", "train"), count("good", "holdout"), count("bad", "holdout")]).toEqual([6, 6, 4, 4]);
  });

  it("every labelled trade file passes all 12 trade rules", () => {
    for (const file of Object.keys(labels)) {
      const docs = JSON.parse(readFileSync(resolve(DIR, file), "utf8")) as TradeDocuments;
      const report = runTradeRules({
        intent,
        quote,
        documents: docs,
        readerFields: parseTradeDocuments(docs),
        lock: { destination: SUPPLIER, amount: { asset: "TESTUSD", cents: "4800000" } },
      });
      const failed = report.results.filter((r) => r.status !== "pass").map((r) => r.id);
      expect({ file, failed }).toEqual({ file, failed: [] });
    }
  });
});

const result = (satisfaction: number, injectionRisk: number): EvaluationResult => ({
  status: "ok",
  mode: "live",
  satisfaction,
  injectionRisk,
  provider: "TypeSafe",
  model: "typesafe/jev-1.14",
  latencyMs: 1,
  reasonCodes: [],
  requestId: "r",
  evaluatedAt: "2026-11-09T12:00:00.000Z",
  costUsd: 0,
});
const row = (label: "good" | "bad", split: "train" | "holdout", sat: number, inj: number): CalibrationRow => ({
  file: `${label}-${sat}-${inj}`,
  label,
  split,
  result: result(sat, inj),
});

describe("thresholdVerdict (train split only)", () => {
  it("keeps the policy when every bad file declines and every good file approves", () => {
    const rows = [row("good", "train", 0.9, 0.02), row("bad", "train", 0.05, 0.9), row("bad", "holdout", 0.95, 0.01)];
    expect(thresholdVerdict(rows, POLICY_V3_TRADE)).toEqual({ kind: "keep" });
  });

  it("moves the approve line to the midpoint of a gap of at least 0.20", () => {
    const rows = [row("good", "train", 0.62, 0.02), row("bad", "train", 0.3, 0.02)];
    expect(thresholdVerdict(rows, POLICY_V3_TRADE)).toEqual({ kind: "midpoint", approveMinSatisfaction: 0.46 });
  });

  it("reports no gap when good and bad overlap", () => {
    const rows = [row("good", "train", 0.62, 0.02), row("bad", "train", 0.55, 0.02)];
    expect(thresholdVerdict(rows, POLICY_V3_TRADE)).toEqual({ kind: "no_gap" });
  });
});
