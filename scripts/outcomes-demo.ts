// Testnet evidence of every gate outcome. Four DEMO-001 jobs, 1 XRP each, 120 s windows:
//   paid      good deliverable: rules pass, live Jev approves, the signer finishes the escrow
//   rejected  wrong total: a deterministic rule fails, Jev is never called, refund at expiry
//   blocked   instruction in the summary: rules pass, live Jev declines on injection risk, refund
//   offline   good deliverable judged by a Jev engine pointed at http://127.0.0.1:9/ (nothing listens,
//             a real network failure): UNAVAILABLE, held for review, refund at expiry
// Then the job engine (runEngineOnce, in-process) runs every 5 s with live Jev until all four are
// final or 300 s pass. Needs the signer (pnpm signer) and Supabase (pnpm db:start).
// Run: pnpm demo:outcomes
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "xrpl";
import { createJevEngine, CURRENT_POLICY } from "@surety/gate";
import { createSignerClient } from "@surety/signer-client";
import { type Job, createPgRepo, deliverJob, evaluateJob, fundJob, runEngineOnce } from "@surety/workflow";
import { explorerTxUrl, getEscrow, getTxResult, getValidatedCloseTime, rippleToIso } from "@surety/xrpl-settlement";

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run with --env-file=.env)`);
  return value;
}

const ROOT = resolve(import.meta.dirname, "..");
const fixture = (path: string) => readFileSync(resolve(ROOT, "fixtures", path), "utf8");
const SOURCE = fixture("invoice-demo-001.txt");
const CRITERIA = fixture("criteria-demo-001.txt").trim();
const deliverable = (path: string) => JSON.parse(fixture(`deliverables/${path}`)) as unknown;
const OFFLINE_URL = "http://127.0.0.1:9/";
const PASS_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 300_000;
const FINAL = new Set(["PAID", "REFUNDED", "CREATE_FAILED", "RECONCILIATION_REQUIRED"]);

const repo = createPgRepo(need("DATABASE_URL"));
const signer = createSignerClient({ url: need("SIGNER_URL"), hmacSecret: need("SIGNER_HMAC_SECRET") });
const gateSecret = need("GATE_AUTH_SECRET");
const seller = need("SELLER_ADDRESS");
const liveJev = createJevEngine({ apiKey: need("OPENROUTER_API_KEY") });
// The real key never goes to the dead endpoint.
const offlineJev = createJevEngine({ apiKey: "offline-demo-no-key", url: OFFLINE_URL });
const xrpl = new Client(need("XRPL_WS_URL"), { connectionTimeout: 20_000 });
const ledgerCloseTime = async () => {
  if (!xrpl.isConnected()) await xrpl.connect();
  return getValidatedCloseTime(xrpl);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);

const CASES = [
  { name: "paid", file: "good/exact.json", expect: "PAID" },
  { name: "rejected", file: "rule-fail/wrong-total.json", expect: "REFUNDED" },
  { name: "blocked", file: "bad/direct-injection.json", expect: "REFUNDED" },
  { name: "offline", file: "good/exact.json", expect: "REFUNDED" },
] as const;

try {
  await xrpl.connect();
  const health = await signer.health();
  log(`signer up: buyer ${health.buyer}, seller ${seller}; policy ${CURRENT_POLICY.version}`);
  const stamp = Date.now();

  const jobs: Job[] = [];
  for (const c of CASES) {
    const created = await repo.createJob({
      ref: `outcomes-${stamp}-${c.name}`,
      buyerAddress: health.buyer,
      sellerAddress: seller,
      amount: { asset: "XRP", drops: "1000000" },
      sourceText: SOURCE,
      criteria: { allowedCurrencies: ["ZAR"], schema: "invoice-deliverable-v1" },
      criteriaText: CRITERIA,
      policyVersion: CURRENT_POLICY.version,
      cancelAfterSeconds: 120,
    });
    const locked = await fundJob({ repo, signer, actor: "outcomes-demo" }, created.id);
    const escrow = await repo.getEscrow(locked.id);
    if (locked.state !== "LOCKED" || !escrow) throw new Error(`funding ${created.ref} ended ${locked.state}`);
    log(`${c.name}: LOCKED, sequence ${escrow.offerSequence}, cancel after ${rippleToIso(escrow.cancelAfter)}`);
    jobs.push(locked);
  }

  // Deliver the three engine-judged jobs, then the outage job last, judged at once by the dead endpoint.
  for (const [i, c] of CASES.entries()) {
    const job = jobs[i] as Job;
    const delivered = await deliverJob({ repo }, job.id, deliverable(c.file));
    log(`${c.name}: ${delivered.state} (${c.file})`);
  }
  const offline = jobs[3] as Job;
  const held = await evaluateJob({ repo, engine: offlineJev, ledgerCloseTime }, offline.id);
  log(`offline: evaluator at ${OFFLINE_URL} -> ${held.state}`);

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    try {
      await runEngineOnce({ repo, signer, engine: liveJev, gateSecret, ledgerCloseTime, log });
    } catch (e) {
      log(`pass error: ${e instanceof Error ? e.message : String(e)}`);
    }
    const states = await Promise.all(jobs.map(async (j) => (await repo.getJob(j.id))?.state ?? "missing"));
    log(`states: ${CASES.map((c, i) => `${c.name}=${states[i]}`).join(" ")}`);
    if (states.every((s) => FINAL.has(s)) || Date.now() > deadline) break;
    await sleep(PASS_INTERVAL_MS);
  }

  const confirm = async (hash: string | null | undefined) => {
    if (!hash) return null;
    const r = await getTxResult(xrpl, hash);
    return { txHash: hash, validated: r.validated, result: r.result, ledgerIndex: r.ledgerIndex, feeDrops: r.feeDrops, explorer: explorerTxUrl(hash) };
  };

  const results = [];
  for (const [i, c] of CASES.entries()) {
    const job = (await repo.getJob((jobs[i] as Job).id)) as Job;
    const escrow = await repo.getEscrow(job.id);
    const txs = await repo.listTransactions(job.id);
    const decision = await repo.latestDecision(job.id);
    const tx = (type: string) => txs.find((t) => t.type === type && t.status === "validated");
    results.push({
      case: c.name,
      expected: c.expect,
      deliverableFile: c.file,
      evaluator:
        c.name === "offline"
          ? `evaluator offline: Jev engine pointed at ${OFFLINE_URL}, where nothing listens (a real connection failure)`
          : c.name === "rejected"
            ? "none: a deterministic rule failed, so Jev was not called"
            : "live Jev (typesafe/jev-1.14 via OpenRouter decisions)",
      job: {
        id: job.id,
        ref: job.ref,
        finalState: job.state,
        snapshotHash: job.snapshotHash,
        deliverableHash: job.deliverableHash,
        policyVersion: job.policyVersion,
        amount: job.amount,
        seller: job.sellerAddress,
      },
      decision: decision && {
        id: decision.id,
        outcome: decision.outcome,
        mode: decision.mode,
        provider: decision.provider,
        model: decision.model,
        satisfaction: decision.satisfaction,
        injectionRisk: decision.injectionRisk,
        reasonCodes: decision.reasonCodes,
        policyVersion: decision.policyVersion,
        costUsd: decision.costUsd,
        latencyMs: decision.latencyMs,
        rules: decision.rules,
        decidedAt: decision.decidedAt,
      },
      escrow: escrow && {
        owner: escrow.owner,
        offerSequence: escrow.offerSequence,
        cancelAfter: escrow.cancelAfter,
        cancelAfterIso: rippleToIso(escrow.cancelAfter),
        onLedgerNow: (await getEscrow(xrpl, escrow.owner, escrow.offerSequence)) !== null,
      },
      create: await confirm(tx("create")?.txHash),
      finish: await confirm(tx("finish")?.txHash),
      cancel: await confirm(tx("cancel")?.txHash),
      transactions: txs,
      jobEvents: await repo.listEvents(job.id),
    });
  }

  const jevCost = results.reduce((sum, r) => sum + (r.decision?.costUsd ?? 0), 0);
  const [paid, rejected, blocked, off] = results;
  const checks = {
    paidIsPaid: paid?.job.finalState === "PAID" && paid.finish?.validated === true && paid.finish.result === "tesSUCCESS",
    refundsValidated: [rejected, blocked, off].every(
      (r) => r?.job.finalState === "REFUNDED" && r.cancel?.validated === true && r.cancel.result === "tesSUCCESS",
    ),
    rejectedByRuleWithoutJev:
      rejected?.decision?.outcome === "DECLINE" &&
      rejected.decision.mode === null &&
      rejected.decision.reasonCodes.some((code) => code.startsWith("rule:")),
    blockedByJevInjection:
      blocked?.decision?.outcome === "DECLINE" && blocked.decision.mode === "live" && blocked.decision.reasonCodes.includes("injection_risk"),
    offlineUnavailable: off?.decision?.outcome === "UNAVAILABLE",
    noRefundedJobFinished: [rejected, blocked, off].every((r) => r?.finish === null),
    escrowsGone: results.every((r) => r.escrow?.onLedgerNow === false),
  };

  const evidence = {
    network: "XRPL Testnet",
    recordedAt: new Date().toISOString(),
    policy: CURRENT_POLICY,
    jevCostUsd: jevCost,
    checks,
    results,
  };
  mkdirSync(resolve(ROOT, "evidence"), { recursive: true });
  const file = resolve(ROOT, "evidence", `outcomes-${evidence.recordedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  log(`evidence written: ${file}`);
  for (const r of results) {
    const settle = r.finish ?? r.cancel;
    log(`${r.case}: ${r.job.finalState}, decision ${r.decision?.outcome} ${r.decision?.reasonCodes.join(",")}, settle ${settle?.txHash ?? "none"}`);
  }
  log(`Jev spend this run: $${jevCost.toFixed(6)}`);
  const ok = Object.values(checks).every(Boolean);
  log(ok ? "PASS: paid, rejected, blocked and evaluator-offline outcomes all validated on testnet" : `FAIL: ${JSON.stringify(checks)}`);
  process.exitCode = ok ? 0 : 1;
} finally {
  await repo.close();
  await xrpl.disconnect();
}
