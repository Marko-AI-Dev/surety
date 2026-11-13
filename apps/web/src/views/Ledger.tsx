import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { usd } from "../data/format";
import { type LedgerPurchase, type LedgerRow, ledgerTotals, liveLedger, recordedLedger } from "../data/ledger";
import type { SourcingListItem } from "../data/types";

// The escrow ledger: every purchase that put money on the XRP Ledger, one card each, saying in plain
// words where its money went, and under it the transactions with the figures a ledger engineer
// checks: the type, the full hash, the ledger it closed in, the fee in drops and the engine result.
// Each purchase locks only its own amount, so nothing here is added up as if it were held at once.

const KIND: Record<LedgerRow["kind"], { label: string; tone: string }> = {
  lock: { label: "Locked", tone: "text-money" },
  release: { label: "Released to the supplier", tone: "text-ok" },
  refund: { label: "Refunded to the buyer", tone: "text-stop" },
};

function story(p: LedgerPurchase): { text: string; tone: string } {
  const amount = p.cents === null ? "The payment" : usd(p.cents);
  if (p.state === "paid") return { text: `${amount} was locked, both checks passed, and it was released to ${p.supplier ?? "the supplier"}.`, tone: "text-ok" };
  if (p.state === "refunded") return { text: `${amount} was locked, a check did not pass, and all of it went back to the buyer. ${p.supplier ?? "The supplier"} was not paid.`, tone: "text-stop" };
  return { text: `${amount} is locked on the ledger for ${p.supplier ?? "the supplier"}, waiting for the paperwork and the inspector.`, tone: "text-money" };
}

