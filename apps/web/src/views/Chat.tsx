import { ArrowUp, ChevronRight, Settings2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type FeedItem, type FeedTone, type SupplierCard, agentStatus, chatFeed, supplierCards } from "../data/chat";
import { deskStage, threadOf } from "../data/desk";
import { utcTime } from "../data/format";
import { ApiError, type Draft, type IntakeAnswer, answerDraft, askWrapUp, readNeed, sendChat, setControls, startPurchase, writeToSupplier } from "../data/live";
import type { RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { Review, Speak, Track, understood } from "./Desk";

// The buyer's one screen: a chat with their own agent. You say what you need, it asks about anything
// missing and puts the team to work, and from then on everything that happens arrives here as a
// message: each price as it moves, a message Surety stopped, a message waiting for your approval, the
// recommendation with Yes and No, and the order after the yes. The text box is always at the bottom
// and is never taken away. Each supplier's conversation opens in a side panel.

const api = (url: string, init?: Parameters<typeof fetch>[1]) => fetch(url, init);
// The buyer's decide-by time in this build: the latest a negotiation may run. It is a backstop, not a
// countdown: the agents come back as soon as a supplier meets the brief or the buyer asks.
const DECIDE_BY_SECONDS = 1800;
const DRAFT_KEY = "surety.chat.unsent";
const problemOf = (e: unknown) => (e instanceof ApiError ? e.message : "That did not go through. Please try again.");

interface LocalLine {
  who: "you" | "agent";
  text: string;
  at: number;
}

const DOT: Record<FeedTone, string> = { plain: "bg-muted-foreground", ok: "bg-ok", held: "bg-held", stop: "bg-stop", money: "bg-money" };

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

// A message the negotiator wrote that waits for the buyer: read it, change it, send it or throw it away.
function DraftCard({ id, name, text, canAct }: { id: string; name: string; text: string; canAct: boolean }) {
  const [value, setValue] = useState(text);
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const answer = async (action: "send" | "discard") => {
    setBusy(action);
    setProblem(null);
    try {
      const changed = value.trim() !== text.trim();
      await answerDraft(api, id, action, action === "send" && changed ? value.trim() : undefined);
    } catch (e) {
      setProblem(problemOf(e));
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-held/60 bg-card p-3">
      <p className="m-0 text-sm font-medium">Your negotiator wants to send this to {name}</p>
      <Textarea aria-label={`Message to ${name}`} value={value} onChange={(e) => setValue(e.target.value)} disabled={!canAct || busy !== null} rows={3} maxLength={1000} className="min-h-20 bg-background text-[0.95rem]" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => answer("send")} disabled={!canAct || busy !== null || !value.trim()}>
          {busy === "send" ? "Sending" : value.trim() !== text.trim() ? "Send my wording" : "Send as written"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => answer("discard")} disabled={!canAct || busy !== null}>
          {busy === "discard" ? "Throwing away" : "Don't send"}
        </Button>
        <span className="text-xs text-muted-foreground">Nothing goes to {name} until you send it.</span>
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
    <form onSubmit={submit} className="flex items-end gap-2 rounded-2xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/60">
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
      <Button type="submit" size="icon" disabled={busy || disabled || !value.trim()} aria-label={busy ? "Sending" : "Send"} className="rounded-full">
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
        <SheetHeader className="border-b">
          <SheetTitle>{card?.name ?? "Supplier"}</SheetTitle>
          <SheetDescription>{card?.line}. You see every message. Nothing said here can move money.</SheetDescription>
        </SheetHeader>
        <ol className="m-0 flex flex-1 list-none flex-col gap-3 overflow-y-auto p-4">
          {mails.length === 0 ? <li className="text-sm text-muted-foreground">No messages yet.</li> : null}
          {mails.map((m) =>
            m.held ? (
              <li key={m.key} className={cn("rounded-xl border p-3 text-sm", m.held.tone === "stop" ? "border-stop/60" : "border-held/60")}>
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
          <div className="flex flex-col gap-1.5 border-t p-3">
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
function SettingsPanel({ record, open, canAct, onClose }: { record: SourcingRecord; open: boolean; canAct: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const controls = record.controls ?? { autonomy: record.sourcing.brief.autonomy ?? "full", push: record.sourcing.brief.push ?? "firm", wrapUpAt: null };
  const live = canAct && record.sourcing.state === "OPEN";
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
        <SheetHeader className="border-b">
          <SheetTitle>How your negotiator works</SheetTitle>
          <SheetDescription>You can change this at any time while the negotiation runs.</SheetDescription>
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
            <Switch checked={controls.autonomy === "approve"} disabled={!live || busy} onCheckedChange={(on) => run(() => setControls(api, record.sourcing.id, { autonomy: on ? "approve" : "full" }))} aria-label="I approve every message first" />
          </label>
          <div className="flex flex-col gap-2">
            <span className="font-medium">How hard it pushes on price</span>
            <div className="flex gap-2">
              {(["gentle", "firm"] as const).map((p) => (
                <Button key={p} type="button" size="sm" variant={controls.push === p ? "default" : "outline"} aria-pressed={controls.push === p} disabled={!live || busy} onClick={() => run(() => setControls(api, record.sourcing.id, { push: p }))}>
                  {p === "gentle" ? "Gently" : "Firmly"}
                </Button>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">{controls.push === "gentle" ? "It asks once and never presses a supplier that says no." : "It uses competing offers every round until a supplier holds its price."}</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-medium">Stop negotiating and decide</span>
            <Button type="button" variant="outline" disabled={!live || busy || controls.wrapUpAt !== null} onClick={() => run(() => askWrapUp(api, record.sourcing.id))} className="self-start">
              {controls.wrapUpAt ? "Asked. Getting final quotes" : "Bring me what you have"}
            </Button>
            <span className="text-sm text-muted-foreground">Your negotiator asks every supplier for its final quote, and your agent brings you its recommendation. Nothing is paid until you say yes.</span>
          </div>
          {!live ? <p className="m-0 text-sm text-muted-foreground">{canAct ? "This negotiation is over, so these can no longer be changed." : "This is a recording, so these cannot be changed."}</p> : null}
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

  // A new purchase appeared: what was typed for the last one is done with.
  useEffect(() => {
    if (startedFor !== null && startedFor !== currentId) {
      setStartedFor(null);
      setAgain(false);
      setLocal([]);
      setAnswer(null);
    }
  }, [startedFor, currentId]);

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

  const send = async () => {
    const said = text.trim();
    setBusy(true);
    setProblem(null);
    say("you", said);
    setText("");
    try {
      if (asking) {
        const next = await readNeed(api, { text: said, ...(answer ? { draft: answer.draft } : {}), ...(answer?.question ? { field: answer.question.field } : {}) });
        setAnswer(next);
        say("agent", next.question ? next.question.ask : "Thank you. Here is what I understood. If it is right, I will put the team to work.");
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

  if (!record && !canAct) {
    return (
      <section className="desk-card glass">
        <h1>No purchase to show</h1>
        <p className="desk-lead">Connect the live backend to talk to your agent, or pick a recording in Admin.</p>
      </section>
    );
  }

  const lines = answer ? understood(answer.draft) : [];
  const status = asking ? "Ready when you are." : starting ? "Opening your purchase." : record && view ? agentStatus(record, view) : "";
  const openCard = cards.find((c) => c.address === openSupplier) ?? null;

  return (
    <section className="tw glass mx-auto flex h-[calc(100dvh-7rem)] min-h-[30rem] w-full max-w-3xl flex-col overflow-hidden rounded-xl text-foreground" aria-label="Your agent">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
          A
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-base font-semibold leading-tight">Your agent</h1>
          <p className="m-0 truncate text-sm text-muted-foreground" aria-live="polite">
            {status}
          </p>
        </div>
        {record && !asking ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setSettings(true)}>
            <Settings2 /> <span className="max-sm:sr-only">Negotiator</span>
          </Button>
        ) : null}
      </header>

      {cards.length > 0 ? (
        <nav className="flex gap-2 overflow-x-auto border-b px-4 py-2.5" aria-label="Supplier conversations">
          {cards.map((c) => (
            <button
              key={c.address}
              type="button"
              onClick={() => setOpenSupplier(c.address)}
              className={cn("flex shrink-0 cursor-pointer items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-left text-sm hover:bg-accent", c.tone === "stop" && "border-stop/60", c.tone === "held" && "border-held/70", c.tone === "money" && "border-money/60")}
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
            What do you need to buy? Tell me in your own words. I will ask about anything missing, then find suppliers and negotiate for you. Nothing is paid without your yes.
          </Bubble>
        ) : null}
        {asking && local.length === 0 ? (
          <li className="px-1 text-sm text-muted-foreground">
            For example: <em>"I need 400 solar panels. I'd like to pay about $110 each and no more than $120. I need them within 30 days."</em>
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
          <li className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            <p className="m-0 font-medium">{answer?.ready ? "Here is what I understood" : "So far I have"}</p>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[0.95rem]">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {answer?.ready ? (
              <>
                <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">Let me approve every message first</span>
                    <span className="text-sm text-muted-foreground">{approveFirst ? "Each message to a supplier waits for you. You can change it before it goes." : "Your negotiator writes to suppliers on its own. You can switch this on later."}</span>
                  </span>
                  <Switch checked={approveFirst} onCheckedChange={setApproveFirst} aria-label="Let me approve every message first" />
                </label>
                <Button type="button" size="lg" onClick={start} disabled={busy} className="self-start">
                  {busy ? "Starting" : "Put my team to work"}
                </Button>
                <p className="m-0 text-sm text-muted-foreground">
                  There is no timer. Your team negotiates until a supplier meets your price and delivery time, or until you ask for what they have. In this demo it stops after {DECIDE_BY_SECONDS / 60} minutes at the latest. To change something, just
                  say it below.
                </p>
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
            Your agent is thinking<span className="typing-dots" aria-hidden="true" />
          </li>
        ) : null}
        <div ref={end} />
      </ol>

      <footer className="flex flex-col gap-1.5 border-t px-4 py-3">
        {canAct && finished && !again ? (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAgain(true)}>
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
          onSend={send}
          busy={busy}
          disabled={!canAct || starting}
          label="Message your agent"
          placeholder={
            !canAct
              ? "This is a recording. Switch to Live in Admin to talk to your agent."
              : asking
                ? answer?.question
                  ? "Your answer"
                  : answer?.ready
                    ? "Change something, or press the button above"
                    : "Say what you need"
                : "Message your agent"
          }
        />
        <p className="m-0 px-1 text-xs text-muted-foreground">
          {asking ? "Today your team can buy solar panels on the XRP test ledger, with test dollars. No real money is involved." : 'Ask anything, or say what your negotiator should do, such as "Ask about the warranty". Your agent cannot pay: only your Yes on a recommendation locks a payment.'}
        </p>
      </footer>

      {record && view ? <SupplierPanel record={record} view={view} card={openCard} canAct={canAct} onClose={() => setOpenSupplier(null)} /> : null}
      {record ? <SettingsPanel record={record} open={settings} canAct={canAct} onClose={() => setSettings(false)} /> : null}
    </section>
  );
}
