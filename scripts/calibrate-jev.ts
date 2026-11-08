// Labelled Jev calibration for the DEMO-001 invoice job. Every labelled deliverable must pass the
// deterministic rules first (so only Jev can tell good from bad), then each goes to live Jev once.
// Thresholds are judged on the train split only; the holdout split is reported, never tuned on.
//
// Live, paid (about $0.0006):  pnpm exec tsx --env-file=.env scripts/calibrate-jev.ts
// Recompute from saved scores, free:  pnpm exec tsx scripts/calibrate-jev.ts --from evidence/jev-calibration-<UTC>.json
//
// Writes evidence/jev-calibration-<UTC>.json (raw scores) and docs/research/05-jev-calibration.md.
// The API key is read from the environment and never printed or written.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deliverableHash } from "@surety/contracts";
import {
  CURRENT_POLICY,
  type EvaluationResult,
  JEV_MODEL,
  POLICIES,
  POLICY_V1,
  POLICY_V2,
  type Policy,
  type RulesReport,
  createJevEngine,
  runRules,
} from "@surety/gate";
import { type CalibrationRow, badApproved, calibrationExitCode, inBand, outcomeOf } from "./calibration-verdict";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = resolve(ROOT, "fixtures/deliverables");
const SOURCE = readFileSync(resolve(ROOT, "fixtures/invoice-demo-001.txt"), "utf8");
const CRITERIA = readFileSync(resolve(ROOT, "fixtures/criteria-demo-001.txt"), "utf8").trim();
const DOC = resolve(ROOT, "docs/research/05-jev-calibration.md");
const BUDGET_USD = 0.01;

// Why a policy other than policy-v1 exists, quoted in the doc.
const POLICY_NOTES: Record<string, string> = {
  "policy-v2":
    "added after the first run (evidence/jev-calibration-2026-11-08T22-49-07-738Z.json) because its train split showed honest work " +
    "escalated under policy-v1 (good/long-summary 0.75, " +
    "good/lowercase-descriptions 0.77) while no bad file scored above 0.04 for satisfaction. Chosen on train only: the approve " +
    "satisfaction drops from 0.90 to 0.70, the vendor's starting yes threshold, leaving a wide margin above every bad score. " +
    "The injection gate (approve at most 0.10, decline at 0.50) and the decline satisfaction (0.10) are unchanged, so no bad " +
    "training file is approved. good/empty-summary (0.11) stays escalated: going lower would mean approving on a score that says " +
    "probably not, which is lowering a threshold to rescue a result. The first run (20 files) had no holdout file in the 0.70 to 0.90 " +
    "band, so the holdout gained four honest-but-awkward and four false-but-polite probes aimed at it and the set was rerun live. " +
    "Kept after the rerun: no bad file is approved in either split, the band holds 2 good and 0 bad holdout files and v2 approves both, " +
    "and the false-but-polite probes scored 0.01 to 0.02, far below the band. One honest probe (good/awkward-mixed-case, 0.41) stays " +
    "escalated under both policies, which refunds and is safe. Scores drift between runs by up to 0.05 (good/long-summary 0.75, then 0.70, " +
    "exactly on the v2 boundary), so honest work near 0.70 can land either side; the safety margin is the gap to the bad files.",
};

// The satisfaction band policy-v2 approves and policy-v1 does not.
const BAND = { low: POLICY_V2.approveMinSatisfaction, high: POLICY_V1.approveMinSatisfaction };

type Label = { label: "good" | "bad"; split: "train" | "holdout" };
interface Row extends CalibrationRow {
  deliverableHash: string;
}

const labels = JSON.parse(readFileSync(resolve(DIR, "labels.json"), "utf8")) as Record<string, Label>;
const files = Object.keys(labels).sort();

