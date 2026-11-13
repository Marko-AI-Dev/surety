import { ArrowRight, ArrowUp, ChevronRight, Eye, FileText, type LucideIcon, MessageSquare, Plus, Search, Send, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { OPEN_PANEL, type PanelName } from "@/components/SideNav";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type DealStep, currentStep, dealSteps } from "../data/audit";
import { type FeedItem, type FeedTone, type SupplierCard, agentStatus, chatFeed, supplierCards } from "../data/chat";
import { deskStage, threadOf } from "../data/desk";
import { usd, utcTime } from "../data/format";
import { ApiError, type Draft, type DraftField, type IntakeAnswer, answerDraft, askWrapUp, readNeed, sendChat, setControls, startPurchase, writeToSupplier } from "../data/live";
import type { RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { Review, Speak, Track, understood } from "./Desk";

// The buyer's one screen: a chat with their own agent. You say what you need in one sentence and the
// team goes to work, and from then on everything that happens arrives here as a message: each price
// as it moves, a message Surety stopped, a message waiting for your approval, the recommendation with
// Yes and No, and the order after the yes. The text box is always at the bottom and is never taken
// away. On a wide screen the deal sits beside the chat as six steps in the order they happen. Each
// supplier's conversation opens in a side panel.

const api = (url: string, init?: Parameters<typeof fetch>[1]) => fetch(url, init);
// The buyer's decide-by time in this build: the latest a negotiation may run. It is a backstop, not a
// countdown: the agents come back as soon as a supplier meets the brief or the buyer asks.
const DECIDE_BY_SECONDS = 1800;
const DRAFT_KEY = "surety.chat.unsent";
const problemOf = (e: unknown) => (e instanceof ApiError ? e.message : "That did not go through. Please try again.");
// One sentence is enough to start. These are complete, so the start button follows at once.
const STARTERS = ["I need 400 solar panels, about $110 each and no more than $120, within 30 days.", "I need 1,000 solar panels, about $105 each and no more than $115, within 45 days.", "I need 200 solar panels, about $115 each and no more than $125, within 14 days."];
const PRIORITY_CHIP = { balanced: "A balance of price and speed", price: "The lowest price first", speed: "The fastest delivery first" } as const;
const NEXT_PRIORITY = { balanced: "price", price: "speed", speed: "balanced" } as const;

interface LocalLine {
  who: "you" | "agent";
  text: string;
  at: number;
}

const DOT: Record<FeedTone, string> = { plain: "bg-muted-foreground", ok: "bg-ok", held: "bg-held", stop: "bg-stop", money: "bg-money" };
const chip = "min-h-11 cursor-pointer rounded-full border border-solid border-border bg-background px-4 text-left text-sm text-foreground hover:bg-accent";

function Bubble({ who, children, label }: { who: "you" | "agent"; children: ReactNode; label?: string }) {
  return (
    <li className={cn("flex flex-col gap-1", who === "you" ? "items-end" : "items-start")}>
      {label ? <span className="px-1 text-xs text-muted-foreground">{label}</span> : null}
      <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[0.95rem] leading-relaxed", who === "you" ? "rounded-br-md bg-ours text-ours-foreground" : "rounded-bl-md bg-secondary text-foreground")}>{children}</div>
    </li>
  );
}

function Update({ item, onOpen }: { item: Extract<FeedItem, { kind: "update" }>; onOpen: (supplier: string) => void }) {
  return (
    <li className="flex items-start gap-2.5 px-1 text-sm text-muted-foreground">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[item.tone])} aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1">
        <span className={item.tone === "plain" ? "" : "text-foreground"}>{item.text}</span>{" "}
        {item.supplier ? (
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-sm text-primary underline underline-offset-2" onClick={() => onOpen(item.supplier as string)}>
            Open the conversation
          </button>
        ) : null}
      </p>
      <time className="shrink-0 pt-0.5 text-xs tabular-nums">{utcTime(item.at)}</time>
    </li>
  );
}

// The words on a main button change on hover to what pressing it gets you, and its paper plane flies.
function Win({ rest, win }: { rest: string; win: string }) {
  return (
    <>
      <span className="group-hover:hidden">{rest}</span>
      <span className="hidden group-hover:inline">{win}</span>
      <Send className="plane-loop" aria-hidden="true" />
    </>
  );
}

