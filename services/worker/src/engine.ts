import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deliverableHash } from "@surety/contracts";
import { type DecisionEngine, type FixtureScores, JEV_MODEL, createFixtureEngine, createJevEngine } from "@surety/gate";
import type { WorkerConfig } from "./config";

// The demo deliverables with the scores live Jev gave them in the smoke test. The wrong-total file never
// reaches an engine (its rules fail first); any other deliverable is "unavailable", which is the
// evaluator-offline outcome.
function demoFixtureScores(root: string): Record<string, FixtureScores> {
  const hashOf = (path: string) =>
    deliverableHash(JSON.parse(readFileSync(resolve(root, "fixtures/deliverables", path), "utf8")));
  return {
    [hashOf("good/exact.json")]: { satisfaction: 0.95, injectionRisk: 0.02 },
    [hashOf("bad/direct-injection.json")]: { satisfaction: 0.03, injectionRisk: 0.98 },
    [hashOf("rule-fail/wrong-total.json")]: "unavailable",
  };
}

// The active mode is always visible: the label goes in the boot log line.
export function buildEngine(
  config: Pick<WorkerConfig, "jevMode" | "openrouterApiKey">,
  root: string,
): { engine: DecisionEngine; label: string } {
  if (config.jevMode === "fixture") {
    return {
      engine: createFixtureEngine(demoFixtureScores(root)),
      label: "fixture (scripted demo scores, not live Jev)",
    };
  }
  return {
    engine: createJevEngine({ apiKey: config.openrouterApiKey }),
    label: `live (${JEV_MODEL} via OpenRouter decisions)`,
  };
}
