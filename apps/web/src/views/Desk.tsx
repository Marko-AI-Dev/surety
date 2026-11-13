import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { dealStages } from "../data/buyer";
import { type DeskStage, type Mail, deskStage, openThread, reviewOf, threadOf, trackerOf } from "../data/desk";
import { usd, utcTime } from "../data/format";
import { ApiError, type Draft, type IntakeAnswer, answerDeal, readNeed, sendNote, startPurchase } from "../data/live";
import { chatRows, headline } from "../data/livescreen";
import { statusLine } from "../data/plain";
import { type RunView, silentUnnamed } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { Numbers, Stages } from "./Business";
import { Start } from "./Start";
import { Chip, TxLink } from "./bits";

// The buyer's desk: the whole product on one screen. You say what you need in plain words, your team
// asks about anything missing and goes to work, you watch the conversations with yourself copied in,
// and when a deal is ready your Lead agent comes to you for the final yes. Only that yes locks the
// payment. After it, the deal is followed like a parcel.

const api = (url: string, init?: Parameters<typeof fetch>[1]) => fetch(url, init);
// How long the agents negotiate in this build. Said on screen wherever it matters.
const DEMO_NEGOTIATION_SECONDS = 180;

// ---------- dictation: the browser's own speech recognition, where it has one

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
function recognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function Speak({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const Ctor = useMemo(recognition, []);
  useEffect(() => () => rec.current?.stop(), []);
  if (!Ctor) return null;
  const toggle = () => {
    if (listening) return rec.current?.stop();
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((x) => x[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (said) onText(said);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };
  return (
    <button type="button" className="btn speak" aria-pressed={listening} onClick={toggle} disabled={disabled} title="Say it instead of typing. Uses your browser's speech service">
      {listening ? "Listening" : "Speak"}
    </button>
  );
}

function Say({ value, onChange, onSend, placeholder, busy, send = "Send" }: { value: string; onChange: (v: string) => void; onSend: () => void; placeholder: string; busy: boolean; send?: string }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !busy) onSend();
  };
  return (
    <form className="say" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="say-box">
        {placeholder}
      </label>
      <textarea
        id="say-box"
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) submit(e);
        }}
      />
      <Speak onText={(t) => onChange(value ? `${value} ${t}` : t)} disabled={busy} />
      <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
        {busy ? "One moment" : send}
      </button>
    </form>
  );
}

// ---------- ask: say what you need

const PRIORITY_WORDS = { price: "the lowest price", speed: "the fastest delivery", balanced: "a balance of price and speed" } as const;

function understood(d: Draft): string[] {
  const lines: string[] = [];
  if (d.quantity !== undefined) lines.push(`${d.quantity.toLocaleString("en-US")} solar panels (550 W), delivered to Durban`);
  if (d.targetUnitCents !== undefined) lines.push(`Aim for ${usd(d.targetUnitCents)} a panel`);
  if (d.maxUnitCents !== undefined) lines.push(`Never pay more than ${usd(d.maxUnitCents)} a panel${d.quantity !== undefined ? `, so at most ${usd(d.maxUnitCents * d.quantity, { decimals: false })} in all` : ""}`);
  if (d.latestDeliveryDays !== undefined) lines.push(`Delivered within ${d.latestDeliveryDays} days`);
  if (d.priority !== undefined) lines.push(`What matters most: ${PRIORITY_WORDS[d.priority]}`);
  if (d.push !== undefined) lines.push(`Your negotiator pushes ${d.push === "firm" ? "firmly" : "gently"}`);
  return lines;
}

