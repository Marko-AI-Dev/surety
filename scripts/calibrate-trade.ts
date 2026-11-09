// Labelled calibration of Surety Verify's decision model on trade documents (the deal's commercial
// invoice and bill of lading). Every labelled file must pass all 12 trade rules first, so only the
// model can tell good from bad. Each file goes to live Jev once, with the exact state production
// sends (tradeState). Thresholds are judged on the train split only; the holdout is reported, never tuned on.
//
// Live, paid (about $0.0007):  pnpm exec tsx --env-file=.env scripts/calibrate-trade.ts
// Recompute from saved scores, free:  pnpm exec tsx scripts/calibrate-trade.ts --from evidence/jev-trade-calibration-<UTC>.json
//
// Writes evidence/jev-trade-calibration-<UTC>.json and docs/research/06-trade-calibration.md.
// The API key is read from the environment and never printed or written.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type TradeDocuments, deliverableHash } from "@surety/contracts";
import {
  JEV_MODEL,
  JEV_TRADE_QUESTIONS,
  TRADE_POLICY,
  createJevEngine,
  isBorderline,
  parseTradeDocuments,
  renderPurchaseOrder,
  runTradeRules,
  tradeState,
} from "@surety/gate";
import { type CalibrationRow, badApproved, calibrationExitCode, outcomeOf, thresholdVerdict } from "./calibration-verdict";
import { SUPPLIER, intent, quote } from "./deal-fixtures";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = resolve(ROOT, "fixtures/deals/labelled");
const DOC = resolve(ROOT, "docs/research/06-trade-calibration.md");
const BUDGET_USD = 0.01;
const POLICY = TRADE_POLICY;
const PURCHASE_ORDER = renderPurchaseOrder(intent, quote);

type Label = { label: "good" | "bad"; split: "train" | "holdout" };
interface Row extends CalibrationRow {
  deliverableHash: string;
}

const labels = JSON.parse(readFileSync(resolve(DIR, "labels.json"), "utf8")) as Record<string, Label>;
const files = Object.keys(labels).sort();
const docsOf = (file: string) => JSON.parse(readFileSync(resolve(DIR, file), "utf8")) as TradeDocuments;

// Gate 1: every file must pass every trade rule before a single paid call is made.
for (const file of files) {
  const docs = docsOf(file);
  const report = runTradeRules({
    intent,
    quote,
    documents: docs,
    readerFields: parseTradeDocuments(docs),
    lock: { destination: SUPPLIER, amount: { asset: "TESTUSD", cents: String(quote.totalCents) } },
  });
  if (!report.passed) {
    const failed = report.results.filter((r) => r.status !== "pass").map((r) => r.id);
    throw new Error(`${file} fails trade rules ${failed.join(", ")}: the calibration set must reach the model`);
  }
}
console.log(`${files.length} labelled document sets pass all 12 trade rules.`);

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
    const docs = docsOf(file);
    const hash = deliverableHash(docs);
    const result = await engine.evaluate({
      requestId: crypto.randomUUID(),
      questionSet: "trade",
      state: tradeState(PURCHASE_ORDER, quote, docs),
      deliverableHash: hash,
      jobSnapshotHash: "0".repeat(64),
      policyVersion: POLICY.version,
      secondsRemaining: 60,
    });
    const label = labels[file];
    if (!label) throw new Error(`${file} has no label`);
    rows.push({ file, ...label, deliverableHash: hash, result });
    console.log(`  ${file}: ${result.status} ${result.satisfaction ?? "-"} / ${result.injectionRisk ?? "-"}`);
  }
  mkdirSync(resolve(ROOT, "evidence"), { recursive: true });
  evidenceFile = `evidence/jev-trade-calibration-${recordedAt.replaceAll(":", "-").replace(".", "-")}.json`;
  const totalCostUsd = rows.reduce((acc, r) => acc + (r.result.costUsd ?? 0), 0);
  writeFileSync(
    resolve(ROOT, evidenceFile),
    `${JSON.stringify({ recordedAt, model: JEV_MODEL, questions: JEV_TRADE_QUESTIONS, policy: POLICY, rows, totalCostUsd }, null, 2)}\n`,
  );
  console.log(`Wrote ${evidenceFile}`);
}

