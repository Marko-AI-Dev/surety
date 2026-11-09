// Testnet trial for the import-purchase pivot: can an importer pay an overseas supplier in a test
// dollar (TESTUSD) through XRPL token escrow, with the same release key and deadline rules as XRP?
//   Deal 1, documents match: 48,000 TESTUSD locked; a wrong release key and an early refund are both
//     refused by the ledger; the right key pays the supplier the exact amount.
//   Deal 2, documents tampered: 12,500 TESTUSD locked; no release key is issued; after the deadline the
//     right key is refused too, and the importer is refunded in full.
// Throwaway faucet wallets held in memory only: no seed is printed or written, and the signer
// service is not touched. Lives under services/signer because it handles keys.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AccountSetAsfFlags, Client, type SubmittableTransaction, type TransactionMetadata, type Wallet } from "xrpl";
import {
  cancelAfterFrom,
  explorerTxUrl,
  getValidatedCloseTime,
  newPreimage,
  preimageCondition,
  rippleToIso,
} from "@surety/xrpl-settlement";

const TESTNET_WS = "wss://s.altnet.rippletest.net:51233/";
// "TESTUSD" as a 160-bit currency code; explorers display it as TESTUSD. Not "tUSD": TUSD is the ticker of TrueUSD.
const TESTUSD = Buffer.from("TESTUSD", "ascii").toString("hex").toUpperCase().padEnd(40, "0");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);

interface Step {
  label: string;
  submittedBy: string;
  result: string;
  txHash?: string;
  ledgerIndex?: number;
  explorer?: string;
  error?: string;
}

const client = new Client(TESTNET_WS);
await client.connect();
const info = await client.request({ command: "server_info" });
if (info.result.info.network_id !== 1) {
  console.error(`Refusing: network id ${info.result.info.network_id} is not XRPL Testnet.`);
  process.exit(1);
}