function Ask({ onStarted }: { onStarted: () => void }) {
  const [talk, setTalk] = useState<{ who: "you" | "team"; text: string }[]>([]);
  const [answer, setAnswer] = useState<IntakeAnswer | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // An older backend has no plain-words route: fall back to the plain form.
  const [form, setForm] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Newer browsers return a promise from scrollIntoView, so the effect must not return it.
    if (talk.length > 0) void end.current?.scrollIntoView?.({ block: "nearest" });
  }, [talk]);

  const send = async () => {
    const said = text.trim();
    setBusy(true);
    setProblem(null);
    setTalk((t) => [...t, { who: "you", text: said }]);
    setText("");
    try {
      const next = await readNeed(api, { text: said, ...(answer ? { draft: answer.draft } : {}), ...(answer?.question ? { field: answer.question.field } : {}) });
      setAnswer(next);
      setTalk((t) => [...t, { who: "team", text: next.question ? next.question.ask : "Thank you. Here is what I understood. If it is right, I will put the team to work." }]);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setForm(true);
      else setProblem(e instanceof ApiError ? e.message : "That did not go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!answer?.ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const d = answer.draft as Required<Draft>;
      await startPurchase(api, { ...d, negotiationSeconds: DEMO_NEGOTIATION_SECONDS });
      onStarted();
    } catch (e) {
      setProblem(
        e instanceof ApiError && e.status === 404
          ? "This screen is not connected to your agent team on this machine yet."
          : e instanceof ApiError
            ? e.message
            : "That did not go through. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (form) return <Start waiting="No purchase is running." />;
  const lines = answer ? understood(answer.draft) : [];
  return (
    <section className="desk-card glass ask">
      <h1>What do you need to buy?</h1>
      <p className="desk-lead">Tell your purchasing team in your own words. They will ask about anything missing, then find suppliers and negotiate for you. Nothing is paid without your yes.</p>
      {talk.length > 0 ? (
        <ol className="talk" aria-live="polite">
          {talk.map((l, i) => (
            <li key={`${i}-${l.who}`} data-who={l.who}>
              <span className="talk-who">{l.who === "you" ? "You" : "Your purchasing team"}</span>
              <p>{l.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="example">
          For example: <em>"I need 400 solar panels. I'd like to pay about $110 each and no more than $120. I need them within 30 days."</em>
        </p>
      )}
      <div ref={end} />
      {lines.length > 0 ? (
        <div className="understood">
          <h2>{answer?.ready ? "Here is what I understood" : "So far I have"}</h2>
          <ul>
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {answer?.ready ? (
            <>
              <p className="fine">
                Your team asks the suppliers on your approved list. In this demo they negotiate for {DEMO_NEGOTIATION_SECONDS / 60} minutes; in the product, for days. To change something, just say it below.
              </p>
              <button type="button" className="btn btn-primary btn-big" onClick={start} disabled={busy}>
                {busy ? "Starting" : "Put my team to work"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <Say value={text} onChange={setText} onSend={send} busy={busy} placeholder={answer?.question ? "Your answer" : answer?.ready ? "Change something, or leave this empty" : "Say what you need"} />
      {problem ? (
        <p className="banner" data-tone="stop" role="status">
          {problem}
        </p>
      ) : null}
      <p className="fine">Today the team can buy solar panels on the XRP test ledger, with test dollars. No real money is involved.</p>
    </section>
  );
}

// ---------- the conversations, as email threads with you copied in

function MailCard({ m }: { m: Mail }) {
  return (
    <li className="mail" data-mine={m.mine || undefined} data-held={m.held ? m.held.tone : undefined}>
      <p className="mail-head">
        <span>
          <strong>{m.from}</strong> to {m.to}
        </span>
        <span className="mail-cc">Copy to you</span>
        <time>{utcTime(m.at)}</time>
      </p>
      {m.held ? (
        <p className="mail-held">
          {m.held.card ? <Chip tone={m.held.card === "red" ? "stop" : "held"}>{m.held.card === "red" ? "Red card" : "Yellow card"}</Chip> : null} Surety stopped this message before your agents could read it. {m.held.text}
        </p>
      ) : (
        <p className="mail-body">{m.body}</p>
      )}
    </li>
  );
}

function Threads({ record, view, canNudge }: { record: SourcingRecord; view: RunView; canNudge: boolean }) {
  const hidden = new Set(view.invites.filter(silentUnnamed).map((i) => i.address));
  const rows = chatRows(record, view).filter((r) => r.kind === "supplier" && !hidden.has(r.id));
  const [picked, setPicked] = useState<string | null>(null);
  const open = openThread(view, rows.map((r) => r.id), picked);
  const mails = open ? threadOf(record, view, open) : [];
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const notes = record.buyerNotes ?? [];

  const nudge = async () => {
    setBusy(true);
    setSaid(null);
    try {
      await sendNote(api, record.sourcing.id, note.trim());
      setNote("");
      setSaid("Sent. Your negotiator sees your notes each time it checks this purchase.");
    } catch (e) {
      setSaid(e instanceof ApiError ? e.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="desk-card glass">
      <h2>The conversations</h2>
      <p className="desk-lead">Your negotiator writes to each supplier, and you are copied in on everything. Nothing said here can move money.</p>
      {rows.length === 0 ? (
        <p className="fine">Your Sourcing agent is inviting the suppliers on your approved list.</p>
      ) : (
        <div className="threads">
          <ul className="thread-list" aria-label="Suppliers">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" aria-pressed={r.id === open} onClick={() => setPicked(r.id)}>
                  <strong>{r.title}</strong>
                  <span className="thread-meta">
                    {r.status === "out" ? <Chip tone="stop">Removed</Chip> : r.priceCents !== null ? <Chip tone={r.committed ? "money" : "plain"}>{r.committed ? "Final price" : "Says"} {usd(r.priceCents)}</Chip> : <Chip tone="plain">No price yet</Chip>}
                  </span>
                  <span className="thread-last">{r.last}</span>
                </button>
              </li>
            ))}
          </ul>
          <ol className="thread" aria-live="polite">
            {mails.length === 0 ? <li className="fine">No messages yet.</li> : mails.map((m) => <MailCard key={m.key} m={m} />)}
          </ol>
        </div>
      )}
      {hidden.size > 0 && rows.length > 0 ? (
        <p className="fine">
          {hidden.size === 1 ? "One approved wallet" : `${hidden.size} approved wallets`} with no name in your supplier directory {hidden.size === 1 ? "was" : "were"} also invited and {hidden.size === 1 ? "has" : "have"} not answered. {hidden.size === 1 ? "It is" : "They are"} in the admin log.
        </p>
      ) : null}
      {notes.length > 0 ? (
        <ul className="my-notes">
          {notes.map((n) => (
            <li key={n.at}>
              <strong>You told your negotiator:</strong> {n.text}
            </li>
          ))}
        </ul>
      ) : null}
      {canNudge ? (
        <>
          <h3 className="nudge-title">Tell your negotiator something</h3>
          <Say value={note} onChange={setNote} onSend={nudge} busy={busy} placeholder='For example: "Ask about the warranty" or "Push harder on delivery time"' />
          {said ? (
            <p className="fine" role="status">
              {said}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

// ---------- the review: your Lead agent comes to you

function Review({ record, canAct }: { record: SourcingRecord; canAct: boolean }) {
  const review = reviewOf(record);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!review) return null;
  const answer = async (outcome: "approve" | "decline") => {
    setBusy(outcome);
    setProblem(null);
    try {
      await answerDeal(api, review.dealId, outcome);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "That did not go through. Please try again.");
      setBusy(null);
    }
  };
  const pick = review.pick;
  return (
    <section className="desk-card glass review">
      <p className="review-from">From your Lead agent</p>
      <h1>I'd like you to review {review.deals.length === 1 ? "this deal" : `these ${review.deals.length} deals`}.</h1>
      {pick ? (
        <p className="review-lean">
          I'm leaning towards <strong>{pick.name}</strong>, because: {review.reason || "it is the best fit for your brief."}
        </p>
      ) : null}
      <ul className="deals">
        {review.deals.map((d) => (
          <li key={d.supplier} data-pick={d.pick || undefined} data-off={!d.eligible || undefined}>
            <p className="deal-name">
              <strong>{d.name}</strong> {d.pick ? <Chip tone="money">My pick</Chip> : null} {!d.eligible ? <Chip tone="held">Outside your brief</Chip> : null}
            </p>
            <p className="deal-price num">{usd(d.unitCents)} a panel</p>
            <p className="deal-terms">
              {usd(d.totalCents)} in all{d.deliveryDays !== null ? `, delivered in ${d.deliveryDays} days` : ""}
            </p>
            {!d.eligible && d.why ? <p className="fine">{d.why}</p> : null}
          </li>
        ))}
      </ul>
      {canAct && pick ? (
        <div className="review-actions">
          <button type="button" className="btn btn-primary btn-big" onClick={() => answer("approve")} disabled={busy !== null}>
            {busy === "approve" ? "Locking the payment" : `Yes, buy from ${pick.name}`}
          </button>
          <button type="button" className="btn btn-big" onClick={() => answer("decline")} disabled={busy !== null}>
            {busy === "decline" ? "Saying no" : "No, don't buy"}
          </button>
        </div>
      ) : null}
      <p className="fine">
        Nothing has been paid. If you say yes, {pick ? usd(pick.totalCents) : "the payment"} is locked on the XRP Ledger, not sent to the supplier. It is released only when the paperwork passes and an independent inspector confirms the
        shipment. Otherwise it comes back to you. If you say no, nothing moves.
      </p>
      {problem ? (
        <p className="banner" data-tone="stop" role="status">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

// ---------- the tracker: after the yes, the deal moves like a parcel

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Track({ record, view, now }: { record: SourcingRecord; view: RunView; now: number }) {
  const t = trackerOf(record, view, now);
  if (!t) return null;
  return (
    <section className="desk-card glass track">
      <h2>Your order from {t.supplier}</h2>
      <p className="desk-lead">
        {usd(t.totalCents)}
        {t.blNumber ? (
          <>
            {" "}
            · Shipping document <span className="mono">{t.blNumber}</span>, confirmed by the inspector
          </>
        ) : null}
      </p>
      {t.lockedAt !== null && t.promisedAt !== null && !view.refunded ? (
        <div className="track-bar" role="img" aria-label={`Paid on ${day(t.lockedAt)}. Delivery promised by ${day(t.promisedAt)}.`}>
          <div className="track-line">
            <span className="track-fill" style={{ width: `${Math.max(2, t.progress * 100)}%` }} />
          </div>
          <p className="track-ends">
            <span>
              Payment locked
              <br />
              <strong>{day(t.lockedAt)}</strong>
            </span>
            <span>
              Delivery promised by
              <br />
              <strong>{day(t.promisedAt)}</strong>
            </span>
          </p>
        </div>
      ) : null}
      <ol className="track-steps">
        {t.steps.map((s) => (
          <li key={s.id} data-state={s.state}>
            <span className="track-dot" aria-hidden="true" />
            <div>
              <p className="track-label">
                {s.label} {s.notTracked ? <Chip tone="plain">Not tracked on the test network yet</Chip> : null}
              </p>
              <p className="fine">{s.detail}</p>
              {s.tx ? <TxLink tx={s.tx} label="See it on the XRP Ledger" /> : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="quick">
        {["Message the seller", "Ask the shipping line where it is", "Report a problem"].map((label) => (
          <button key={label} type="button" className="btn" disabled title="Not built yet">
            {label} <span className="soon">Coming soon</span>
          </button>
        ))}
      </div>
      {!record.approval ? <p className="fine">This purchase was recorded before the buyer's final yes was added, so the Lead agent's choice locked the payment directly.</p> : null}
    </section>
  );
}

// ---------- the desk

function Headline({ tone, title, children }: { tone: "plain" | "ok" | "stop" | "money"; title: string; children?: ReactNode }) {
  return (
    <section className="desk-card glass desk-now" data-tone={tone}>
      <h1>{title}</h1>
      {children ? <p className="desk-lead">{children}</p> : null}
    </section>
  );
}

export function Desk({
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
  const stage: DeskStage = deskStage(record, view);
  // After a finished purchase the buyer can start another; and after Start, until the Lead opens it.
  const [again, setAgain] = useState(false);
  const [startedFor, setStartedFor] = useState<string | null>(null);
  const currentId = record?.sourcing.id ?? "none";
  const starting = startedFor !== null && startedFor === currentId;
  useEffect(() => {
    if (startedFor !== null && startedFor !== currentId) {
      setStartedFor(null);
      setAgain(false);
    }
  }, [startedFor, currentId]);

  if (starting) {
    return (
      <div className="desk">
        <Headline tone="money" title="Your team has the job.">
          Your Lead agent is opening the purchase and briefing the Sourcing agent and the Negotiator. It appears here within a minute.
        </Headline>
      </div>
    );
  }
  const finished = stage === "done" || stage === "refunded" || stage === "declined";
  if (canAct && (stage === "ask" || (finished && again))) {
    return (
      <div className="desk">
        <Ask onStarted={() => setStartedFor(currentId)} />
      </div>
    );
  }
  if (!record || !view) return null;
  const status = statusLine(record, view);
  const negotiating = stage === "working" && record.sourcing.state === "OPEN" && now < Date.parse(record.sourcing.negotiationEndsAt);
  const brief = record.sourcing.brief;
  return (
    <div className="desk">
      {stage === "review" ? (
        <Review record={record} canAct={canAct} />
      ) : stage === "declined" ? (
        <Headline tone="stop" title="You said no. Nothing was locked or paid.">
          Your money has not moved.
        </Headline>
      ) : (
        <Headline tone={status.tone === "ok" ? "ok" : status.tone === "stop" ? "stop" : status.tone === "money" ? "money" : "plain"} title={status.now}>
          {status.detail}
        </Headline>
      )}

      <section className="desk-card glass desk-facts">
        <p className="desk-brief">
          {brief.goods.quantity.toLocaleString("en-US")} x {brief.goods.description}, {brief.incoterm} {brief.port} · aim for {usd(brief.goods.targetUnitCents)}, at most {usd(brief.goods.maxUnitCents)} a panel
        </p>
        <Numbers h={headline(record, view)} />
        <Stages stages={dealStages(record, view)} thin />
      </section>

      {stage === "tracking" || stage === "done" || stage === "refunded" ? <Track record={record} view={view} now={now} /> : null}
      <Threads record={record} view={view} canNudge={canAct && negotiating} />

      {canAct && finished ? (
        <p className="desk-again">
          <button type="button" className="btn btn-primary" onClick={() => setAgain(true)}>
            Buy something else
          </button>
        </p>
      ) : null}
    </div>
  );
}
