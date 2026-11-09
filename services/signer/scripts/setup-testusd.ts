// One-time TESTUSD setup on XRPL Testnet (run from services/signer: pnpm setup-testusd).
//   1. Creates the TESTUSD issuer and lets holders escrow its token (DefaultRipple + AllowTrustLineLocking).
//   2. Opens the treasury's (buyer's) TESTUSD trust line and issues it 10,000,000 TESTUSD.
//   3. Creates three demo suppliers with TESTUSD trust lines, and one approved supplier without one
//      (the "has not opted in yet" case). Supplier keys are discarded: suppliers only receive.
//   4. Writes services/signer/.env.testusd (signer settings and the operator secret),
//      services/signer/.env.issuer (issuer key, never loaded by the signer) and the root
//      .env.operator (operator secret for operator tools). Refuses to overwrite any of them.
// Prints addresses, results and explorer links only. Never prints a key.
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AccountSetAsfFlags, Client, type SubmittableTransaction, type TransactionMetadata, Wallet } from "xrpl";
import { TESTUSD_CURRENCY_HEX, explorerTxUrl } from "@surety/xrpl-settlement";
import { renderIssuerEnv, renderOperatorEnv, renderTestUsdEnv } from "./testusd-env";

const TESTNET_WS = "wss://s.altnet.rippletest.net:51233/";
const TREASURY_ISSUE = "10000000";
const LINE_LIMIT = "1000000000";
const testUsdEnvPath = resolve(import.meta.dirname, "../.env.testusd");
const issuerEnvPath = resolve(import.meta.dirname, "../.env.issuer");
const operatorEnvPath = resolve(import.meta.dirname, "../../../.env.operator");

for (const path of [testUsdEnvPath, issuerEnvPath, operatorEnvPath]) {
  if (existsSync(path)) {
    console.error(`Refusing: ${path} already exists. Remove it deliberately if you want a fresh TESTUSD setup.`);
    process.exit(1);
  }
}
const buyerSeed = process.env.BUYER_SEED;
if (!buyerSeed) {
  console.error("Refusing: the treasury key is not set (run from services/signer with its .env).");
  process.exit(1);
}

const client = new Client(TESTNET_WS);
await client.connect();
const info = await client.request({ command: "server_info" });
if (info.result.info.network_id !== 1) {
  console.error(`Refusing: network id ${info.result.info.network_id} is not XRPL Testnet.`);
  await client.disconnect();
  process.exit(1);
}

const treasury = Wallet.fromSeed(buyerSeed);
const amount = (issuer: string, value: string) => ({ currency: TESTUSD_CURRENCY_HEX, issuer, value });

async function submit(label: string, wallet: Wallet, tx: SubmittableTransaction): Promise<void> {
  const r = await client.submitAndWait(tx, { wallet, autofill: true });
  const meta = r.result.meta as TransactionMetadata | undefined;
  const result = meta && typeof meta === "object" ? String(meta.TransactionResult) : "unknown";
  console.log(`${label}: ${result}  ${explorerTxUrl(r.result.hash)}`);
  if (result !== "tesSUCCESS") throw new Error(`${label} failed with ${result}`);
}

console.log("Funding the TESTUSD issuer from the testnet faucet");
const { wallet: issuer } = await client.fundWallet();
await submit("issuer enables rippling", issuer, { TransactionType: "AccountSet", Account: issuer.address, SetFlag: AccountSetAsfFlags.asfDefaultRipple });
await submit("issuer allows TESTUSD escrow", issuer, {
  TransactionType: "AccountSet",
  Account: issuer.address,
  SetFlag: AccountSetAsfFlags.asfAllowTrustLineLocking,
});
await submit("treasury trusts TESTUSD", treasury, {
  TransactionType: "TrustSet",
  Account: treasury.address,
  LimitAmount: amount(issuer.address, LINE_LIMIT),
});
await submit(`issuer issues ${Number(TREASURY_ISSUE).toLocaleString("en-US")} TESTUSD to the treasury`, issuer, {
  TransactionType: "Payment",
  Account: issuer.address,
  Destination: treasury.address,
  Amount: amount(issuer.address, TREASURY_ISSUE),
});

const ready: string[] = [];
for (let i = 1; i <= 3; i++) {
  const { wallet: supplier } = await client.fundWallet();
  await submit(`demo supplier ${i} trusts TESTUSD`, supplier, {
    TransactionType: "TrustSet",
    Account: supplier.address,
    LimitAmount: amount(issuer.address, LINE_LIMIT),
  });
  ready.push(supplier.address);
}
const { wallet: notReady } = await client.fundWallet();
await client.disconnect();

const operatorSecret = randomBytes(32).toString("hex");
const approvedSuppliers = [...ready, notReady.address];
writeFileSync(testUsdEnvPath, renderTestUsdEnv({ issuer: issuer.address, approvedSuppliers, operatorSecret }), { mode: 0o600 });
writeFileSync(issuerEnvPath, renderIssuerEnv(issuer.seed as string), { mode: 0o600 });
writeFileSync(operatorEnvPath, renderOperatorEnv(operatorSecret), { mode: 0o600 });

console.log("");
console.log(`TESTUSD issuer        ${issuer.address}`);
console.log(`treasury              ${treasury.address}  (holds ${TREASURY_ISSUE} TESTUSD)`);
ready.forEach((a, i) => console.log(`demo supplier ${i + 1}       ${a}  (ready)`));
console.log(`approved, not ready   ${notReady.address}  (no TESTUSD trust line)`);
console.log("Wrote services/signer/.env.testusd, services/signer/.env.issuer and .env.operator. Restart the signer to load them.");
