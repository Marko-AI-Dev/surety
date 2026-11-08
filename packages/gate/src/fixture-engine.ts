import type { DecisionEngine, EvaluationResult } from "./engine";

export type FixtureScores = { satisfaction: number; injectionRisk: number } | "unavailable";

// Scripted scores by deliverable hash, for tests and offline demos. Always labelled "fixture" so a
// recorded decision can never pass for a live Jev call. Unknown hashes are unavailable, never guessed.
export function createFixtureEngine(byDeliverableHash: Record<string, FixtureScores>): DecisionEngine {
  const table = new Map(Object.entries(byDeliverableHash));
  return {
    mode: "fixture",
    async evaluate(input): Promise<EvaluationResult> {
      const entry = table.get(input.deliverableHash);
      const common = {
        mode: "fixture" as const,
        provider: "fixture",
        model: "fixture",
        latencyMs: 0,
        requestId: input.requestId,
        evaluatedAt: new Date().toISOString(),
        costUsd: null,
      };
      if (entry === undefined || entry === "unavailable") {
        return {
          ...common,
          status: "unavailable",
          satisfaction: null,
          injectionRisk: null,
          reasonCodes: [entry === undefined ? "fixture_missing" : "fixture_unavailable"],
        };
      }
      return { ...common, status: "ok", satisfaction: entry.satisfaction, injectionRisk: entry.injectionRisk, reasonCodes: [] };
    },
  };
}
