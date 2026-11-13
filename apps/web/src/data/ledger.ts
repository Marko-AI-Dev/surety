import { RECORDINGS } from "./evidence";
import type { LedgerTx, SourcingListItem, SourcingRecord } from "./types";

// The escrow ledger: every transaction Surety's signer put on the XRP Ledger, one row each, with the
// amount, the hash, the ledger it closed in, the fee and the result the ledger gave. Nothing here is
// worked out or estimated: a row exists only for a transaction the ledger validated.

export type LedgerKind = "lock" | "release" | "refund";

export interface LedgerRow {
  key: string;
  purchase: string;
  // Where the purchase came from: the live backend, or a recorded test-network run in evidence/.
  source: "live" | "recorded";
  kind: LedgerKind;
  // EscrowCreate, EscrowFinish or EscrowCancel: the ledger's own name for it.
  ledgerType: "EscrowCreate" | "EscrowFinish" | "EscrowCancel";
  cents: number | null;
  supplier: string | null;
  tx: LedgerTx;
}

const TYPE = { lock: "EscrowCreate", release: "EscrowFinish", refund: "EscrowCancel" } as const;

function rowsOf(purchase: string, source: LedgerRow["source"], cents: number | null, supplier: string | null, txs: { create?: LedgerTx | null; finish?: LedgerTx | null; cancel?: LedgerTx | null }): LedgerRow[] {
  const out: LedgerRow[] = [];
  const add = (kind: LedgerKind, tx: LedgerTx | null | undefined) => {
    if (tx) out.push({ key: `${purchase}:${kind}`, purchase, source, kind, ledgerType: TYPE[kind], cents, supplier, tx });
  };
  add("lock", txs.create);
  add("release", txs.finish);
  add("refund", txs.cancel);
  return out;
}

export const liveLedger = (list: SourcingListItem[]): LedgerRow[] => list.flatMap((p) => rowsOf(p.ref, "live", p.totalCents ?? null, p.supplier ?? null, p.ledger ?? {}));

const recordRows = (r: SourcingRecord): LedgerRow[] =>
  rowsOf(r.sourcing.ref, "recorded", r.job ? Number(r.job.amount.cents) : null, r.job ? (r.invites.find((i) => i.address === r.job?.seller)?.name ?? null) : null, { create: r.create, finish: r.finish, cancel: r.cancel });

// The recorded runs are real test-network purchases: their hashes open on the public explorer.
export const recordedLedger = (): LedgerRow[] => RECORDINGS.flatMap((r) => recordRows(r.record));

export function ledgerTotals(rows: LedgerRow[]) {
  const sum = (kind: LedgerKind) => rows.filter((r) => r.kind === kind).reduce((n, r) => n + (r.cents ?? 0), 0);
  return { locked: sum("lock"), released: sum("release"), refunded: sum("refund"), transactions: rows.length, feeDrops: rows.reduce((n, r) => n + Number(r.tx.feeDrops ?? 0), 0) };
}
