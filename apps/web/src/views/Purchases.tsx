import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { RECORDINGS } from "../data/evidence";
import { type PurchaseRow, purchaseRows } from "../data/purchases";
import type { SourcingListItem } from "../data/types";

// My purchases: every purchase, newest first, with one line for where it stands. Opening one shows it
// on the buyer's main screen. Without the live backend there is still something to open: the recorded
// test purchases, said to be recordings.

const TONE: Record<PurchaseRow["tone"], string> = { plain: "text-muted-foreground", ok: "text-ok", held: "text-held", stop: "text-stop", money: "text-money" };
const DOT: Record<PurchaseRow["tone"], string> = { plain: "bg-muted-foreground", ok: "bg-ok", held: "bg-held", stop: "bg-stop", money: "bg-money" };
const row = "flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-solid bg-background/60 px-4 py-3 text-left text-foreground no-underline hover:bg-background";

export function Purchases({ purchases, showing, live, recording, onRecording }: { purchases: SourcingListItem[]; showing: string | null; live: boolean; recording: string; onRecording: (id: string) => void }) {
  const rows = live ? purchaseRows(purchases, showing) : [];
  return (
    <section className="tw glass mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-xl p-5 text-foreground" aria-label="My purchases">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="m-0 text-xl font-semibold tracking-tight">My purchases</h1>
          <p className="m-0 text-sm text-muted-foreground">{live ? "Newest first. Open one to see its conversation, its steps and where the money is." : "The live backend is not connected, so these are recordings of real test purchases. You can watch them, not change them."}</p>
        </div>
        <a href="#/" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline hover:bg-money">
          <Plus className="size-4" aria-hidden="true" />
          {live ? "Buy something" : "Back to the chat"}
        </a>
      </header>

      {live && rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-solid bg-background/50 p-5">
          <strong className="text-base font-semibold">Your first purchase starts with one sentence.</strong>
          <p className="m-0 text-sm text-muted-foreground">Tell your agent what you need, for example 400 solar panels at about $110 each within 30 days. It finds suppliers and negotiates, and it shows up here as soon as it starts.</p>
          <a href="#/" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground no-underline hover:bg-money">
            Tell your agent what you need
          </a>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((p) => (
            <li key={p.id}>
              <a href={p.href} className={cn(row, p.showing && "border-money/50 bg-background")} aria-current={p.showing ? "true" : undefined}>
                <span className={cn("size-2.5 shrink-0 rounded-full", DOT[p.tone])} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong className="truncate text-[0.95rem] font-semibold">{p.title}</strong>
                  <span className={cn("text-sm", TONE[p.tone])}>{p.line}</span>
                  <span className="text-xs text-muted-foreground">
                    <span className="mono">{p.ref}</span>
                    {p.opened ? ` · opened ${p.opened}` : ""}
                    {p.showing ? " · on your screen now" : ""}
                  </span>
                </span>
                {p.amount ? <strong className="text-base font-semibold tabular-nums">{p.amount}</strong> : null}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ol>
      ) : null}

      {!live ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {RECORDINGS.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={cn(row, "w-full", r.id === recording && "border-money/50 bg-background")}
                onClick={() => {
                  onRecording(r.id);
                  window.location.hash = "#/";
                }}
              >
                <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong className="text-[0.95rem] font-semibold">{r.label}</strong>
                  <span className="text-xs text-muted-foreground">Recorded on {r.date}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
