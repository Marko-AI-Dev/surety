import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { usd } from "../data/format";
import { type LedgerRow, ledgerTotals, liveLedger, recordedLedger } from "../data/ledger";
import type { SourcingListItem } from "../data/types";

// The escrow ledger: every lock, release and refund that went onto the XRP Ledger, with the figures a
// ledger engineer checks: the transaction type, the full hash, the ledger it closed in, the fee in
// drops and the engine result. Each hash opens on the public test-network explorer.

const KIND: Record<LedgerRow["kind"], { label: string; tone: string }> = {
  lock: { label: "Locked", tone: "text-money" },
  release: { label: "Released to supplier", tone: "text-ok" },
  refund: { label: "Refunded to buyer", tone: "text-stop" },
};

function Table({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse text-left text-[0.8125rem]">
        <thead>
          <tr className="text-xs text-muted-foreground">
            {["Purchase", "What", "Ledger type", "Amount (TESTUSD)", "To", "Transaction hash", "Ledger", "Fee (drops)", "Result"].map((h) => (
              <th key={h} className="border-b border-solid px-2 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="align-baseline">
              <td className="mono border-b border-solid px-2 py-2 text-xs whitespace-nowrap">{r.purchase}</td>
              <td className={cn("border-b border-solid px-2 py-2 font-semibold whitespace-nowrap", KIND[r.kind].tone)}>{KIND[r.kind].label}</td>
              <td className="mono border-b border-solid px-2 py-2 text-xs">{r.ledgerType}</td>
              <td className="border-b border-solid px-2 py-2 font-semibold tabular-nums">{r.cents === null ? "" : usd(r.cents)}</td>
              <td className="border-b border-solid px-2 py-2">{r.kind === "refund" ? "Buyer's treasury" : r.kind === "lock" ? "Escrow on the ledger" : (r.supplier ?? "Supplier")}</td>
              <td className="border-b border-solid px-2 py-2">
                <a href={r.tx.explorer} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1.5 text-xs break-all text-primary">
                  {r.tx.txHash}
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                  <span className="sr-only">Opens the test-network explorer</span>
                </a>
              </td>
              <td className="mono border-b border-solid px-2 py-2 text-xs tabular-nums">{r.tx.ledgerIndex}</td>
              <td className="mono border-b border-solid px-2 py-2 text-xs tabular-nums">{r.tx.feeDrops ?? ""}</td>
              <td className={cn("mono border-b border-solid px-2 py-2 text-xs", r.tx.validated && r.tx.result === "tesSUCCESS" ? "text-ok" : "text-stop")}>{r.tx.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ rows }: { rows: LedgerRow[] }) {
  const t = ledgerTotals(rows);
  const tile = "flex min-w-36 flex-1 flex-col gap-0.5 rounded-xl border border-solid bg-background/60 px-3.5 py-2.5";
  return (
    <div className="flex flex-wrap gap-2.5">
      <div className={tile}>
        <span className="text-xs text-muted-foreground">Locked in escrow</span>
        <strong className="text-lg font-semibold text-money tabular-nums">{usd(t.locked)}</strong>
      </div>
      <div className={tile}>
        <span className="text-xs text-muted-foreground">Released to suppliers</span>
        <strong className="text-lg font-semibold text-ok tabular-nums">{usd(t.released)}</strong>
      </div>
      <div className={tile}>
        <span className="text-xs text-muted-foreground">Refunded to the buyer</span>
        <strong className="text-lg font-semibold text-stop tabular-nums">{usd(t.refunded)}</strong>
      </div>
      <div className={tile}>
        <span className="text-xs text-muted-foreground">Validated transactions</span>
        <strong className="text-lg font-semibold tabular-nums">{t.transactions}</strong>
      </div>
      <div className={tile}>
        <span className="text-xs text-muted-foreground">Total ledger fees</span>
        <strong className="text-lg font-semibold tabular-nums">{t.feeDrops.toLocaleString("en-US")} drops</strong>
        <span className="text-xs text-muted-foreground">{(t.feeDrops / 1_000_000).toFixed(6)} XRP</span>
      </div>
    </div>
  );
}

export function Ledger({ purchases, live }: { purchases: SourcingListItem[]; live: boolean }) {
  const now = live ? liveLedger(purchases) : [];
  const recorded = recordedLedger();
  return (
    <div className="tw flex flex-col gap-3.5 text-foreground">
      <header className="glass flex flex-col gap-1 rounded-xl px-4 py-3">
        <h1 className="m-0 text-lg font-semibold tracking-tight">Escrow ledger</h1>
        <p className="m-0 text-sm text-muted-foreground">
          Every lock, release and refund Surety's signer put on the XRP Ledger test network. A row exists only for a transaction the ledger validated. Each hash opens on the public explorer. Amounts are TESTUSD, a test dollar with no value.
        </p>
      </header>

      {live ? (
        <section className="glass flex flex-col gap-3 rounded-xl p-4" aria-label="This backend">
          <h2 className="m-0 text-base font-semibold">This backend</h2>
          {now.length > 0 ? (
            <>
              <Totals rows={now} />
              <Table rows={now} />
            </>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">No payment has been locked on this backend yet. A row appears here the moment a buyer says yes and the ledger validates the lock. The recorded runs below are real and can be checked now.</p>
          )}
        </section>
      ) : null}

      <section className="glass flex flex-col gap-3 rounded-xl p-4" aria-label="Recorded test-network runs">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-base font-semibold">Recorded test-network runs</h2>
          <p className="m-0 text-sm text-muted-foreground">Four purchases made by the agents on 9 and 10 Nov 2026, kept in the repo under evidence/. These transactions are on the public test network.</p>
        </div>
        <Totals rows={recorded} />
        <Table rows={recorded} />
      </section>
    </div>
  );
}
