// Is Jev deterministic? Sends the same honest deliverable for invoice DEMO-001 to live Jev five
// times and compares the scores. Decides whether the pitch may call the decision step
// "deterministic". good/long-summary.json is used because calibration already saw it move between runs.
//
// Live, paid (under $0.001):  pnpm exec tsx --env-file=.env scripts/jev-repeat-test.ts
// Writes evidence/jev-repeat-<UTC>.json. The API key is read from the environment and never printed or written.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deliverableHash } from "@surety/contracts";
import { CURRENT_POLICY, JEV_MODEL, createJevEngine, invoiceState, runRules } from "@surety/gate";

const RUNS = 5;
const FILE = "good/long-summary.json";
const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = readFileSync(resolve(ROOT, "fixtures/invoice-demo-001.txt"), "utf8");
const CRITERIA = readFileSync(resolve(ROOT, "fixtures/criteria-demo-001.txt"), "utf8").trim();

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set (run with --env-file=.env)");

const raw = JSON.parse(readFileSync(resolve(ROOT, "fixtures/deliverables", FILE), "utf8"));
const report = runRules({ sourceText: SOURCE, allowedCurrencies: ["ZAR"], deliverable: raw });
if (!report.passed || !report.parsed) throw new Error(`${FILE} must pass every rule before any paid call`);
const hash = deliverableHash(raw);

interface Run {
  run: number;
  status: string;
  satisfaction: number | null;
  injectionRisk: number | null;
  latencyMs: number;
  costUsd: number | null;
}

const engine = createJevEngine({ apiKey });
const runs: Run[] = [];
for (let i = 1; i <= RUNS; i++) {
  const r = await engine.evaluate({
    requestId: crypto.randomUUID(),
    questionSet: "invoice",
    state: invoiceState(CRITERIA, SOURCE, report.parsed),
    deliverableHash: hash,
    jobSnapshotHash: "0".repeat(64),
    policyVersion: CURRENT_POLICY.version,
    secondsRemaining: 60,
  });
  runs.push({ run: i, status: r.status, satisfaction: r.satisfaction, injectionRisk: r.injectionRisk, latencyMs: r.latencyMs, costUsd: r.costUsd });
  console.log(`run ${i}: ${r.status} satisfaction ${r.satisfaction ?? "-"} injection ${r.injectionRisk ?? "-"} (${r.latencyMs} ms)`);
}

const spread = (key: "satisfaction" | "injectionRisk") => {
  const values = runs.map((r) => r[key]).filter((v): v is number => typeof v === "number");
  return values.length ? { min: Math.min(...values), max: Math.max(...values), distinct: new Set(values).size } : null;
};
const sat = spread("satisfaction");
const inj = spread("injectionRisk");
const identical = runs.every((r) => r.status === "ok") && sat?.distinct === 1 && inj?.distinct === 1;
const totalCost = runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
console.log(`identical across ${RUNS} runs: ${identical}; satisfaction ${sat?.min}..${sat?.max}, injection ${inj?.min}..${inj?.max}; cost $${totalCost.toFixed(6)}`);

const recordedAt = new Date().toISOString();
const evidence = { recordedAt, model: JEV_MODEL, file: FILE, deliverableHash: hash, runs, satisfaction: sat, injectionRisk: inj, identical, totalCostUsd: totalCost };
mkdirSync(resolve(ROOT, "evidence"), { recursive: true });
const out = resolve(ROOT, "evidence", `jev-repeat-${recordedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`evidence written: ${out}`);
