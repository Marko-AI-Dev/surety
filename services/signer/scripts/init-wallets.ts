// One-time setup: funds buyer, service and seller wallets from the official XRPL Testnet faucet,
// writes the signer's secrets to services/signer/.env and the shared, non-key settings to the root .env.
// Prints addresses only. The seller seed is discarded: the seller only needs to receive.
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "xrpl";

const TESTNET_WS = "wss://s.altnet.rippletest.net:51233/";
const signerEnvPath = resolve(import.meta.dirname, "../.env");
const rootEnvPath = resolve(import.meta.dirname, "../../../.env");

if (existsSync(signerEnvPath) || existsSync(rootEnvPath)) {
  console.error("Refusing to overwrite an existing .env. Remove it deliberately if you want fresh wallets.");
  process.exit(1);
}

const client = new Client(TESTNET_WS);
await client.connect();
const info = await client.request({ command: "server_info" });
if (info.result.info.network_id !== 1) {
  console.error(`Refusing: network id ${info.result.info.network_id} is not XRPL Testnet.`);
  process.exit(1);
}

const buyer = await client.fundWallet();
const service = await client.fundWallet();
const seller = await client.fundWallet();
await client.disconnect();

const hmacSecret = randomBytes(32).toString("hex");
const gateSecret = randomBytes(32).toString("hex");

writeFileSync(
  signerEnvPath,
  [
    "# Surety signer secrets. TESTNET ONLY. Never commit, never copy elsewhere.",
    `BUYER_SEED=${buyer.wallet.seed}`,
    `SERVICE_SEED=${service.wallet.seed}`,
    `PREIMAGE_KEY=${randomBytes(32).toString("hex")}`,
    `SIGNER_HMAC_SECRET=${hmacSecret}`,
    `GATE_AUTH_SECRET=${gateSecret}`,
    `DESTINATION_ALLOWLIST=${seller.wallet.classicAddress}`,
    `XRPL_WS_URL=${TESTNET_WS}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

writeFileSync(
  rootEnvPath,
  [
    "SIGNER_URL=http://127.0.0.1:4100",
    `SIGNER_HMAC_SECRET=${hmacSecret}`,
    `GATE_AUTH_SECRET=${gateSecret}`,
    `SELLER_ADDRESS=${seller.wallet.classicAddress}`,
    `XRPL_WS_URL=${TESTNET_WS}`,
    "OPENROUTER_API_KEY=",
    "",
  ].join("\n"),
  { mode: 0o600 },
);

console.log("Funded on XRPL Testnet:");
console.log(`  buyer   ${buyer.wallet.classicAddress}  ${buyer.balance} XRP`);
console.log(`  service ${service.wallet.classicAddress}  ${service.balance} XRP`);
console.log(`  seller  ${seller.wallet.classicAddress}  ${seller.balance} XRP`);
console.log("Wrote services/signer/.env (secrets) and .env (shared settings).");
