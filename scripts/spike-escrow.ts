// Testnet spike: through the isolated signer only, lock one escrow and pay it, lock another and
// refund it after expiry, and prove the signer refuses what it must refuse.
// This script plays the gate (it holds GATE_AUTH_SECRET) but never sees a key or a fulfillment.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "xrpl";
import { sha256Hex, signAuthorization } from "@surety/contracts";
import { SignerClientError, createSignerClient } from "@surety/signer-client";
import { explorerTxUrl, getEscrow, getTxResult, getValidatedCloseTime, rippleToIso } from "@surety/xrpl-settlement";

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run with --env-file=.env)`);
  return value;
}

const SELLER = need("SELLER_ADDRESS");
const GATE_SECRET = need("GATE_AUTH_SECRET");
const signer = createSignerClient({ url: need("SIGNER_URL"), hmacSecret: need("SIGNER_HMAC_SECRET") });
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

function authorizationFor(owner: string, offerSequence: number, job: string) {
  return signAuthorization(
    {
      network: "testnet",
      owner,
      offerSequence,
      amountDrops: "1000000",
      destination: SELLER,
      jobSnapshotHash: sha256Hex(`spike-job-${job}`),
      deliverableHash: sha256Hex(`spike-deliverable-${job}`),
      policyVersion: "spike-0",
      decisionId: `spike-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nonce: randomBytes(16).toString("hex"),
    },
    GATE_SECRET,
  );
}

await xrpl.connect();
const health = await signer.health();
log(`signer up: buyer ${health.buyer}, service ${health.service}, seller ${SELLER}`);
const refusals = [];

// Job A: lock, then pay on an authorized pass.
const sellerBefore = await xrpl.getXrpBalance(SELLER);
const createA = await signer.createEscrow({
  opId: randomUUID(),
  jobRef: "spike-A",
  destination: SELLER,
  amountDrops: "1000000",
  cancelAfterSeconds: 180,
});
const lockedA = (await getEscrow(xrpl, createA.owner, createA.offerSequence)) !== null;
log(`A locked: 1 XRP, sequence ${createA.offerSequence}, ${createA.txHash}`);

const authA = authorizationFor(createA.owner, createA.offerSequence, "A");
const finishA = await signer.finishEscrow({ opId: randomUUID(), authorization: authA });
const goneA = (await getEscrow(xrpl, createA.owner, createA.offerSequence)) === null;
const sellerAfter = await xrpl.getXrpBalance(SELLER);
log(`A paid: ${finishA.result}, fee ${finishA.feeDrops} drops, ${finishA.txHash}`);

refusals.push(
  await refusal("reuse of job A's authorization", "authorization_consumed", () =>
    signer.finishEscrow({ opId: randomUUID(), authorization: authA }),
  ),
  await refusal("escrow above the 2 XRP per-job cap", "amount_over_cap", () =>
    signer.createEscrow({ opId: randomUUID(), jobRef: "spike-cap", destination: SELLER, amountDrops: "5000000", cancelAfterSeconds: 180 }),
  ),
  await refusal("escrow to a destination not on the allowlist", "destination_not_allowed", () =>
    signer.createEscrow({ opId: randomUUID(), jobRef: "spike-dest", destination: health.service, amountDrops: "1000000", cancelAfterSeconds: 180 }),
  ),
);

// Job B: lock, no authorization ever issued, refund only after ledger time passes CancelAfter.
const createB = await signer.createEscrow({
  opId: randomUUID(),
  jobRef: "spike-B",
  destination: SELLER,
  amountDrops: "1000000",
  cancelAfterSeconds: 60,
});
log(`B locked: 1 XRP, sequence ${createB.offerSequence}, cancel after ${rippleToIso(createB.cancelAfter)}`);
refusals.push(
  await refusal("refund before expiry", "cancel_not_yet_eligible", () =>
    signer.cancelEscrow({ opId: randomUUID(), owner: createB.owner, offerSequence: createB.offerSequence }),
  ),
);

for (;;) {
  const close = await getValidatedCloseTime(xrpl);
  if (close > createB.cancelAfter) break;
  log(`waiting for ledger time: ${createB.cancelAfter - close + 1}s to go`);
  await sleep(5_000);
}
const cancelB = await signer.cancelEscrow({ opId: randomUUID(), owner: createB.owner, offerSequence: createB.offerSequence });
const goneB = (await getEscrow(xrpl, createB.owner, createB.offerSequence)) === null;
log(`B refunded: ${cancelB.result}, fee ${cancelB.feeDrops} drops, ${cancelB.txHash}`);

const confirm = async (hash: string) => {
  const r = await getTxResult(xrpl, hash);
  return { txHash: hash, validated: r.validated, result: r.result, ledgerIndex: r.ledgerIndex, feeDrops: r.feeDrops, explorer: explorerTxUrl(hash) };
};

const evidence = {
  network: "XRPL Testnet",
  recordedAt: new Date().toISOString(),
  accounts: { buyer: health.buyer, service: health.service, seller: SELLER },
  jobA_paid: {
    create: { ...(await confirm(createA.txHash)), offerSequence: createA.offerSequence, condition: createA.condition, cancelAfter: rippleToIso(createA.cancelAfter) },
    escrowOnLedgerAfterCreate: lockedA,
    finish: await confirm(finishA.txHash),
    escrowOnLedgerAfterFinish: !goneA,
    sellerBalanceXrp: { before: sellerBefore, after: sellerAfter },
  },
  jobB_refunded: {
    create: { ...(await confirm(createB.txHash)), offerSequence: createB.offerSequence, cancelAfter: rippleToIso(createB.cancelAfter) },
    cancel: await confirm(cancelB.txHash),
    escrowOnLedgerAfterCancel: !goneB,
  },
  refusals,
};
await xrpl.disconnect();

const dir = resolve(import.meta.dirname, "../evidence");
mkdirSync(dir, { recursive: true });
const file = resolve(dir, `spike-${evidence.recordedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
log(`evidence written: ${file}`);