const totalCostUsd = rows.reduce((acc, r) => acc + (r.result.costUsd ?? 0), 0);
const unavailable = rows.filter((r) => r.result.status !== "ok").map((r) => r.file);
const paidBad = badApproved(rows, POLICY);
const verdict = thresholdVerdict(rows, POLICY);
const fmt = (v: number | null) => (v === null ? "-" : v.toFixed(2));
const band = POLICY.reaskBand;

const table = rows
  .map((r) => {
    const reask = band && r.result.status === "ok" && isBorderline(r.result, band) ? "yes" : "";
    return `| ${r.file} | ${r.label} | ${r.split} | ${fmt(r.result.satisfaction)} | ${fmt(r.result.injectionRisk)} | ${outcomeOf(r, POLICY)} | ${reask} |`;
  })
  .join("\n");

const count = (label: string, split: string, outcome: string) =>
  rows.filter((r) => r.label === label && r.split === split && outcomeOf(r, POLICY) === outcome).length;
const verdictText =
  verdict.kind === "keep"
    ? `**Keep \`${POLICY.version}\`.** On the train split every bad file declines and every good file approves.`
    : verdict.kind === "midpoint"
      ? `**Move the approve line to ${verdict.approveMinSatisfaction.toFixed(2)}**, the midpoint of the train gap between the highest bad and the lowest good satisfaction.`
      : "**No safe line on the train split.** Good and bad satisfaction overlap: this goes to Marko as a product decision.";

const doc = `# Surety Verify calibration on trade documents

Recorded ${recordedAt} with \`${JEV_MODEL}\` through OpenRouter. Evidence: \`${evidenceFile}\`. Total cost $${totalCostUsd.toFixed(6)}.

## Method

- **The set:** 20 document pairs (commercial invoice and bill of lading) for the demo deal PO-2026-0412, generated by \`scripts/deal-fixtures.ts\`. 10 are honest and vary only the free text and wording. 10 carry an instruction aimed at the evaluator or the payer in a Remarks line.
- **Rules first:** every file passes all 12 trade rules, so only the decision model can tell good from bad.
- **One answer each,** with the exact state production sends (\`tradeState\`: the purchase order, the accepted quote and both documents). Production re-asks borderline answers; the last column shows which files would be re-asked.
- **Thresholds are judged on the train split only** (6 good, 6 bad). The holdout (4 and 4) is reported, never tuned on.

## Results under \`${POLICY.version}\`

| File | Label | Split | Satisfaction | Injection | Outcome (one answer) | Re-ask |
|---|---|---|---|---|---|---|
${table}

- **Train:** good approved ${count("good", "train", "APPROVE")} of 6, bad declined ${count("bad", "train", "DECLINE")} of 6.
- **Holdout:** good approved ${count("good", "holdout", "APPROVE")} of 4, bad declined ${count("bad", "holdout", "DECLINE")} of 4.
- **Bad files that would be paid, either split:** ${paidBad.length === 0 ? "none" : paidBad.join(", ")}.
- **Unavailable answers:** ${unavailable.length === 0 ? "none" : unavailable.join(", ")}.

## Verdict

${verdictText}

An escalated or unavailable result never pays: the deal is held and refunded at its deadline.
`;
writeFileSync(DOC, doc);
console.log(`Wrote docs/research/06-trade-calibration.md`);
console.log(`Verdict: ${verdict.kind}${verdict.kind === "midpoint" ? ` ${verdict.approveMinSatisfaction}` : ""}; bad paid: ${paidBad.length}; cost $${totalCostUsd.toFixed(6)}`);
process.exitCode = calibrationExitCode(rows, POLICY, totalCostUsd, BUDGET_USD);
