// The job engine: judges delivered work (rules, then Jev), pays approved work through the signer,
// and refunds every escrow that is past CancelAfter by validated ledger time. It keeps nothing in
// memory between passes, so a restart simply runs a pass again on boot. It holds no keys: finishes
// and cancellations go through the signer.
import { resolve } from "node:path";
import { Client } from "xrpl";
import { createSignerClient } from "@surety/signer-client";
import { createPgRepo, runEngineOnce } from "@surety/workflow";
import { loadWorkerConfig } from "./config";
import { buildEngine } from "./engine";
import { ledgerClock } from "./ledger-clock";
import { startSweepLoop } from "./loop";

const ROOT = resolve(import.meta.dirname, "../../..");
const log = (line: string) => console.log(`${new Date().toISOString()}  ${line}`);

const config = loadWorkerConfig(process.env);
const repo = createPgRepo(config.databaseUrl);
const signer = createSignerClient({ url: config.signerUrl, hmacSecret: config.hmacSecret });
const { engine, label } = buildEngine(config, ROOT);
// Read-only: the worker only asks the validated ledger what time it is.
const xrpl = new Client(config.wsUrl, { connectionTimeout: 15_000 });
const ledgerCloseTime = ledgerClock(xrpl);

log(`Surety worker | engine pass every ${config.intervalMs} ms | Jev mode: ${label}`);
const loop = startSweepLoop({
  intervalMs: config.intervalMs,
  log,
  sweep: () => runEngineOnce({ repo, signer, engine, gateSecret: config.gateSecret, ledgerCloseTime, log }),
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: finishing the current pass, then stopping`);
  await loop.stop();
  await xrpl.disconnect();
  await repo.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
