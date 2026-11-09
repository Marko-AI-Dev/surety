// Testnet evidence for Phase 4a, through the isolated signer only: lock TESTUSD and pay it, refuse
// what the policy forbids, change the policy live as the operator, and refund after the deadline.
// This script plays the gate (GATE_AUTH_SECRET) and the operator (OPERATOR_HMAC_SECRET from
// .env.operator). It never holds a wallet key or a fulfillment.
//
//   pnpm spike:testusd      (with the signer running: pnpm signer)
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "xrpl";
import { type HealthResponse, type PolicyView, sha256Hex } from "@surety/contracts";
import { mintAuthorization } from "@surety/gate";
import { SignerClientError, createOperatorClient, createSignerClient } from "@surety/signer-client";
import { TESTUSD_CURRENCY_HEX, explorerTxUrl, getTrustLine, getTxResult, getValidatedCloseTime } from "@surety/xrpl-settlement";

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run with --env-file=.env --env-file=.env.operator)`);
  return value;
}

const SIGNER_URL = need("SIGNER_URL");
const GATE_SECRET = need("GATE_AUTH_SECRET");
const signer = createSignerClient({ url: SIGNER_URL, hmacSecret: need("SIGNER_HMAC_SECRET") });
const operator = createOperatorClient({ url: SIGNER_URL, operatorSecret: need("OPERATOR_HMAC_SECRET") });
// The worker's credential pointed at the operator route: must be refused.
const workerAsOperator = createOperatorClient({ url: SIGNER_URL, operatorSecret: need("SIGNER_HMAC_SECRET") });
const xrpl = new Client(need("XRPL_WS_URL"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);

async function refusal(label: string, expected: string, attempt: () => Promise<unknown>) {
  try {
    await attempt();
  } catch (e) {
    if (e instanceof SignerClientError && e.code === expected) {
      log(`refused as expected: ${label} -> ${e.status} ${e.code}`);
      return { label, status: e.status, code: e.code, message: e.message };
    }
    throw e;
  }
  throw new Error(`expected ${label} to be refused with ${expected}, but it succeeded`);
}

await xrpl.connect();
const health = await signer.health();
const usd = health.testUsd;
if (!usd) throw new Error("the signer is not configured for TESTUSD: run the setup and restart it");
const issuer = usd.issuer;

const balanceOf = async (address: string) => (await getTrustLine(xrpl, address, issuer, TESTUSD_CURRENCY_HEX))?.balance ?? null;
const ready: string[] = [];
let notReady: string | undefined;
for (const s of usd.approvedSuppliers) {
  if (await getTrustLine(xrpl, s, issuer, TESTUSD_CURRENCY_HEX)) ready.push(s);
  else notReady ??= s;
}
const supplier = ready[0];
if (!supplier || !notReady) throw new Error("expected at least one ready and one not-ready approved supplier");
log(`signer up: treasury ${health.buyer}, issuer ${issuer}, policy v${usd.policyVersion}, supplier ${supplier}`);

const buildTime = { perDealCents: usd.limits.perDealCents, dailyCents: usd.limits.dailyCents, maxOpenDeals: usd.limits.openDeals };
const policyLog: PolicyView[] = [];
async function setPolicy(change: Partial<typeof buildTime>) {
  const current = (await signer.health()).testUsd as NonNullable<HealthResponse["testUsd"]>;
  const view = await operator.updatePolicy({
    opId: randomUUID(),
    expectedVersion: current.policyVersion,
    ...buildTime,
    ...change,
    approvedSuppliers: current.approvedSuppliers,
  });
  policyLog.push(view);
  log(`operator set policy v${view.version}: $${Number(view.perDealCents) / 100} per deal, $${Number(view.dailyCents) / 100} per 24h, ${view.maxOpenDeals} open`);
  return view;
}

const lock = (ref: string, cents: string, seconds: number, destination = supplier) =>
  signer.createEscrow({ opId: randomUUID(), jobRef: ref, destination, amountTestUsdCents: cents, cancelAfterSeconds: seconds });

const treasuryStart = await balanceOf(health.buyer);
const supplierBefore = await balanceOf(supplier);
const refusals = [];

// A: $1,000 locked, then paid against a gate authorization.
const a = await lock("testusd-A", "100000", 180);
log(`A locked: $1,000 TESTUSD, sequence ${a.offerSequence}, ${a.txHash}`);
const auth = mintAuthorization({
  owner: a.owner,
  offerSequence: a.offerSequence,
  amount: { asset: "TESTUSD", cents: "100000" },
  destination: supplier,
  jobSnapshotHash: sha256Hex("testusd-deal-A"),
  deliverableHash: sha256Hex("testusd-documents-A"),
  policyVersion: "spike-testusd-0",
  decisionId: `spike-${randomUUID()}`,
  gateSecret: GATE_SECRET,
  now: new Date(),
});
const paidA = await signer.finishEscrow({ opId: randomUUID(), authorization: auth });
const supplierAfter = await balanceOf(supplier);
log(`A paid: ${paidA.result}, supplier ${supplierBefore} -> ${supplierAfter} TESTUSD, ${paidA.txHash}`);

refusals.push(
  await refusal("$3,000 deal over the $2,500 per-deal cap", "amount_over_cap", () => lock("testusd-cap", "300000", 180)),
  await refusal("lock to the service account, not an approved supplier", "destination_not_allowed", () =>
    lock("testusd-dest", "100", 180, health.service),
  ),
  await refusal("lock to an approved supplier with no TESTUSD trust line", "destination_not_ready", () =>
    lock("testusd-ready", "100", 180, notReady),
  ),
  await refusal("policy update signed with the worker's secret", "unauthenticated", () =>
    workerAsOperator.updatePolicy({ opId: randomUUID(), expectedVersion: usd.policyVersion, ...buildTime, approvedSuppliers: usd.approvedSuppliers }),
  ),
);

// The operator cuts the 24-hour cap to $3,000: A ($1,000) + B ($1,500) fit, C ($1,000) does not.
await setPolicy({ dailyCents: "300000" });
const b = await lock("testusd-B", "150000", 60);
log(`B locked: $1,500, refunds after ${b.cancelAfter}`);
refusals.push(await refusal("C would take the last 24 hours past $3,000", "daily_cap_reached", () => lock("testusd-C", "100000", 60)));

// The operator cuts the per-deal cap to $500: the next lock is judged by it at once.
await setPolicy({ dailyCents: "300000", perDealCents: "50000" });
refusals.push(await refusal("D at $600 after the per-deal cap fell to $500", "amount_over_cap", () => lock("testusd-D", "60000", 60)));

// Back to the build-time policy. B plus four $1 deals fill the five open slots.
await setPolicy({});
const small = [];
for (const ref of ["E", "F", "G", "H"]) small.push(await lock(`testusd-${ref}`, "100", 60));
log(`E-H locked at $1 each; open deals: 5`);
refusals.push(await refusal("I with five deals already open", "open_deal_limit_reached", () => lock("testusd-I", "100", 60)));

// Refund B and E-H once validated ledger time passes their deadlines.
const toRefund = [b, ...small];
const deadline = Math.max(...toRefund.map((r) => r.cancelAfter));
for (;;) {
  const close = await getValidatedCloseTime(xrpl);
  if (close > deadline) break;
  log(`waiting for ledger time: ${deadline - close + 1}s to go`);
  await sleep(5_000);
}
const refunds: { offerSequence: number; txHash: string; result: string }[] = [];
for (const r of toRefund) refunds.push({ offerSequence: r.offerSequence, ...(await signer.cancelEscrow({ opId: randomUUID(), owner: r.owner, offerSequence: r.offerSequence })) });
log(`refunded ${refunds.length} deals: ${refunds.map((r) => r.result).join(", ")}`);

const treasuryEnd = await balanceOf(health.buyer);
const finalHealth = await signer.health();
const confirm = async (hash: string) => {
  const r = await getTxResult(xrpl, hash);
  return { txHash: hash, validated: r.validated, result: r.result, ledgerIndex: r.ledgerIndex, feeDrops: r.feeDrops, explorer: explorerTxUrl(hash) };
};

const expectedEnd = (Number(treasuryStart) - 1000).toString();
if (treasuryEnd !== expectedEnd) throw new Error(`treasury ended at ${treasuryEnd}, expected ${expectedEnd}`);
if ((Number(supplierAfter) - Number(supplierBefore)).toString() !== "1000") throw new Error("supplier did not receive exactly 1000 TESTUSD");

const evidence = {
  network: "XRPL Testnet",
  recordedAt: new Date().toISOString(),
  token: { code: "TESTUSD", currencyHex: TESTUSD_CURRENCY_HEX, issuer, note: "self-issued test dollar, no value" },
  accounts: { treasury: health.buyer, service: health.service, supplier, approvedButNotReady: notReady },
  policy: { start: { version: usd.policyVersion, ...buildTime }, changes: policyLog, end: finalHealth.testUsd },
  dealA_paid: {
    create: { ...(await confirm(a.txHash)), offerSequence: a.offerSequence, cancelAfter: a.cancelAfter },
    finish: await confirm(paidA.txHash),
    supplierBalanceTestUsd: { before: supplierBefore, after: supplierAfter },
  },
  refunded: await Promise.all(
    toRefund.map(async (r, i) => ({
      ref: ["B", "E", "F", "G", "H"][i],
      create: await confirm(r.txHash),
      cancel: await confirm(refunds[i]?.txHash ?? ""),
    })),
  ),
  refusals,
  treasuryBalanceTestUsd: { start: treasuryStart, end: treasuryEnd },
  rollingCapUsedUsd: 2504,
};
await xrpl.disconnect();

const dir = resolve(import.meta.dirname, "../evidence");
mkdirSync(dir, { recursive: true });
const file = resolve(dir, `testusd-signer-${evidence.recordedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
log(`evidence written: ${file}`);