function Purchase({ p }: { p: LedgerPurchase }) {
  const s = story(p);
  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-solid bg-background/60 p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <strong className="text-[0.95rem] font-semibold">{p.about}</strong>
        <span className="mono text-xs text-muted-foreground">{p.ref}</span>
        {p.when ? <span className="text-xs text-muted-foreground">{p.when}</span> : null}
        <span className="flex-1" />
        {p.cents !== null ? <strong className="text-base font-semibold tabular-nums">{usd(p.cents)}</strong> : null}
      </div>
      <p className={cn("m-0 text-sm font-medium", s.tone)}>{s.text}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left text-[0.8125rem]">
          <thead>
            <tr className="text-xs text-muted-foreground">
              {["Step", "Ledger type", "Transaction hash", "Ledger", "Fee (drops)", "Result"].map((h) => (
                <th key={h} className="border-b border-solid px-2 py-1.5 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.key} className="align-baseline">
                <td className={cn("border-b border-solid px-2 py-1.5 font-semibold whitespace-nowrap", KIND[r.kind].tone)}>{KIND[r.kind].label}</td>
                <td className="mono border-b border-solid px-2 py-1.5 text-xs">{r.ledgerType}</td>
                <td className="border-b border-solid px-2 py-1.5">
                  <a href={r.tx.explorer} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1.5 text-xs break-all text-primary">
                    {r.tx.txHash}
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    <span className="sr-only">Opens the test-network explorer</span>
                  </a>
                </td>
                <td className="mono border-b border-solid px-2 py-1.5 text-xs tabular-nums">{r.tx.ledgerIndex}</td>
                <td className="mono border-b border-solid px-2 py-1.5 text-xs tabular-nums">{r.tx.feeDrops ?? ""}</td>
                <td className={cn("mono border-b border-solid px-2 py-1.5 text-xs", r.tx.validated && r.tx.result === "tesSUCCESS" ? "text-ok" : "text-stop")}>{r.tx.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </li>
  );
}

function Totals({ purchases }: { purchases: LedgerPurchase[] }) {
  const t = ledgerTotals(purchases);
  const tile = "flex min-w-40 flex-1 flex-col gap-0.5 rounded-xl border border-solid bg-background/60 px-3.5 py-2.5";
  const n = (count: number) => `${count} ${count === 1 ? "purchase" : "purchases"}`;
  return (
    <div className="flex flex-wrap gap-2.5">
      <div className={cn(tile, t.inEscrow > 0 && "border-money/50")}>
        <span className="text-xs text-muted-foreground">Held in escrow right now</span>
        <strong className="text-lg font-semibold text-money tabular-nums">{usd(t.inEscrowCents)}</strong>
        <span className="text-xs text-muted-foreground">{t.inEscrow === 0 ? "Nothing is locked" : n(t.inEscrow)}</span>
      </div>
      <div className={tile}>
        <span className="text-xs text-muted-foreground">Paid to suppliers</span>
        <strong className="text-lg font-semibold text-ok tabular-nums">{usd(t.paidCents)}</strong>
        <span className="text-xs text-muted-foreground">{n(t.paid)}, each paid once</span>
      </div>
      <div className={tile}>
        <span className="text-xs text-muted-foreground">Returned to the buyer</span>
        <strong className="text-lg font-semibold text-stop tabular-nums">{usd(t.refundedCents)}</strong>
        <span className="text-xs text-muted-foreground">{n(t.refunded)}, refunded in full</span>
      </div>
      <div className={tile}>
        <span className="text-xs text-muted-foreground">Ledger transactions</span>
        <strong className="text-lg font-semibold tabular-nums">{t.transactions}</strong>
        <span className="text-xs text-muted-foreground">
          {t.feeDrops.toLocaleString("en-US")} drops in fees ({(t.feeDrops / 1_000_000).toFixed(6)} XRP)
        </span>
      </div>
    </div>
  );
}

export function Ledger({ purchases, live }: { purchases: SourcingListItem[]; live: boolean }) {
  const now = live ? liveLedger(purchases) : [];
  const recorded = recordedLedger();
  return (
    <div className="tw flex flex-col gap-3.5 text-foreground">
      <header className="glass flex flex-col gap-2 rounded-xl px-4 py-3">
        <h1 className="m-0 text-lg font-semibold tracking-tight">Escrow ledger</h1>
        <p className="m-0 text-sm text-muted-foreground">Every purchase that put money on the XRP Ledger test network, and each transaction behind it. A transaction is listed only once the ledger validated it, and each hash opens on the public explorer. Amounts are TESTUSD, a test dollar with no value.</p>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            <strong className="font-semibold">A purchase locks only its own amount.</strong> A $46,400 purchase needs $46,400, not more. Nothing is locked while the agents negotiate.
          </li>
          <li>
            <strong className="font-semibold">Only one supplier is ever locked for.</strong> The one the buyer said yes to. The other quotes cost nothing.
          </li>
          <li>
            <strong className="font-semibold">The money always ends in one of two places.</strong> Paid to the supplier, or back with the buyer in full. The purchases below are separate, on different days; they were never held at the same time.
          </li>
        </ul>
        <p className="m-0 text-sm">
          <a href="#/admin/how" className="font-medium text-primary">
            How Surety works
          </a>
        </p>
      </header>

      {live ? (
        <section className="glass flex flex-col gap-3 rounded-xl p-4" aria-label="This backend">
          <h2 className="m-0 text-base font-semibold">This backend</h2>
          {now.length > 0 ? (
            <>
              <Totals purchases={now} />
              <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                {now.map((p) => (
                  <Purchase key={p.ref} p={p} />
                ))}
              </ol>
            </>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">No payment has been locked on this backend yet. A purchase appears here the moment a buyer says yes and the ledger validates the lock. The recorded purchases below are real and can be checked now.</p>
          )}
        </section>
      ) : null}

      <section className="glass flex flex-col gap-3 rounded-xl p-4" aria-label="Recorded test-network purchases">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-base font-semibold">Recorded test-network purchases</h2>
          <p className="m-0 text-sm text-muted-foreground">Four separate purchases made by the agents on 9 and 10 Nov 2026, kept in the repo under evidence/. Two were paid and two were refunded. Their transactions are on the public test network.</p>
        </div>
        <Totals purchases={recorded} />
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {recorded.map((p) => (
            <Purchase key={p.ref} p={p} />
          ))}
        </ol>
      </section>
    </div>
  );
}
