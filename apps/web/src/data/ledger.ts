import { RECORDINGS } from "./evidence";
import type { LedgerTx, SourcingListItem, SourcingRecord } from "./types";

// The escrow ledger: every transaction Surety's signer put on the XRP Ledger, grouped by the purchase
// it belongs to, with the amount, the hash, the ledger it closed in, the fee and the result the ledger
// gave. Nothing here is worked out or estimated: a row exists only for a transaction the ledger
// validated. A purchase locks its own amount once, so amounts are never added up across purchases as
// if they were held together.

export type LedgerKind = "lock" | "release" | "refund";

export interface LedgerRow {
  key: string;
  kind: LedgerKind;
  // EscrowCreate, EscrowFinish or EscrowCancel: the ledger's own name for it.
  ledgerType: "EscrowCreate" | "EscrowFinish" | "EscrowCancel";
  tx: LedgerTx;
}

export interface LedgerPurchase {
  ref: string;
  // What was bought, in a few words, and when, where the source says.
  about: string;
  when: string | null;
  cents: number | null;
  supplier: string | null;
  // Where the money is now.
  state: "in_escrow" | "paid" | "refunded";
  rows: LedgerRow[];
}

const TYPE = { lock: "EscrowCreate", release: "EscrowFinish", refund: "EscrowCancel" } as const;

function purchaseOf(ref: string, about: string, when: string | null, cents: number | null, supplier: string | null, txs: { create?: LedgerTx | null; finish?: LedgerTx | null; cancel?: LedgerTx | null }): LedgerPurchase | null {
  const rows: LedgerRow[] = [];
  const add = (kind: LedgerKind, tx: LedgerTx | null | undefined) => {
    if (tx) rows.push({ key: `${ref}:${kind}`, kind, ledgerType: TYPE[kind], tx });
  };
  add("lock", txs.create);
  add("release", txs.finish);
  add("refund", txs.cancel);
  if (rows.length === 0) return null;
  return { ref, about, when, cents, supplier, state: txs.finish ? "paid" : txs.cancel ? "refunded" : "in_escrow", rows };
}

const some = <T,>(x: T | null): x is T => x !== null;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const liveLedger = (list: SourcingListItem[]): LedgerPurchase[] =>
  list.map((p) => purchaseOf(p.ref, p.quantity !== undefined && p.goods ? `${p.quantity.toLocaleString("en-US")} x ${p.goods}` : "Purchase", p.createdAt ? day(p.createdAt) : null, p.totalCents ?? null, p.supplier ?? null, p.ledger ?? {})).filter(some);

const recorded = (r: SourcingRecord, when: string): LedgerPurchase | null =>
  purchaseOf(r.sourcing.ref, `${r.sourcing.brief.goods.quantity.toLocaleString("en-US")} x ${r.sourcing.brief.goods.description}`, when, r.job ? Number(r.job.amount.cents) : null, r.job ? (r.invites.find((i) => i.address === r.job?.seller)?.name ?? null) : null, {
    create: r.create,
    finish: r.finish,
    cancel: r.cancel,
  });

// The recorded runs are real test-network purchases: their hashes open on the public explorer.
export const recordedLedger = (): LedgerPurchase[] => RECORDINGS.map((r) => recorded(r.record, r.date)).filter(some);

export function ledgerTotals(purchases: LedgerPurchase[]) {
  const sum = (state: LedgerPurchase["state"]) => purchases.filter((p) => p.state === state).reduce((n, p) => n + (p.cents ?? 0), 0);
  const count = (state: LedgerPurchase["state"]) => purchases.filter((p) => p.state === state).length;
  const rows = purchases.flatMap((p) => p.rows);
  return {
    // Held on the ledger right now: locked and not yet released or refunded.
    inEscrowCents: sum("in_escrow"),
    inEscrow: count("in_escrow"),
    paidCents: sum("paid"),
    paid: count("paid"),
    refundedCents: sum("refunded"),
    refunded: count("refunded"),
    transactions: rows.length,
    feeDrops: rows.reduce((n, r) => n + Number(r.tx.feeDrops ?? 0), 0),
  };
}
