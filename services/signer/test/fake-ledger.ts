import { type SubmittableTransaction, decode } from "xrpl";
import { type EscrowEntry, type IssuedAmount, type TrustLine, type TxResult, preimageCondition } from "@surety/xrpl-settlement";
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
  holdNextSubmit = false;
  historyGap = false;
  onIndexRead: (() => void) | undefined;
  lookupRanges: ({ minLedger: number; maxLedger: number } | undefined)[] = [];
  nextResult: string | undefined;
  // Keyed `${account}:${issuer}`. Tests seed these; the fake does not move token balances.
  trustLines = new Map<string, TrustLine>();
  throwOnNextTrustLine = false;
  lockingAllowed = true;
  private held: { blob: string; hash: string } | undefined;
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
    const hook = this.onIndexRead;
    this.onIndexRead = undefined;
    hook?.();
    return this.ledgerIndex;
  }

  // A held transaction reached the network but has not validated yet; this validates it now.
  releaseHeld(): void {
    if (!this.held) throw new Error("nothing held");
    const { blob, hash } = this.held;
    this.held = undefined;
    const tx = decode(blob) as Decoded;
    this.submitted.push(tx);
    this.results.set(hash, { validated: true, result: this.apply(tx), ledgerIndex: ++this.ledgerIndex, feeDrops: String(tx.Fee) });
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
    if (this.holdNextSubmit) {
      // Sent, but the client timed out before validation.
      this.holdNextSubmit = false;
      this.held = { blob: txBlob, hash };
      throw new Error("timeout waiting for validation");
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

  async lookup(hash: string, range?: { minLedger: number; maxLedger: number }): Promise<TxResult> {
    this.lookups.push(hash);
    this.lookupRanges.push(range);
    return this.results.get(hash) ?? { validated: false, searchedAll: range ? !this.historyGap : undefined };
  }

  async trustLine(account: string, issuer: string, _currencyHex: string): Promise<TrustLine | null> {
    if (this.throwOnNextTrustLine) {
      this.throwOnNextTrustLine = false;
      throw new Error("websocket closed while fetching account_lines");
    }
    return this.trustLines.get(`${account}:${issuer}`) ?? null;
  }

  async issuerAllowsLocking(_issuer: string): Promise<boolean> {
    return this.lockingAllowed;
  }

  count(type: string): number {
    return this.submitted.filter((t) => t.TransactionType === type).length;
  }

  private apply(tx: Decoded): string {
    if (tx.TransactionType === "EscrowCreate") {
      this.escrows.set(`${tx.Account}:${tx.Sequence}`, {
        Account: tx.Account,
        Destination: String(tx.Destination),
        Amount: typeof tx.Amount === "string" ? tx.Amount : (tx.Amount as IssuedAmount),
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
