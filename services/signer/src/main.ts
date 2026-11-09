import { Wallet } from "xrpl";
import { loadConfig } from "./config";
import { bootLine } from "./boot-line";
import { createHttpServer } from "./http";
import { createSigner } from "./signer";
import { XrplLedger } from "./xrpl-ledger";

const TESTNET_NETWORK_ID = 1;

const { config, seeds } = loadConfig(process.env);
const ledger = new XrplLedger(config.wsUrl);
await ledger.connect();

const networkId = await ledger.networkId();
if (networkId !== TESTNET_NETWORK_ID) {
  console.error(`Refusing to start: network id ${networkId} is not XRPL Testnet (${TESTNET_NETWORK_ID}).`);
  await ledger.disconnect();
  process.exit(1);
}

if (config.testUsd && !(await ledger.issuerAllowsLocking(config.testUsd.issuer))) {
  console.error("Refusing to start: the TESTUSD issuer does not allow trust-line locking.");
  await ledger.disconnect();
  process.exit(1);
}

const buyer = Wallet.fromSeed(seeds.buyer);
const service = Wallet.fromSeed(seeds.service);
const signer = createSigner({ config, ledger, buyer, service });
const server = createHttpServer(signer, config, { log: (line) => console.log(line) });

const startHealth = await signer.health();
server.listen(config.port, "127.0.0.1", () => {
  console.log(bootLine(config.port, startHealth));
});

async function shutdown() {
  server.close();
  await ledger.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