async function submit(label: string, wallet: Wallet, tx: SubmittableTransaction): Promise<Step & { sequence?: number }> {
  try {
    const r = await client.submitAndWait(tx, { wallet, autofill: true });
    const meta = r.result.meta as TransactionMetadata | undefined;
    const result = meta && typeof meta === "object" ? String(meta.TransactionResult) : "unknown";
    const sequence = (r.result.tx_json as { Sequence?: number }).Sequence;
    log(`${label}: ${result}  ${r.result.hash}`);
    return {
      label,
      submittedBy: wallet.address,
      result,
      txHash: r.result.hash,
      ledgerIndex: r.result.ledger_index,
      explorer: explorerTxUrl(r.result.hash),
      sequence,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message.split("\n")[0] : String(e);
    log(`${label}: not applied (${error})`);
    return { label, submittedBy: wallet.address, result: "not_applied", error };
  }
}

function must(step: Step, expected: string): void {
  if (step.result !== expected) throw new Error(`${step.label}: expected ${expected}, got ${step.result}`);
}

async function testUsd(address: string, issuer: string): Promise<string> {
  const r = await client.request({ command: "account_lines", account: address, peer: issuer, ledger_index: "validated" });
  const line = r.result.lines.find((l) => l.currency === TESTUSD);
  return line ? line.balance : "no trust line";
}

async function escrowOnLedger(owner: string, seq: number): Promise<Record<string, unknown> | null> {
  try {
    const r = await client.request({ command: "ledger_entry", escrow: { owner, seq }, ledger_index: "validated" });
    return r.result.node as unknown as Record<string, unknown>;
  } catch (e) {
    if ((e as { data?: { error?: string } })?.data?.error === "entryNotFound") return null;
    throw e;
  }
}

async function waitPast(cancelAfter: number): Promise<void> {
  for (;;) {
    const close = await getValidatedCloseTime(client);
    if (close > cancelAfter) return;
    log(`waiting for ledger time to pass the deadline: ${cancelAfter - close + 1}s to go`);
    await sleep(5_000);
  }
}

const amount = (issuer: string, value: string) => ({ currency: TESTUSD, issuer, value });

// Setup: a TESTUSD issuer, an importer (buyer), a supplier (seller) and the service account that submits releases and refunds.
log("funding four throwaway testnet wallets from the faucet");
const { wallet: issuer } = await client.fundWallet();
const { wallet: buyer } = await client.fundWallet();
const { wallet: seller } = await client.fundWallet();
const { wallet: service } = await client.fundWallet();
log(`issuer ${issuer.address}, buyer ${buyer.address}, seller ${seller.address}, service ${service.address}`);

const setup: Step[] = [];
setup.push(await submit("issuer enables rippling", issuer, { TransactionType: "AccountSet", Account: issuer.address, SetFlag: AccountSetAsfFlags.asfDefaultRipple }));
setup.push(await submit("issuer allows its token to be escrowed", issuer, { TransactionType: "AccountSet", Account: issuer.address, SetFlag: AccountSetAsfFlags.asfAllowTrustLineLocking }));
setup.push(await submit("buyer trusts TESTUSD", buyer, { TransactionType: "TrustSet", Account: buyer.address, LimitAmount: amount(issuer.address, "1000000") }));
setup.push(await submit("seller trusts TESTUSD", seller, { TransactionType: "TrustSet", Account: seller.address, LimitAmount: amount(issuer.address, "1000000") }));
setup.push(await submit("issuer issues 100,000 TESTUSD to the buyer", issuer, { TransactionType: "Payment", Account: issuer.address, Destination: buyer.address, Amount: amount(issuer.address, "100000") }));
for (const s of setup) must(s, "tesSUCCESS");

const balances = async () => ({ buyer: await testUsd(buyer.address, issuer.address), seller: await testUsd(seller.address, issuer.address) });
const start = await balances();
log(`start: buyer ${start.buyer} TESTUSD, seller ${start.seller} TESTUSD`);

// Deal 1: documents match.
const key1 = preimageCondition(newPreimage());
const wrongKey = preimageCondition(newPreimage());
const deadline1 = cancelAfterFrom(await getValidatedCloseTime(client), 300);
const create1 = await submit("deal 1: lock 48,000 TESTUSD for the supplier", buyer, {
  TransactionType: "EscrowCreate",
  Account: buyer.address,
  Destination: seller.address,
  Amount: amount(issuer.address, "48000"),
  Condition: key1.condition,
  CancelAfter: deadline1,
});
must(create1, "tesSUCCESS");
const seq1 = create1.sequence!;
const locked1 = await escrowOnLedger(buyer.address, seq1);
const afterLock1 = await balances();
log(`deal 1 locked on ledger: ${JSON.stringify(locked1?.Amount)}; buyer now ${afterLock1.buyer}`);

const wrongKeyAttempt = await submit("deal 1: release with a wrong key", service, {
  TransactionType: "EscrowFinish",
  Account: service.address,
  Owner: buyer.address,
  OfferSequence: seq1,
  Condition: key1.condition,
  Fulfillment: wrongKey.fulfillment,
});
const earlyRefundAttempt = await submit("deal 1: refund before the deadline", service, {
  TransactionType: "EscrowCancel",
  Account: service.address,
  Owner: buyer.address,
  OfferSequence: seq1,
});
const finish1 = await submit("deal 1: release with the right key", service, {
  TransactionType: "EscrowFinish",
  Account: service.address,
  Owner: buyer.address,
  OfferSequence: seq1,
  Condition: key1.condition,
  Fulfillment: key1.fulfillment,
});
must(finish1, "tesSUCCESS");
const afterPay1 = await balances();
const gone1 = (await escrowOnLedger(buyer.address, seq1)) === null;
log(`deal 1 paid: seller ${afterPay1.seller} TESTUSD, escrow removed from ledger: ${gone1}`);

// Deal 2: documents tampered, so no release key is ever issued.
const key2 = preimageCondition(newPreimage());
const deadline2 = cancelAfterFrom(await getValidatedCloseTime(client), 60);
const create2 = await submit("deal 2: lock 12,500 TESTUSD for the supplier", buyer, {
  TransactionType: "EscrowCreate",
  Account: buyer.address,
  Destination: seller.address,
  Amount: amount(issuer.address, "12500"),
  Condition: key2.condition,
  CancelAfter: deadline2,
});
must(create2, "tesSUCCESS");
const seq2 = create2.sequence!;
const afterLock2 = await balances();
log(`deal 2 locked; deadline ${rippleToIso(deadline2)}; buyer now ${afterLock2.buyer}`);
await waitPast(deadline2);

const lateReleaseAttempt = await submit("deal 2: release with the right key after the deadline", service, {
  TransactionType: "EscrowFinish",
  Account: service.address,
  Owner: buyer.address,
  OfferSequence: seq2,
  Condition: key2.condition,
  Fulfillment: key2.fulfillment,
});
const cancel2 = await submit("deal 2: refund after the deadline", service, {
  TransactionType: "EscrowCancel",
  Account: service.address,
  Owner: buyer.address,
  OfferSequence: seq2,
});
must(cancel2, "tesSUCCESS");
const end = await balances();
const gone2 = (await escrowOnLedger(buyer.address, seq2)) === null;
log(`deal 2 refunded: buyer ${end.buyer} TESTUSD, seller ${end.seller} TESTUSD, escrow removed: ${gone2}`);
await client.disconnect();

const evidence = {
  network: "XRPL Testnet",
  recordedAt: new Date().toISOString(),
  token: { code: "TESTUSD", currencyHex: TESTUSD, issuer: issuer.address, note: "self-issued test dollar, no value" },
  accounts: { issuer: issuer.address, buyer: buyer.address, seller: seller.address, service: service.address },
  setup,
  balancesTestUsd: { start, afterLock1, afterPay1, afterLock2, end },
  deal1_documentsMatch: {
    create: { ...create1, offerSequence: seq1, condition: key1.condition, deadline: rippleToIso(deadline1) },
    escrowOnLedgerAfterLock: locked1,
    refusedByLedger: { wrongKeyAttempt, earlyRefundAttempt },
    release: finish1,
    escrowRemovedAfterRelease: gone1,
  },
  deal2_documentsTampered: {
    create: { ...create2, offerSequence: seq2, deadline: rippleToIso(deadline2) },
    refusedByLedger: { lateReleaseAttempt },
    refund: cancel2,
    escrowRemovedAfterRefund: gone2,
  },
};
const dir = resolve(import.meta.dirname, "../../../evidence");
mkdirSync(dir, { recursive: true });
const file = resolve(dir, `token-escrow-trial-testusd-${evidence.recordedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
log(`evidence written: ${file}`);
