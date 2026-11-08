// The expiry worker: refunds every escrow that is past CancelAfter by validated ledger time.
// It keeps nothing in memory between sweeps, so a restart simply sweeps again on boot.
// It holds no keys: cancellations go through the signer.
import { Client } from "xrpl";
import { createSignerClient } from "@surety/signer-client";
import { createPgRepo, runExpirySweep } from "@surety/workflow";
import { loadWorkerConfig } from "./config";
import { ledgerClock } from "./ledger-clock";
import { startSweepLoop } from "./loop";

const log = (line: string) => console.log(`${new Date().toISOString()}  ${line}`);

const config = loadWorkerConfig(process.env);
const repo = createPgRepo(config.databaseUrl);
const signer = createSignerClient({ url: config.signerUrl, hmacSecret: config.hmacSecret });
// Read-only: the worker only asks the validated ledger what time it is.
const xrpl = new Client(config.wsUrl, { connectionTimeout: 15_000 });
const ledgerCloseTime = ledgerClock(xrpl);

log(`Surety expiry worker | sweep every ${config.intervalMs} ms`);
const loop = startSweepLoop({
  intervalMs: config.intervalMs,
  log,
  sweep: () => runExpirySweep({ repo, signer, ledgerCloseTime, log }),
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: finishing the current sweep, then stopping`);
  await loop.stop();
  await xrpl.disconnect();
  await repo.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
