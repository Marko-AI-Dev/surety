// The Surety API service: the buyer's agents, the supplier agents and the UI reach sourcing,
// negotiation, selection and settlement only through here. It holds the signer's worker secret (like
// the worker) and never the operator secret, so it can lock and settle within the signer's limits but
// cannot change them. Run: pnpm api (needs .env, .env.api, the signer and Supabase).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "xrpl";
import { createJevEngine } from "@surety/gate";
import { createSignerClient } from "@surety/signer-client";
import { createPgRepo } from "@surety/workflow";
import { TESTUSD_CURRENCY_HEX, getTrustLine } from "@surety/xrpl-settlement";
import { loadApiConfig } from "./config";
import { createApiServer } from "./http";
import { createSupplierLine } from "./supplier-line";

const ROOT = resolve(import.meta.dirname, "../../..");
const log = (line: string) => console.log(`${new Date().toISOString()}  ${line}`);

const config = loadApiConfig(process.env);
const repo = createPgRepo(config.databaseUrl);
const signer = createSignerClient({ url: config.signerUrl, hmacSecret: config.signerHmacSecret });
const xrpl = new Client(config.wsUrl, { connectionTimeout: 20_000 });

const health = await signer.health();
if (!health.testUsd) throw new Error("the signer has TESTUSD off; start it with .env.testusd");
const issuer = health.testUsd.issuer;
const supplierLine = createSupplierLine(async (address) => {
  if (!xrpl.isConnected()) await xrpl.connect();
  return getTrustLine(xrpl, address, issuer, TESTUSD_CURRENCY_HEX);
});

const directoryPath = resolve(ROOT, config.directoryFile);
const names = new Map<string, string>(
  existsSync(directoryPath)
    ? (JSON.parse(readFileSync(directoryPath, "utf8")) as { address: string; name: string }[]).map((e) => [e.address, e.name])
    : [],
);

const server = createApiServer(
  { repo, signer, supplierLine, engine: createJevEngine({ apiKey: config.openRouterKey }), directory: (a) => names.get(a) ?? null },
  config,
  { log },
);
server.listen(config.port, config.host, () => {
  log(`Surety API on ${config.host}:${config.port} | ${names.size} suppliers in the directory | ${Object.keys(config.supplierTokens).length} supplier tokens`);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: stopping`);
  server.close();
  await repo.close();
  if (xrpl.isConnected()) await xrpl.disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
