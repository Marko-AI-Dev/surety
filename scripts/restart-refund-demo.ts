// Testnet evidence that refunds survive a worker restart. Fund a job with a 60 second window, run
// the expiry worker, kill it hard while validated ledger time is still before CancelAfter, wait with
// no worker running until ledger time passes CancelAfter, then start a fresh worker and watch its
// first sweep refund the escrow. Needs the signer (pnpm signer) and Supabase (pnpm db:start).
// Run: node --env-file=.env --import tsx scripts/restart-refund-demo.ts
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "xrpl";
import { createSignerClient } from "@surety/signer-client";
import { createPgRepo, fundJob } from "@surety/workflow";
import { explorerTxUrl, getEscrow, getTxResult, getValidatedCloseTime, rippleToIso } from "@surety/xrpl-settlement";

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run with --env-file=.env)`);
  return value;
}

const ROOT = resolve(import.meta.dirname, "..");
const SELLER = need("SELLER_ADDRESS");
const RUN_WORKER_MS = 15_000;
const REFUND_TIMEOUT_MS = 120_000;

const repo = createPgRepo(need("DATABASE_URL"));
const signer = createSignerClient({ url: need("SIGNER_URL"), hmacSecret: need("SIGNER_HMAC_SECRET") });
const xrpl = new Client(need("XRPL_WS_URL"), { connectionTimeout: 20_000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);

interface Worker {
  child: ChildProcess;
  startedAt: string;
  output: string[];
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

// One child process, node itself (no pnpm wrapper), so killing it leaves nothing orphaned.
function startWorker(label: string): Worker {
  const child = spawn(process.execPath, ["--env-file=.env", "--import", "tsx", "services/worker/src/main.ts"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: string[] = [];
  const collect = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      output.push(line);
      log(`[${label}] ${line}`);
    }
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.on("exit", (code, signal) => done({ code, signal })),
  );
  log(`[${label}] started, pid ${child.pid}`);
  return { child, startedAt: new Date().toISOString(), output, exited };
}

async function stop(worker: Worker | undefined, signal: NodeJS.Signals) {
  if (!worker || worker.child.exitCode !== null || worker.child.signalCode !== null) return undefined;
  worker.child.kill(signal);
  const exit = await worker.exited;
  return { at: new Date().toISOString(), ...exit };
}

let first: Worker | undefined;
let second: Worker | undefined;
try {
  await xrpl.connect();
  const health = await signer.health();
  log(`signer up: buyer ${health.buyer}, seller ${SELLER}`);

  const created = await repo.createJob({
    ref: `restart-demo-${Date.now()}`,
    buyerAddress: health.buyer,
    sellerAddress: SELLER,
    amount: { asset: "XRP", drops: "1000000" },
    sourceText:
      "INVOICE INV-2026-1109\nFrom: Example Supplies Ltd\nTo: Surety Demo Buyer\n3 x Widget @ 10.00 EUR\nTotal: 30.00 EUR\nDue: 2026-12-01",
    criteria: {
      task: "Extract the invoice fields as JSON",
      fields: ["invoice_number", "supplier", "total", "currency", "due_date"],
      expected: { invoice_number: "INV-2026-1109", supplier: "Example Supplies Ltd", total: "30.00", currency: "EUR" },
    },
    policyVersion: "phase2-0",
    cancelAfterSeconds: 60,
  });
  const locked = await fundJob({ repo, signer, actor: "restart-demo" }, created.id);
  const escrow = await repo.getEscrow(locked.id);
  if (locked.state !== "LOCKED" || !escrow) throw new Error(`funding did not lock the job (state ${locked.state})`);
  log(`job ${locked.ref} LOCKED: sequence ${escrow.offerSequence}, cancel after ${rippleToIso(escrow.cancelAfter)}`);

  first = startWorker("worker-1");
  await sleep(RUN_WORKER_MS);
  const closeAtKill = await getValidatedCloseTime(xrpl);
  const killed = await stop(first, "SIGKILL");
  const stateAtKill = (await repo.getJob(locked.id))?.state;
  const killedBeforeExpiry = closeAtKill <= escrow.cancelAfter;
  log(
    `worker-1 killed (${killed?.signal ?? killed?.code}) at ledger ${rippleToIso(closeAtKill)}, ` +
      `${escrow.cancelAfter - closeAtKill}s before CancelAfter; job is ${stateAtKill}`,
  );

  for (;;) {
    const close = await getValidatedCloseTime(xrpl);
    if (close > escrow.cancelAfter) break;
    log(`no worker running; ledger time ${escrow.cancelAfter - close + 1}s short of CancelAfter`);
    await sleep(5_000);
  }
  const closeAtRestart = await getValidatedCloseTime(xrpl);

  second = startWorker("worker-2");
  const deadline = Date.now() + REFUND_TIMEOUT_MS;
  let finalState = (await repo.getJob(locked.id))?.state;
  while (finalState !== "REFUNDED" && Date.now() < deadline) {
    await sleep(2_000);
    finalState = (await repo.getJob(locked.id))?.state;
  }
  const refundObservedAt = new Date().toISOString();
  await sleep(1_000);
  const stopped = await stop(second, "SIGTERM");
  log(`job is ${finalState}; worker-2 stopped`);

  const events = await repo.listEvents(locked.id);
  const txs = await repo.listTransactions(locked.id);
  const createTx = txs.find((t) => t.type === "create");
  const cancelTx = txs.find((t) => t.type === "cancel");
  const confirm = async (hash: string | null | undefined) => {
    if (!hash) return null;
    const r = await getTxResult(xrpl, hash);
    return { txHash: hash, validated: r.validated, result: r.result, ledgerIndex: r.ledgerIndex, feeDrops: r.feeDrops, explorer: explorerTxUrl(hash) };
  };
  const escrowGone = (await getEscrow(xrpl, escrow.owner, escrow.offerSequence)) === null;
  const refundedEvent = events.find((e) => e.toState === "REFUNDED");
  const refundedByWorker2 =
    refundedEvent !== undefined &&
    refundedEvent.createdAt >= second.startedAt &&
    second.output.some((l) => l.includes(`refunded ${locked.ref}`));

  const evidence = {
    network: "XRPL Testnet",
    recordedAt: new Date().toISOString(),
    job: { id: locked.id, ref: locked.ref, snapshotHash: locked.snapshotHash, amount: locked.amount, finalState },
    escrow: {
      owner: escrow.owner,
      offerSequence: escrow.offerSequence,
      cancelAfter: escrow.cancelAfter,
      cancelAfterIso: rippleToIso(escrow.cancelAfter),
      onLedgerAfterRefund: !escrowGone,
    },
    create: await confirm(createTx?.txHash),
    cancel: await confirm(cancelTx?.txHash),
    worker1: {
      startedAt: first.startedAt,
      killedAt: killed?.at,
      killSignal: killed?.signal ?? null,
      ledgerCloseTimeAtKill: closeAtKill,
      ledgerCloseTimeAtKillIso: rippleToIso(closeAtKill),
      secondsBeforeCancelAfterAtKill: escrow.cancelAfter - closeAtKill,
      killedBeforeExpiry,
      jobStateAtKill: stateAtKill,
      output: first.output,
    },
    worker2: {
      startedAt: second.startedAt,
      ledgerCloseTimeAtStart: closeAtRestart,
      ledgerCloseTimeAtStartIso: rippleToIso(closeAtRestart),
      refundObservedAt,
      stoppedAt: stopped?.at,
      refundedByWorker2,
      output: second.output,
    },
    jobEvents: events,
    transactions: txs,
  };

  const dir = resolve(ROOT, "evidence");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `restart-refund-${evidence.recordedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  log(`evidence written: ${file}`);

  const ok =
    killedBeforeExpiry &&
    stateAtKill === "LOCKED" &&
    finalState === "REFUNDED" &&
    refundedByWorker2 &&
    evidence.cancel?.validated === true &&
    evidence.cancel.result === "tesSUCCESS" &&
    escrowGone;
  log(ok ? "PASS: refund validated tesSUCCESS by the restarted worker" : "FAIL: see evidence file");
  process.exitCode = ok ? 0 : 1;
} finally {
  await stop(first, "SIGKILL");
  await stop(second, "SIGKILL");
  await repo.close();
  await xrpl.disconnect();
}