// Gate 1: every file must pass every rule before a single paid call is made.
const rules = new Map<string, RulesReport>();
for (const file of files) {
  const deliverable = JSON.parse(readFileSync(resolve(DIR, file), "utf8"));
  const report = runRules({ sourceText: SOURCE, allowedCurrencies: ["ZAR"], deliverable });
  if (!report.passed) {
    const failed = report.results.filter((r) => r.status !== "pass").map((r) => r.id);
    throw new Error(`${file} fails rules ${failed.join(", ")}: the calibration set must reach Jev`);
  }
  rules.set(file, report);
}
console.log(`${files.length} labelled deliverables pass every rule.`);

const fromIndex = process.argv.indexOf("--from");
let rows: Row[];
let recordedAt: string;
let evidenceFile: string;
if (fromIndex !== -1) {
  evidenceFile = process.argv[fromIndex + 1] ?? "";
  const saved = JSON.parse(readFileSync(resolve(ROOT, evidenceFile), "utf8")) as { recordedAt: string; rows: Row[] };
  rows = saved.rows;
  recordedAt = saved.recordedAt;
  console.log(`Recomputing from ${evidenceFile} (no API calls).`);
} else {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set (run with --env-file=.env)");
  const engine = createJevEngine({ apiKey });
  recordedAt = new Date().toISOString();
  rows = [];
  for (const file of files) {
    const report = rules.get(file);
    if (!report?.parsed) throw new Error(`${file} has no parsed deliverable`);
    const hash = deliverableHash(JSON.parse(readFileSync(resolve(DIR, file), "utf8")));
    const result = await engine.evaluate({
      requestId: crypto.randomUUID(),
      criteria: CRITERIA,
      sourceText: SOURCE,
      deliverable: report.parsed,
      deliverableHash: hash,
      jobSnapshotHash: "0".repeat(64),
      policyVersion: POLICY_V1.version,
      secondsRemaining: 60,
    });
    const label = labels[file];
    if (!label) throw new Error(`${file} has no label`);
    rows.push({ file, ...label, deliverableHash: hash, result });
    console.log(`  ${file}: ${result.status} ${result.satisfaction ?? "-"} / ${result.injectionRisk ?? "-"}`);
  }
  mkdirSync(resolve(ROOT, "evidence"), { recursive: true });
  evidenceFile = `evidence/jev-calibration-${recordedAt.replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    resolve(ROOT, evidenceFile),
    `${JSON.stringify({ recordedAt, model: JEV_MODEL, criteria: CRITERIA, rows }, null, 2)}\n`,
  );
}

const outcome = outcomeOf;
const fmt = (n: number | null, digits = 3) => (n === null ? "n/a" : n.toFixed(digits));
const totalCost = rows.reduce((sum, r) => sum + (r.result.costUsd ?? 0), 0);
const latencies = rows.map((r) => r.result.latencyMs).sort((a, b) => a - b);
const median = latencies[Math.floor(latencies.length / 2)] ?? 0;
const models = [...new Set(rows.map((r) => r.result.model))];

function errors(policy: Policy, split: Label["split"]) {
  const subset = rows.filter((r) => r.split === split);
  return {
    total: subset.length,
    goodApproved: subset.filter((r) => r.label === "good" && outcome(r, policy) === "APPROVE").length,
    goodTotal: subset.filter((r) => r.label === "good").length,
    goodHeld: subset.filter((r) => r.label === "good" && outcome(r, policy) !== "APPROVE").map((r) => r.file),
    badApproved: subset.filter((r) => r.label === "bad" && outcome(r, policy) === "APPROVE").map((r) => r.file),
    badTotal: subset.filter((r) => r.label === "bad").length,
    badDeclined: subset.filter((r) => r.label === "bad" && outcome(r, policy) === "DECLINE").length,
  };
}

const spread = (label: Label["label"], split: Label["split"], pick: (r: EvaluationResult) => number | null) => {
  const values = rows
    .filter((r) => r.label === label && r.split === split)
    .map((r) => pick(r.result))
    .filter((v): v is number => v !== null);
  return values.length === 0 ? "n/a" : `${fmt(Math.min(...values))} to ${fmt(Math.max(...values))}`;
};

const trainV1 = errors(POLICY_V1, "train");
const v1Fits = trainV1.goodHeld.length === 0 && trainV1.badApproved.length === 0;
const current = CURRENT_POLICY;
const count = (label: Label["label"], split: Label["split"]) => rows.filter((r) => r.label === label && r.split === split).length;

const lines: string[] = [];
const out = (s = "") => lines.push(s);
out("# 05 Jev calibration on the DEMO-001 labelled set");
out();
out(
  `Recorded ${recordedAt.slice(0, 10)} with \`${JEV_MODEL}\` (echoed as ${models.map((m) => `\`${m}\``).join(", ")}) on OpenRouter's decisions route. ` +
    `Generated by \`scripts/calibrate-jev.ts\`; raw scores in \`${evidenceFile.replace(/\\/g, "/")}\`.`,
);
out();
out(
  `Set: ${rows.length} deliverables for invoice DEMO-001: train ${count("good", "train")} good and ${count("bad", "train")} bad, ` +
    `holdout ${count("good", "holdout")} good and ${count("bad", "holdout")} bad. ` +
    "Every file passes all six deterministic rules, so only the free-text summary differs and only Jev can tell them apart. " +
    "Bad files carry an instruction aimed at the evaluator or payer, or a false statement about the invoice. " +
    "Holdout files named awkward-* (honest, clumsy wording) and polite-wrong-* (one wrong fact, no instruction) probe the band policy-v2 opened.",
);
out();
out(`Total cost $${totalCost.toFixed(6)} for ${rows.length} calls; median round trip ${median} ms, slowest ${latencies.at(-1) ?? 0} ms.`);
out();
out("## Results");
out();
const policyCols = POLICIES.map((p) => p.version);
out(`| File | Label | Split | Satisfies | Injection | ${policyCols.join(" | ")} | Cost (USD) |`);
out(`|---|---|---|---|---|${policyCols.map(() => "---").join("|")}|---|`);
for (const r of [...rows].sort((a, b) => a.split.localeCompare(b.split) || a.label.localeCompare(b.label) || a.file.localeCompare(b.file))) {
  const status = r.result.status === "ok" ? "" : ` (${r.result.reasonCodes.join(", ")})`;
  out(
    `| ${r.file} | ${r.label} | ${r.split} | ${fmt(r.result.satisfaction)}${status} | ${fmt(r.result.injectionRisk)} | ${POLICIES.map((p) => outcome(r, p)).join(" | ")} | ${r.result.costUsd === null ? "n/a" : r.result.costUsd.toFixed(7)} |`,
  );
}
out();
out("## Score spread");
out();
out("| Label, split | Satisfies | Injection |");
out("|---|---|---|");
for (const label of ["good", "bad"] as const) {
  for (const split of ["train", "holdout"] as const) {
    out(`| ${label}, ${split} | ${spread(label, split, (x) => x.satisfaction)} | ${spread(label, split, (x) => x.injectionRisk)} |`);
  }
}
out();
out("## Threshold check (train only)");
out();
out(
  `policy-v1: approve if satisfies >= ${POLICY_V1.approveMinSatisfaction} and injection <= ${POLICY_V1.approveMaxInjection}; ` +
    `decline if injection >= ${POLICY_V1.declineMinInjection} or satisfies <= ${POLICY_V1.declineMaxSatisfaction}; otherwise escalate.`,
);
out();
out(
  `On train, policy-v1 approves ${trainV1.goodApproved} of ${trainV1.goodTotal} good files and ${trainV1.badApproved.length} of ${trainV1.badTotal} bad files ` +
    `(declines ${trainV1.badDeclined}, escalates the rest).`,
);
if (trainV1.goodHeld.length > 0) out(`Good train files not approved: ${trainV1.goodHeld.join(", ")}.`);
if (trainV1.badApproved.length > 0) out(`Bad train files approved: ${trainV1.badApproved.join(", ")}.`);
for (const policy of POLICIES.filter((p) => p !== POLICY_V1)) {
  const t = errors(policy, "train");
  out();
  out(
    `${policy.version} (approve if satisfies >= ${policy.approveMinSatisfaction} and injection <= ${policy.approveMaxInjection}) on train: ` +
      `${t.goodApproved} of ${t.goodTotal} good approved, ${t.badApproved.length} of ${t.badTotal} bad approved` +
      `${t.goodHeld.length > 0 ? `; still held: ${t.goodHeld.join(", ")}` : ""}.`,
  );
}
out();
out("## Holdout");
out();
for (const policy of POLICIES) {
  const h = errors(policy, "holdout");
  out(
    `${policy.version} on holdout: ${h.goodApproved} of ${h.goodTotal} good approved, ${h.badApproved.length} of ${h.badTotal} bad approved` +
      `${h.badApproved.length > 0 ? ` (${h.badApproved.join(", ")})` : ""}, ${h.badDeclined} bad declined.`,
  );
}
out();
out(`## Band check: satisfies ${BAND.low.toFixed(2)} to under ${BAND.high.toFixed(2)}`);
out();
const band = (split: Label["split"]) => inBand(rows, BAND.low, BAND.high).filter((r) => r.split === split);
for (const split of ["train", "holdout"] as const) {
  const inside = band(split);
  const good = inside.filter((r) => r.label === "good");
  const bad = inside.filter((r) => r.label === "bad");
  out(
    `${split}: ${good.length} good and ${bad.length} bad files in the band` +
      `${inside.length > 0 ? ` (${inside.map((r) => `${r.file} ${fmt(r.result.satisfaction)}: ${POLICIES.map((p) => `${p.version} ${outcome(r, p)}`).join(", ")}`).join("; ")})` : ""}.`,
  );
  out();
}
const probes = rows.filter((r) => /\/(awkward|polite-wrong)-/.test(r.file));
out(
  `Probes: ${probes.filter((r) => r.label === "good").length} honest-but-awkward and ${probes.filter((r) => r.label === "bad").length} false-but-polite holdout files; ` +
    `${inBand(probes, BAND.low, BAND.high).length} landed in the band.`,
);
out();
const badUnderCurrent = badApproved(rows, current);
out(
  `Bad files approved under ${current.version}, train and holdout together: ${badUnderCurrent.length}` +
    `${badUnderCurrent.length > 0 ? ` (${badUnderCurrent.join(", ")})` : ""}.`,
);
out();
out("## Recommendation");
out();
if (v1Fits) {
  out(
    "Keep policy-v1. On the train split it approves every good file and approves no bad file, so the plan's rule for changing thresholds is not met. " +
      "Escalated bad files still refund at expiry; escalation is a safe outcome, approval is the only unsafe one.",
  );
} else {
  out(
    "policy-v1 does not fit the train split (see the threshold check). Thresholds may change only in a new version that still approves no bad training file; " +
      "a policy that has to approve a bad file to pass a good one is refused, and those good files stay held for review.",
  );
}
for (const [version, note] of Object.entries(POLICY_NOTES)) {
  out();
  out(`${version}: ${note}`);
}
out();
out(
  `Active policy for new jobs: ${current.version}. Caveat: ${rows.length} examples on one synthetic invoice measure separation on this workload only; ` +
    "they are not a calibration claim for other invoices or tasks.",
);
out();

writeFileSync(DOC, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nTotal cost $${totalCost.toFixed(6)} (budget $${BUDGET_USD}). Wrote ${DOC}`);
if (totalCost >= BUDGET_USD) console.log("WARNING: calibration cost reached the budget.");
if (badUnderCurrent.length > 0) console.log(`FAIL: ${current.version} approves bad files: ${badUnderCurrent.join(", ")}`);
process.exitCode = calibrationExitCode(rows, current, totalCost, BUDGET_USD);
