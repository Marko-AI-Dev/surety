import { type SubmittableTransaction, decode } from "xrpl";
import { type EscrowEntry, type TxResult, preimageCondition } from "@surety/xrpl-settlement";
import type { LedgerPort, SubmitResult } from "../src/ledger";

type Decoded = Record<string, unknown> & { TransactionType: string; Account: string; Sequence: number };

// In-memory ledger that applies the escrow rules Surety relies on:
// fulfillment must match the stored condition, and ledger close time (not laptop time) decides eligibility.
export class FakeLedger implements LedgerPort {
  ledgerIndex = 1000;
  escrows = new Map<string, EscrowEntry>();
  submitted: Decoded[] = [];
  lookups: string[] = [];
  throwOnNextSubmit = false;
  dropNextSubmit = false;
  throwOnNextAutofill = false;
  nextResult: string | undefined;
  private results = new Map<string, TxResult>();
  private sequences = new Map<string, number>();

  constructor(public closeTime = 800_000_000) {}

  async networkId(): Promise<number> {
    return 1;
  }

  async validatedCloseTime(): Promise<number> {
    return this.closeTime;
  }

  async validatedLedgerIndex(): Promise<number> {
    return this.ledgerIndex;
  }

  async getEscrow(owner: string, offerSequence: number): Promise<EscrowEntry | null> {
    return this.escrows.get(`${owner}:${offerSequence}`) ?? null;
  }

  async autofill<T extends SubmittableTransaction>(tx: T): Promise<T> {
    if (this.throwOnNextAutofill) {
      this.throwOnNextAutofill = false;
      throw new Error("websocket closed while fetching account_info");
    }
    const sequence = this.sequences.get(tx.Account) ?? 1;
    this.sequences.set(tx.Account, sequence + 1);
    return { ...tx, Sequence: sequence, Fee: "12", LastLedgerSequence: this.ledgerIndex + 20 };
  }

  async submitSigned(txBlob: string, hash: string): Promise<SubmitResult> {
    if (this.dropNextSubmit) {
      // Lost before reaching the network: nothing recorded, nothing applied.
      this.dropNextSubmit = false;
      throw new Error("ECONNRESET before send");
    }
    const tx = decode(txBlob) as Decoded;
    this.submitted.push(tx);
    const result = this.nextResult ?? this.apply(tx);
    this.nextResult = undefined;
    const outcome = { validated: true, result, ledgerIndex: ++this.ledgerIndex, feeDrops: String(tx.Fee) };
    this.results.set(hash, outcome);
    if (this.throwOnNextSubmit) {
      this.throwOnNextSubmit = false;
      throw new Error("socket hang up");
    }
    return outcome;
  }

  async lookup(hash: string): Promise<TxResult> {
    this.lookups.push(hash);
    return this.results.get(hash) ?? { validated: false };
  }

  count(type: string): number {
    return this.submitted.filter((t) => t.TransactionType === type).length;
  }

  private apply(tx: Decoded): string {
    if (tx.TransactionType === "EscrowCreate") {
      this.escrows.set(`${tx.Account}:${tx.Sequence}`, {
        Account: tx.Account,
        Destination: String(tx.Destination),
        Amount: String(tx.Amount),
        Condition: String(tx.Condition),
        CancelAfter: Number(tx.CancelAfter),
      });
      return "tesSUCCESS";
    }
    const key = `${String(tx.Owner)}:${Number(tx.OfferSequence)}`;
    const escrow = this.escrows.get(key);
    if (!escrow) return "tecNO_TARGET";
    const cancelAfter = escrow.CancelAfter ?? Number.MAX_SAFE_INTEGER;
    if (tx.TransactionType === "EscrowFinish") {
      if (this.closeTime > cancelAfter) return "tecNO_PERMISSION";
      const preimage = Buffer.from(String(tx.Fulfillment), "hex").subarray(4);
      if (preimageCondition(preimage).condition !== escrow.Condition) return "tecCRYPTOCONDITION_ERROR";
      this.escrows.delete(key);
      return "tesSUCCESS";
    }
    if (tx.TransactionType === "EscrowCancel") {
      if (this.closeTime <= cancelAfter) return "tecNO_PERMISSION";
      this.escrows.delete(key);
      return "tesSUCCESS";
    }
    return "temUNKNOWN";
  }
}