// A message the negotiator wrote that waits for the buyer: read it, change it, send it or throw it away.
function DraftCard({ id, name, text, canAct }: { id: string; name: string; text: string; canAct: boolean }) {
  const [value, setValue] = useState(text);
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = value.trim() !== text.trim();
  const answer = async (action: "send" | "discard") => {
    setBusy(action);
    setProblem(null);
    try {
      await answerDraft(api, id, action, action === "send" && changed ? value.trim() : undefined);
    } catch (e) {
      setProblem(problemOf(e));
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-solid border-held/60 bg-card p-3">
      <p className="m-0 text-sm">
        <strong className="font-semibold">Waiting for you.</strong> <span className="text-muted-foreground">Your negotiator wants to send this to {name}</span>
      </p>
      <Textarea aria-label={`Message to ${name}`} value={value} onChange={(e) => setValue(e.target.value)} disabled={!canAct || busy !== null} rows={3} maxLength={1000} className="min-h-20 bg-background text-[0.95rem]" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" className="group min-h-11 rounded-full px-4" onClick={() => answer("send")} disabled={!canAct || busy !== null || !value.trim()}>
          {busy === "send" ? "Sending" : <Win rest={changed ? "Send my wording" : "Send as written"} win="Off it goes" />}
        </Button>
        <Button type="button" size="sm" variant="outline" className="min-h-11 rounded-full px-4" onClick={() => answer("discard")} disabled={!canAct || busy !== null}>
          {busy === "discard" ? "Throwing away" : "Don't send"}
        </Button>
        <span className="text-xs text-muted-foreground">Change the words and it sends your wording.</span>
      </div>
      {problem ? (
        <p className="m-0 text-sm text-stop" role="status">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function Composer({ value, onChange, onSend, busy, disabled, placeholder, label }: { value: string; onChange: (v: string) => void; onSend: () => void; busy: boolean; disabled?: boolean; placeholder: string; label: string }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !busy && !disabled) onSend();
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2 rounded-2xl border border-solid bg-background p-2 focus-within:ring-2 focus-within:ring-ring/60">
      <Textarea
        aria-label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        maxLength={500}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) submit(e);
        }}
        className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[0.95rem] shadow-none focus-visible:ring-0"
      />
      <Speak onText={(t) => onChange(value ? `${value} ${t}` : t)} disabled={busy || disabled} />
      <Button type="submit" size="icon" disabled={busy || disabled || !value.trim()} aria-label={busy ? "Sending" : "Send"} className="size-11 rounded-full">
        <ArrowUp />
      </Button>
    </form>
  );
}

