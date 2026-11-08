import { Client, type SubmittableTransaction } from "xrpl";
import { type EscrowEntry, type TxResult, getEscrow, getTxResult, getValidatedCloseTime } from "@surety/xrpl-settlement";
import type { LedgerPort, SubmitResult } from "./ledger";

// LedgerPort backed by a real XRPL node. Fees are bounded at 0.01 XRP per transaction.
export class XrplLedger implements LedgerPort {
  readonly client: Client;

  constructor(url: string) {
    this.client = new Client(url, { maxFeeXRP: "0.01" });
  }

  async connect(): Promise<void> {
    if (!this.client.isConnected()) await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client.isConnected()) await this.client.disconnect();
  }

  async networkId(): Promise<number> {
    const r = await this.client.request({ command: "server_info" });
    return r.result.info.network_id ?? -1;
  }

  validatedCloseTime(): Promise<number> {
    return getValidatedCloseTime(this.client);
  }

  getEscrow(owner: string, offerSequence: number): Promise<EscrowEntry | null> {
    return getEscrow(this.client, owner, offerSequence);
  }

  autofill<T extends SubmittableTransaction>(tx: T): Promise<T> {
    return this.client.autofill(tx) as Promise<T>;
  }

  async submitSigned(txBlob: string, _hash: string): Promise<SubmitResult> {
    try {
      const r = await this.client.submitAndWait(txBlob);
      const meta = r.result.meta;
      return {
        validated: r.result.validated === true,
        result: typeof meta === "object" && meta ? meta.TransactionResult : "unknown",
        ledgerIndex: r.result.ledger_index ?? 0,
        feeDrops: r.result.tx_json.Fee ?? "0",
      };
    } catch (e) {
      // Past LastLedgerSequence without validation is conclusive: it can never be included.
      if (e instanceof Error && e.message.includes("LastLedgerSequence")) {
        return { validated: false, result: "expired_past_last_ledger_sequence", ledgerIndex: 0, feeDrops: "0" };
      }
      throw e;
    }
  }

  lookup(hash: string): Promise<TxResult> {
    return getTxResult(this.client, hash);
  }
}
