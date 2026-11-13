import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type AuditStage, auditStages, currentStep } from "../data/audit";
import { adminLog } from "../data/desk";
import { usd } from "../data/format";
import type { RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { TxLink, Waiting } from "./bits";

// What happened, for the admin: where the money went, then the purchase stage by stage in the order
// it happened, each stage folded until it is wanted, with its facts and its own events. The same
// record can be read as one timeline instead.

const RING: Record<AuditStage["state"], string> = { done: "bg-ok text-primary-foreground", now: "bg-money text-primary-foreground", todo: "border border-solid border-muted-foreground text-muted-foreground", stopped: "bg-stop text-primary-foreground" };
const WORD: Record<AuditStage["state"], string> = { done: "text-ok", now: "text-money", todo: "text-muted-foreground", stopped: "text-stop" };
const TONE = { plain: "", ok: "text-ok", held: "text-held", stop: "text-stop", money: "text-money" } as const;

function Money({ record, view }: { record: SourcingRecord; view: RunView }) {
  const total = record.job ? usd(Number(record.job.amount.cents)) : null;
  const supplier = record.job ? (record.invites.find((i) => i.address === record.job?.seller)?.name ?? "The supplier") : "The supplier";
  const box = "flex min-w-44 flex-1 flex-col gap-0.5 rounded-xl border border-solid bg-background/70 px-3.5 py-3";
  const arrow = (tone: string) => (
    <svg aria-hidden="true" className={cn("hidden shrink-0 sm:block", tone)} width="40" height="16" viewBox="0 0 40 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h34" />
      <path d="m30 3 6 5-6 5" />
    </svg>
  );
  return (
    <section className="glass flex flex-col gap-3 rounded-xl p-4" aria-label="Where the money went">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Where the money went</span>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className={box}>
          <span className="text-xs text-muted-foreground">Buyer's treasury</span>
          <strong className="text-lg font-semibold tabular-nums">{view.locked && total ? `${total} out` : "Nothing has left"}</strong>
          <span className="text-xs text-muted-foreground">{view.locked ? (record.approval ? "Only after the buyer's yes" : "Locked on the Lead agent's choice") : "Nothing locks before the buyer's yes"}</span>
        </div>
        {arrow(view.locked ? "text-money" : "text-muted-foreground")}
        <div className={cn(box, view.locked && !view.paid && !view.refunded && "border-money/50")}>
          <span className="text-xs text-muted-foreground">Locked on the XRP Ledger</span>
          <strong className={cn("text-lg font-semibold tabular-nums", view.locked && "text-money")}>{!view.locked ? "Nothing locked" : view.paid ? "Released" : view.refunded ? "Returned" : `${total ?? "The payment"} held`}</strong>
          <span className="text-xs text-muted-foreground">{view.locked ? (view.paid || view.refunded ? "Held until the checks were done" : "Held until both checks pass") : "Test dollars, no real value"}</span>
        </div>
        {arrow(view.paid ? "text-ok" : view.refunded ? "text-stop" : "text-muted-foreground")}
        <div className={cn(box, view.paid && "border-ok/50", view.refunded && "border-stop/50")}>
          <span className="text-xs text-muted-foreground">{supplier}</span>
          <strong className={cn("text-lg font-semibold tabular-nums", view.paid && "text-ok", view.refunded && "text-stop")}>{view.paid ? `${total ?? "The payment"} paid` : view.refunded ? "Not paid" : "Nothing paid"}</strong>
          <span className="text-xs text-muted-foreground">{view.paid ? "Confirmed on the ledger" : view.refunded ? "The money went back to the buyer" : "Paid only after the checks"}</span>
        </div>
      </div>
    </section>
  );
}

function Events({ events }: { events: AuditStage["events"] }) {
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {events.map((e) => (
        <li key={e.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 border-t border-solid py-1.5 text-[0.8125rem] leading-relaxed first:border-t-0 sm:grid-cols-[4.5rem_10.5rem_minmax(0,1fr)]">
          <time className="mono text-xs text-muted-foreground">{e.time}</time>
          <strong className={cn("font-semibold max-sm:col-start-2", TONE[e.tone])}>{e.who}</strong>
          <span className="max-sm:col-start-2">
            {e.what} {e.tx ? <TxLink tx={e.tx} label="See it on the XRP Ledger" /> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Audit({ record, view }: { record: SourcingRecord | null; view: RunView | null }) {
  const [mode, setMode] = useState<"stage" | "timeline">("stage");
  if (!record || !view) return <Waiting>No purchase on record yet. Start one from My purchase, or pick a recording under Recordings and display.</Waiting>;
  const stages = auditStages(record, view);
  const open = currentStep(stages);
  const stopped = view.messages.filter((m) => m.kind === "from_supplier" && !m.delivered).length;
  const brief = record.sourcing.brief;
  const outcome = view.paid ? "Supplier paid" : view.refunded ? "Refunded" : view.locked ? "Payment locked" : record.approval?.state === "declined" ? "Buyer said no" : record.approval?.state === "waiting" ? "Waiting for the buyer" : "Negotiating";
  return (
    <div className="tw flex flex-col gap-3.5 text-foreground">
      <header className="glass flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="m-0 flex flex-wrap items-baseline gap-2.5 text-lg font-semibold tracking-tight">
            {brief.goods.quantity.toLocaleString("en-US")} x {brief.goods.description} <span className="mono text-xs font-normal text-muted-foreground">{record.sourcing.ref}</span>
          </h1>
          <p className="m-0 text-sm text-muted-foreground">Every step, check and payment for this purchase. Times are UTC.</p>
        </div>
        <span className={cn("rounded-full border border-solid px-3 py-1 text-sm font-semibold", view.paid ? "border-ok text-ok" : view.refunded || record.approval?.state === "declined" ? "border-stop text-stop" : "border-money text-money")}>{outcome}</span>
      </header>

      <Money record={record} view={view} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">View</span>
        <Button type="button" variant={mode === "stage" ? "default" : "outline"} className="min-h-11 rounded-full px-4" aria-pressed={mode === "stage"} onClick={() => setMode("stage")}>
          By stage
        </Button>
        <Button type="button" variant={mode === "timeline" ? "default" : "outline"} className="min-h-11 rounded-full px-4" aria-pressed={mode === "timeline"} onClick={() => setMode("timeline")}>
          As one timeline
        </Button>
        <span className="flex-1" />
        {stopped > 0 ? (
          <span className="text-sm font-medium text-held">
            {stopped} {stopped === 1 ? "message" : "messages"} stopped by the bouncer
          </span>
        ) : null}
      </div>

      {mode === "timeline" ? (
        <section className="glass rounded-xl px-4 py-2">
          <Events events={adminLog(record, view)} />
        </section>
      ) : (
        <div className="flex flex-col gap-2">
          {stages.map((s) => (
            <details key={`${s.id}:${s.id === open}`} open={s.id === open} className="deal-step glass rounded-xl px-4 py-2.5">
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-3">
                <span className={cn("flex size-[1.625rem] shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-semibold", RING[s.state])} aria-hidden="true">
                  {s.n}
                </span>
                <strong className={cn("flex-1 text-[0.95rem] font-semibold", s.state === "todo" && "font-normal text-muted-foreground")}>{s.label}</strong>
                {s.tx ? <TxLink tx={s.tx} label="Ledger proof" /> : null}
                <span className={cn("text-sm font-semibold", WORD[s.state])}>{s.summary}</span>
                <ChevronRight className="deal-chev size-3.5 text-muted-foreground" aria-hidden="true" />
              </summary>
              <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-3 pb-1.5">
                <dl className="m-0 flex min-w-64 flex-1 flex-col">
                  {s.facts.length === 0 ? <p className="m-0 border-t border-solid py-1.5 text-sm text-muted-foreground">{s.detail}</p> : null}
                  {s.facts.map((f, i) => (
                    <div key={`${f.label}:${i}`} className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-x-3 border-t border-solid py-1.5 text-sm leading-relaxed">
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd className="m-0">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                {s.events.length > 0 ? (
                  <div className="min-w-64 flex-1 rounded-xl bg-secondary/50 px-3 py-2">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {s.events.length} {s.events.length === 1 ? "event" : "events"} in this stage
                    </span>
                    <Events events={s.events} />
                  </div>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