// One supplier's conversation, with what is waiting for the buyer and a box to write to it yourself.
function SupplierPanel({ record, view, card, canAct, onClose }: { record: SourcingRecord; view: RunView; card: SupplierCard | null; canAct: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mails = card ? threadOf(record, view, card.address) : [];
  const draft = card ? (record.drafts ?? []).find((d) => d.supplier === card.address) : undefined;
  const canWrite = canAct && record.sourcing.state === "OPEN" && card !== null && card.state !== "out";
  const send = async () => {
    if (!card) return;
    setBusy(true);
    setProblem(null);
    try {
      await writeToSupplier(api, record.sourcing.id, card.address, text.trim());
      setText("");
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={card !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent className="tw w-full gap-0 border-l bg-popover text-popover-foreground sm:max-w-lg">
        <SheetHeader className="border-b border-solid">
          <SheetTitle>{card?.name ?? "Supplier"}</SheetTitle>
          <SheetDescription>{card?.line}. You see every message. Nothing said here can move money.</SheetDescription>
        </SheetHeader>
        <ol className="m-0 flex flex-1 list-none flex-col gap-3 overflow-y-auto p-4">
          {mails.length === 0 ? <li className="text-sm text-muted-foreground">Your negotiator has not written to this supplier yet. Its first message will show here.</li> : null}
          {mails.map((m) =>
            m.held ? (
              <li key={m.key} className={cn("rounded-xl border border-solid p-3 text-sm", m.held.tone === "stop" ? "border-stop/60" : "border-held/60")}>
                <strong>{m.held.card === "red" ? "Red card. " : m.held.card === "yellow" ? "Yellow card. " : ""}</strong>
                Surety stopped this message before your agents could read it. {m.held.text}
              </li>
            ) : (
              <Bubble key={m.key} who={m.mine ? "you" : "agent"} label={`${m.from}${m.buyerEdited ? ", in your wording" : ""} · ${utcTime(m.at)}`}>
                {m.body}
              </Bubble>
            ),
          )}
          {draft && card ? (
            <li>
              <DraftCard key={draft.id} id={draft.id} name={card.name} text={draft.text} canAct={canAct} />
            </li>
          ) : null}
        </ol>
        {canWrite && card ? (
          <div className="flex flex-col gap-1.5 border-t border-solid p-3">
            <Composer value={text} onChange={setText} onSend={send} busy={busy} label={`Write to ${card.name}`} placeholder={`Write to ${card.name} yourself`} />
            <p className="m-0 px-1 text-xs text-muted-foreground">This goes straight to the supplier, in your words. Your negotiator sees it and carries on from there.</p>
            {problem ? (
              <p className="m-0 px-1 text-sm text-stop" role="status">
                {problem}
              </p>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// How the negotiator works: on its own or with every message approved first, how hard it pushes, and
// asking for what the agents have now.
function SettingsPanel({ record, open, canAct, onClose }: { record: SourcingRecord | null; open: boolean; canAct: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const controls = record?.controls ?? { autonomy: record?.sourcing.brief.autonomy ?? "full", push: record?.sourcing.brief.push ?? "firm", wrapUpAt: null };
  const live = canAct && record?.sourcing.state === "OPEN";
  const id = record?.sourcing.id ?? "";
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent className="tw w-full gap-0 border-l bg-popover text-popover-foreground sm:max-w-md">
        <SheetHeader className="border-b border-solid">
          <SheetTitle>How your negotiator works</SheetTitle>
          <SheetDescription>{record ? "You can change this at any time while the negotiation runs." : "These apply once a purchase is under way. You can also choose the first one when you start."}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 p-4">
          <label className="flex items-start justify-between gap-4">
            <span className="flex flex-col gap-1">
              <span className="font-medium">I approve every message first</span>
              <span className="text-sm text-muted-foreground">
                {controls.autonomy === "approve"
                  ? "On. Each message your negotiator writes waits here for you. You can change it, send it or throw it away."
                  : "Off. Your negotiator writes to suppliers on its own and comes back to you with a recommendation."}
              </span>
            </span>
            <Switch checked={controls.autonomy === "approve"} disabled={!live || busy} onCheckedChange={(on) => run(() => setControls(api, id, { autonomy: on ? "approve" : "full" }))} aria-label="I approve every message first" />
          </label>
          <div className="flex flex-col gap-2">
            <span className="font-medium">How hard it pushes on price</span>
            <div className="flex gap-2">
              {(["gentle", "firm"] as const).map((p) => (
                <Button key={p} type="button" variant={controls.push === p ? "default" : "outline"} className="min-h-11 rounded-full px-4" aria-pressed={controls.push === p} disabled={!live || busy} onClick={() => run(() => setControls(api, id, { push: p }))}>
                  {p === "gentle" ? "Gently" : "Firmly"}
                </Button>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">{controls.push === "gentle" ? "It asks once and never presses a supplier that says no." : "It uses competing offers every round until a supplier holds its price."}</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-medium">Stop negotiating and decide</span>
            <Button type="button" variant="outline" disabled={!live || busy || controls.wrapUpAt !== null} onClick={() => run(() => askWrapUp(api, id))} className="min-h-11 self-start rounded-full px-4">
              {controls.wrapUpAt ? "Asked. Getting final quotes" : "Bring me what you have"}
            </Button>
            <span className="text-sm text-muted-foreground">Your negotiator asks every supplier for its final quote, and your agent brings you its recommendation. Nothing is paid until you say yes.</span>
          </div>
          {!live ? <p className="m-0 text-sm text-muted-foreground">{!record ? "Start a purchase and these switch on." : canAct ? "This negotiation is over, so these can no longer be changed." : "This is a recording, so these cannot be changed."}</p> : null}
          {problem ? (
            <p className="m-0 text-sm text-stop" role="status">
              {problem}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Who your agents may buy from and how much they may spend. Set by a person, read-only here.
function LimitsPanel({ record, open, onClose }: { record: SourcingRecord | null; open: boolean; onClose: () => void }) {
  const policy = record?.policy ?? null;
  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent className="tw w-full gap-0 border-l bg-popover text-popover-foreground sm:max-w-md">
        <SheetHeader className="border-b border-solid">
          <SheetTitle>Suppliers and limits</SheetTitle>
          <SheetDescription>Set by a person, outside the reach of your agents. Your agents can read these; they cannot change them.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 p-4">
          {policy ? (
            <>
              <div className="flex flex-col gap-2">
                <span className="font-medium">Spending limits</span>
                <dl className="m-0 flex flex-col gap-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Most for one deal</dt>
                    <dd className="m-0 font-medium tabular-nums">{usd(Number(policy.limits.perDealCents))}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Most in one day</dt>
                    <dd className="m-0 font-medium tabular-nums">{usd(Number(policy.limits.dailyCents))}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Deals open at once</dt>
                    <dd className="m-0 font-medium tabular-nums">{policy.limits.openDeals}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-medium">Approved suppliers</span>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                  {policy.approvedSuppliers.map((s) => (
                    <li key={s.address} className="flex items-center justify-between gap-4 rounded-xl border border-solid px-3 py-2">
                      <span>{s.name === s.address ? "A wallet with no name yet" : s.name}</span>
                      <span className={cn("text-xs font-medium", s.onHold ? "text-held" : "text-ok")}>{s.onHold ? "On hold after a card" : "Approved"}</span>
                    </li>
                  ))}
                </ul>
                <span className="text-sm text-muted-foreground">This is a demo list on the test network, not a real supplier check.</span>
              </div>
            </>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">Your approved suppliers and spending limits are read from the purchase. Start one, or open a recording in Admin, and they show here.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface QuickAction {
  group: "This purchase" | "Go to";
  label: string;
  icon: LucideIcon;
  run: () => unknown;
}

// Search or do something: the few things a buyer might want next, one keystroke away.
function QuickActions({ open, actions, onClose, onProblem }: { open: boolean; actions: QuickAction[]; onClose: () => void; onProblem: (text: string) => void }) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const shown = actions.filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = async (a: QuickAction) => {
    onClose();
    try {
      await a.run();
    } catch (e) {
      onProblem(problemOf(e));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="tw gap-1 p-2">
        <DialogTitle className="sr-only">Search or do something</DialogTitle>
        <DialogDescription className="sr-only">Type to narrow the list, then choose an action.</DialogDescription>
        <div className="flex items-center gap-2 border-b border-solid px-3 pb-2">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <input
            aria-label="Search or do something"
            placeholder="Search or do something"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) void pick(shown[0]);
            }}
            className="min-h-11 flex-1 border-0 bg-transparent text-base text-foreground outline-none"
          />
        </div>
        {(["This purchase", "Go to"] as const).map((group) => {
          const items = shown.filter((a) => a.group === group);
          return items.length === 0 ? null : (
            <div key={group} className="flex flex-col">
              <span className="px-3 pt-2 pb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">{group}</span>
              {items.map((a) => (
                <button key={a.label} type="button" onClick={() => pick(a)} className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-left text-[0.95rem] text-foreground hover:bg-accent">
                  <a.icon className="size-[1.125rem] shrink-0" aria-hidden="true" />
                  {a.label}
                </button>
              ))}
            </div>
          );
        })}
        {shown.length === 0 ? <p className="m-0 px-3 py-3 text-sm text-muted-foreground">Nothing matches. You can also just tell your agent what you want in the chat.</p> : null}
      </DialogContent>
    </Dialog>
  );
}

const STEP_RING: Record<DealStep["state"], string> = { done: "bg-ok text-primary-foreground", now: "bg-money text-primary-foreground", todo: "border border-solid border-muted-foreground text-muted-foreground", stopped: "bg-stop text-primary-foreground" };
const STEP_WORD: Record<DealStep["state"], string> = { done: "text-ok", now: "text-money", todo: "text-muted-foreground", stopped: "text-stop" };

// The deal beside the chat: six steps in the order they happen, only the current one open.
function DealRail({ record, view, cards, canWrapUp, onOpen, onWrapUp }: { record: SourcingRecord; view: RunView; cards: SupplierCard[]; canWrapUp: boolean; onOpen: (supplier: string) => void; onWrapUp: () => void }) {
  const steps = dealSteps(record, view);
  const current = currentStep(steps);
  const brief = record.sourcing.brief;
  return (
    <aside className="glass hidden h-[calc(100dvh-2rem)] w-[21rem] shrink-0 flex-col gap-3 overflow-y-auto rounded-xl p-4 text-foreground xl:flex" aria-label="Your deal">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Your deal</span>
        <strong className="text-lg leading-tight font-semibold tracking-tight">
          {brief.goods.quantity.toLocaleString("en-US")} solar panels to {brief.port}
        </strong>
        <span className="text-sm text-muted-foreground">
          Step {steps.find((s) => s.id === current)?.n ?? 1} of {steps.length}
        </span>
      </div>
      {steps.map((s) => (
        <details key={`${s.id}:${s.id === current}`} open={s.id === current} className={cn("deal-step rounded-xl border border-solid bg-background/60 px-3.5 py-3", s.id === current && "border-money/50 bg-background")}>
          <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2.5">
            <span className={cn("flex size-[1.375rem] shrink-0 items-center justify-center rounded-full text-xs font-semibold", STEP_RING[s.state])} aria-hidden="true">
              {s.n}
            </span>
            <strong className={cn("flex-1 text-sm font-semibold", s.state === "todo" && "font-normal text-muted-foreground")}>{s.label}</strong>
            <span className={cn("text-xs font-semibold", STEP_WORD[s.state])}>{s.summary}</span>
            <ChevronRight className="deal-chev size-3.5 text-muted-foreground" aria-hidden="true" />
          </summary>
          <p className="mt-2.5 mb-0 text-[0.8125rem] leading-relaxed text-muted-foreground">{s.detail}</p>
          {s.id === "negotiating" && cards.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {cards.map((c) => (
                <button key={c.address} type="button" onClick={() => onOpen(c.address)} className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-solid bg-background px-3 py-2 text-left text-foreground hover:bg-accent", c.tone === "held" && "border-held/70", c.tone === "stop" && "border-stop/60")}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <strong className="truncate text-sm font-semibold">{c.name}</strong>
                    <span className={cn("text-xs text-muted-foreground", c.tone === "held" && "font-medium text-held", c.tone === "stop" && "text-stop")}>
                      {c.line}
                      {c.state === "typing" ? <span className="typing-dots" aria-hidden="true" /> : null}
                    </span>
                  </span>
                  {c.priceCents !== null ? <strong className="text-base font-semibold text-money tabular-nums">{usd(c.priceCents)}</strong> : null}
                </button>
              ))}
              {canWrapUp ? (
                <Button type="button" variant="secondary" className="min-h-11 rounded-full" onClick={onWrapUp}>
                  Bring me what you have
                </Button>
              ) : null}
            </div>
          ) : null}
        </details>
      ))}
    </aside>
  );
}

const loadUnsent = () => {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
};

export function Chat({
  record,
  view,
  canAct,
  now,
}: {
  record: SourcingRecord | null;
  view: RunView | null;
  // True only on the live backend: a recording or a simulated feed can be watched, not acted on.
  canAct: boolean;
  now: number;
}) {
  const stage = deskStage(record, view);
  const finished = stage === "done" || stage === "refunded" || stage === "declined";
  const [again, setAgain] = useState(false);
  const [startedFor, setStartedFor] = useState<string | null>(null);
  const currentId = record?.sourcing.id ?? "none";
  const starting = startedFor !== null && startedFor === currentId;
  // Asking for a new purchase: nothing is running, or the last one is finished and the buyer asked for another.
  const asking = canAct && !starting && (stage === "ask" || (finished && again));

  const [text, setTextState] = useState(loadUnsent);
  const setText = (v: string) => {
    setTextState(v);
    try {
      sessionStorage.setItem(DRAFT_KEY, v);
    } catch {
      // Private windows can refuse storage; the text then lasts until the page is closed.
    }
  };
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalLine[]>([]);
  const [answer, setAnswer] = useState<IntakeAnswer | null>(null);
  const [approveFirst, setApproveFirst] = useState(false);
  const [openSupplier, setOpenSupplier] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [limits, setLimits] = useState(false);
  const [quick, setQuick] = useState(false);

  // A new purchase appeared: what was typed for the last one is done with.
  useEffect(() => {
    if (startedFor !== null && startedFor !== currentId) {
      setStartedFor(null);
      setAgain(false);
      setLocal([]);
      setAnswer(null);
    }
  }, [startedFor, currentId]);

  // The menu on the left can open a panel here, and Ctrl K (or Cmd K) opens the quick actions.
  useEffect(() => {
    const onPanel = (e: Event) => {
      const name = (e as CustomEvent<PanelName>).detail;
      if (name === "settings") setSettings(true);
      else if (name === "limits") setLimits(true);
      else setQuick(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuick((q) => !q);
      }
    };
    window.addEventListener(OPEN_PANEL, onPanel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_PANEL, onPanel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const feed = useMemo(() => (record && view && !asking ? chatFeed(record, view) : []), [record, view, asking]);
  const cards = useMemo(() => (record && view && !asking ? supplierCards(record, view, now) : []), [record, view, asking, now]);
  // Lines shown at once, before the next reading of the record brings them back from the server.
  const shownLocal = asking
    ? local
    : local.filter((l) => !(record?.chat ?? []).some((c) => (c.role === "buyer") === (l.who === "you") && c.text === l.text && Date.parse(c.at) >= l.at - 15_000));

  const end = useRef<HTMLDivElement>(null);
  const count = feed.length + shownLocal.length + (answer ? 1 : 0) + (starting ? 1 : 0);
  useEffect(() => {
    // Newer browsers return a promise from scrollIntoView, so the effect must not return it.
    if (count > 0) void end.current?.scrollIntoView?.({ block: "end" });
  }, [count]);

  const say = (who: LocalLine["who"], line: string) => setLocal((l) => [...l, { who, text: line, at: Date.now() }]);

  const send = async (given?: string) => {
    const said = (given ?? text).trim();
    if (!said || busy) return;
    setBusy(true);
    setProblem(null);
    say("you", said);
    if (given === undefined) setText("");
    try {
      if (asking) {
        const next = await readNeed(api, { text: said, ...(answer ? { draft: answer.draft } : {}), ...(answer?.question ? { field: answer.question.field } : {}) });
        setAnswer(next);
        say("agent", next.question ? next.question.ask : "Here is what I understood. If it is right, I will put the team to work.");
      } else if (record) {
        const r = await sendChat(api, record.sourcing.id, said);
        say("agent", r.reply);
      }
    } catch (e) {
      setProblem(e instanceof ApiError && e.status === 404 ? "Your agent cannot answer here yet: this screen is not connected to a model on this machine." : problemOf(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!answer?.ready) return;
    setBusy(true);
    setProblem(null);
    try {
      await startPurchase(api, { ...(answer.draft as Required<Draft>), negotiationSeconds: DECIDE_BY_SECONDS, ...(approveFirst ? { autonomy: "approve" as const } : {}) });
      setStartedFor(currentId);
    } catch (e) {
      setProblem(e instanceof ApiError && e.status === 404 ? "This screen is not connected to your agent team on this machine yet." : problemOf(e));
    } finally {
      setBusy(false);
    }
  };

  // The buyer changes something the agent assumed: from then on it is the buyer's own choice.
  const choose = (patch: Partial<Draft>, field: DraftField) => setAnswer((a) => (a ? { ...a, draft: { ...a.draft, ...patch }, assumed: (a.assumed ?? []).filter((f) => f !== field) } : a));

  const live = canAct && !asking && record?.sourcing.state === "OPEN";
  const wrapped = (record?.controls?.wrapUpAt ?? null) !== null;
  const approving = record?.controls?.autonomy === "approve";
  const wrapUp = async () => {
    if (!record) return;
    try {
      await askWrapUp(api, record.sourcing.id);
    } catch (e) {
      setProblem(problemOf(e));
    }
  };

  const actions: QuickAction[] = [
    ...(live && !wrapped ? [{ group: "This purchase" as const, label: "Bring me what you have", icon: ArrowRight, run: wrapUp }] : []),
    ...(live && record ? [{ group: "This purchase" as const, label: approving ? "Stop asking me before each message" : "Approve every message first", icon: Eye, run: () => setControls(api, record.sourcing.id, { autonomy: approving ? "full" : "approve" }) }] : []),
    ...cards.map((c) => ({ group: "This purchase" as const, label: `Open ${c.name}'s conversation`, icon: MessageSquare, run: () => setOpenSupplier(c.address) })),
    ...(canAct && finished && !again ? [{ group: "This purchase" as const, label: "Buy something else", icon: Plus, run: () => setAgain(true) }] : []),
    { group: "Go to", label: "Negotiator settings", icon: SlidersHorizontal, run: () => setSettings(true) },
    { group: "Go to", label: "Suppliers and limits", icon: ShieldCheck, run: () => setLimits(true) },
    {
      group: "Go to",
      label: "What happened, step by step",
      icon: FileText,
      run: () => {
        window.location.hash = "#/admin";
      },
    },
  ];

  if (!record && !canAct) {
    return (
      <section className="desk-card glass">
        <h1>No purchase to show</h1>
        <p className="desk-lead">
          Connect the live backend to talk to your agent, or <a href="#/admin/display">pick a recording</a> to watch a real test purchase.
        </p>
      </section>
    );
  }

  const lines = answer ? understood({ ...answer.draft, priority: undefined, push: undefined }) : [];
  const status = asking ? "Ready when you are." : starting ? "Opening your purchase." : record && view ? agentStatus(record, view) : "";
  const openCard = cards.find((c) => c.address === openSupplier) ?? null;
  const priority = answer?.draft.priority ?? "balanced";
  const push = answer?.draft.push ?? "firm";
  const rail = record && view && !asking;

  return (
    <div className={cn("tw mx-auto flex w-full items-stretch gap-4", rail ? "max-w-6xl" : "max-w-3xl")}>
      <section className="glass flex h-[calc(100dvh-7rem)] min-h-[30rem] min-w-0 flex-1 flex-col overflow-hidden rounded-xl text-foreground lg:h-[calc(100dvh-2rem)]" aria-label="Your agent">
        <header className="flex flex-wrap items-center gap-3 border-b border-solid px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
            A
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-base leading-tight font-semibold">Your agent</h1>
            <p className={cn("m-0 truncate text-sm text-muted-foreground", (record?.drafts ?? []).length > 0 && !asking && "font-medium text-held")} aria-live="polite">
              {status}
            </p>
          </div>
          <button type="button" onClick={() => setQuick(true)} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full border border-solid bg-background py-0 pr-2 pl-3.5 text-sm text-muted-foreground hover:bg-accent">
            <Search className="size-4" aria-hidden="true" />
            <span className="max-sm:sr-only">Search or do something</span>
            <kbd className="rounded-md bg-secondary px-2 py-1 font-sans text-xs font-semibold text-foreground max-sm:hidden">Ctrl K</kbd>
          </button>
          {record && !asking ? (
            <Button type="button" variant="outline" size="icon" className="size-11 rounded-full lg:hidden" aria-label="Negotiator settings" onClick={() => setSettings(true)}>
              <Settings2 />
            </Button>
          ) : null}
        </header>

        {cards.length > 0 ? (
          <nav className="flex gap-2 overflow-x-auto border-b border-solid px-4 py-2.5 xl:hidden" aria-label="Supplier conversations">
            {cards.map((c) => (
              <button
                key={c.address}
                type="button"
                onClick={() => setOpenSupplier(c.address)}
                className={cn("flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-solid bg-background px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent", c.tone === "stop" && "border-stop/60", c.tone === "held" && "border-held/70", c.tone === "money" && "border-money/60")}
              >
                <span className="flex flex-col leading-tight">
                  <strong className="font-medium">{c.name}</strong>
                  <span className="text-xs text-muted-foreground">
                    {c.line}
                    {c.state === "typing" ? <span className="typing-dots" aria-hidden="true" /> : null}
                  </span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </nav>
        ) : null}

        <ol className="m-0 flex flex-1 list-none flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite">
          {asking ? (
            <Bubble who="agent" label="Your agent">
              What do you need to buy? Say it in one sentence. I will find suppliers and negotiate for you, and nothing is paid without your yes.
            </Bubble>
          ) : null}
          {asking && local.length === 0 ? (
            <li className="flex flex-col gap-3 px-1">
              <span className="text-sm font-medium text-muted-foreground">Start with one of these, or write your own below</span>
              <div className="flex flex-col items-start gap-2">
                {STARTERS.map((s) => (
                  <button key={s} type="button" className={chip} onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
              <ol className="m-0 mt-1 flex list-none flex-wrap gap-2.5 p-0">
                {[
                  ["1. You say what you need", "One sentence is enough."],
                  ["2. Your agents negotiate", "You see every message."],
                  ["3. You say yes or no", "Only your yes locks the payment."],
                ].map(([title, body]) => (
                  <li key={title} className="flex min-w-40 flex-1 flex-col gap-1 rounded-xl border border-solid bg-background/50 px-3.5 py-3">
                    <strong className="text-[0.8125rem] font-semibold">{title}</strong>
                    <span className="text-[0.8125rem] text-muted-foreground">{body}</span>
                  </li>
                ))}
              </ol>
            </li>
          ) : null}

          {feed.map((item) =>
            item.kind === "you" || item.kind === "agent" ? (
              <Bubble key={item.key} who={item.kind} label={item.kind === "agent" ? "Your agent" : undefined}>
                {item.text}
              </Bubble>
            ) : item.kind === "update" ? (
              <Update key={item.key} item={item} onOpen={setOpenSupplier} />
            ) : item.kind === "draft" ? (
              <li key={item.key}>
                <DraftCard id={item.id} name={item.name} text={item.text} canAct={canAct} />
              </li>
            ) : item.kind === "review" && record ? (
              <li key={item.key}>
                <Review record={record} canAct={canAct} />
              </li>
            ) : item.kind === "tracker" && record && view ? (
              <li key={item.key}>
                <Track record={record} view={view} now={now} />
              </li>
            ) : null,
          )}

          {shownLocal.map((l) => (
            <Bubble key={`${l.at}-${l.who}`} who={l.who} label={l.who === "agent" ? "Your agent" : undefined}>
              {l.text}
            </Bubble>
          ))}

          {asking && lines.length > 0 ? (
            <li className="flex flex-col gap-3 rounded-xl border border-solid bg-card p-4">
              <p className="m-0 font-semibold">{answer?.ready ? "Here is what I understood" : "So far I have"}</p>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[0.95rem]">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {answer?.ready ? (
                <>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-muted-foreground">{(answer.assumed ?? []).length > 0 ? "I assumed the rest. Tap one to change it:" : "Tap one to change it:"}</span>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={chip} onClick={() => choose({ priority: NEXT_PRIORITY[priority] }, "priority")}>
                        {PRIORITY_CHIP[priority]}
                      </button>
                      <button type="button" className={chip} onClick={() => choose({ push: push === "firm" ? "gentle" : "firm" }, "push")}>
                        {push === "firm" ? "Negotiate firmly" : "Negotiate gently"}
                      </button>
                      <button type="button" className={chip} aria-pressed={approveFirst} onClick={() => setApproveFirst((v) => !v)}>
                        {approveFirst ? "I approve every message first" : "Send messages without asking me"}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" size="lg" onClick={start} disabled={busy} className="group min-h-13 rounded-full px-6 text-base">
                      {busy ? "Starting" : <Win rest="Put my team to work" win="Let's get you a deal" />}
                    </Button>
                    <span className="min-w-48 flex-1 text-sm text-muted-foreground">
                      No timer. They negotiate until a supplier meets your price, or you ask for what they have. In this demo, {DECIDE_BY_SECONDS / 60} minutes at the latest.
                    </span>
                  </div>
                </>
              ) : null}
            </li>
          ) : null}

          {starting ? (
            <Bubble who="agent" label="Your agent">
              I have the job. I am opening the purchase and briefing the Sourcing agent and the Negotiator. The first messages appear here within a minute.
            </Bubble>
          ) : null}

          {busy && !starting ? (
            <li className="px-1 text-sm text-muted-foreground" role="status">
              Your agent is thinking
              <span className="typing-dots" aria-hidden="true" />
            </li>
          ) : null}
          <div ref={end} />
        </ol>

        <footer className="flex flex-col gap-1.5 border-t border-solid px-4 py-3">
          {canAct && finished && !again ? (
            <Button type="button" variant="outline" className="min-h-11 self-start rounded-full px-4" onClick={() => setAgain(true)}>
              Buy something else
            </Button>
          ) : null}
          {problem ? (
            <p className="m-0 text-sm text-stop" role="status">
              {problem}
            </p>
          ) : null}
          <Composer
            value={text}
            onChange={setText}
            onSend={() => send()}
            busy={busy}
            disabled={!canAct || starting}
            label="Message your agent"
            placeholder={!canAct ? "This is a recording. Switch to Live in Admin to talk to your agent." : asking && answer?.question ? "Your answer" : "Message your agent"}
          />
          <p className="m-0 px-1 text-xs text-muted-foreground">
            {asking
              ? "Today your team can buy solar panels on the XRP test ledger, with test dollars. No real money is involved."
              : 'Ask anything, or say what your negotiator should do, such as "Ask about the warranty". Your agent cannot pay: only your Yes on a recommendation locks a payment.'}
          </p>
        </footer>
      </section>

      {rail ? <DealRail record={record} view={view} cards={cards} canWrapUp={live === true && !wrapped} onOpen={setOpenSupplier} onWrapUp={wrapUp} /> : null}

      {record && view ? <SupplierPanel record={record} view={view} card={openCard} canAct={canAct} onClose={() => setOpenSupplier(null)} /> : null}
      <SettingsPanel record={asking ? null : record} open={settings} canAct={canAct} onClose={() => setSettings(false)} />
      <LimitsPanel record={record} open={limits} onClose={() => setLimits(false)} />
      <QuickActions open={quick} actions={actions} onClose={() => setQuick(false)} onProblem={setProblem} />
    </div>
  );
}
