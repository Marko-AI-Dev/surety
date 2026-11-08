import type { Transaction } from "xrpl";
import type { EscrowEntry, TxResult } from "@surety/xrpl-settlement";

export interface SubmitResult {
  validated: boolean;
  result: string;
  ledgerIndex: number;
  feeDrops: string;
}

// Everything the signer needs from the XRP Ledger. Reads are against the validated ledger.
export interface LedgerPort {
  networkId(): Promise<number>;
  validatedCloseTime(): Promise<number>;
  getEscrow(owner: string, offerSequence: number): Promise<EscrowEntry | null>;
  autofill<T extends Transaction>(tx: T): Promise<T>;
  submitSigned(txBlob: string, hash: string): Promise<SubmitResult>;
  lookup(hash: string): Promise<TxResult>;
}
