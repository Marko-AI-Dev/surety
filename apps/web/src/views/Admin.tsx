import { type ReactNode, useState } from "react";
import { adminLog } from "../data/desk";
import { ApiError, askAdmin } from "../data/live";
import type { RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { Speak } from "./Desk";
import { Chip, TxLink, Waiting } from "./bits";

// The admin portal: everything that is not the buyer's one screen. A plain-words log of what happened,
// an assistant that answers from the records, and the older technical views (control room, attack lab,
// supplier seat, recordings), kept out of the main menu.

export type AdminTab = "log" | "how" | "ledger" | "ask" | "control" | "attacks" | "seat" | "classic" | "display";
export const ADMIN_TABS: { id: AdminTab; hash: string; label: string }[] = [
  { id: "log", hash: "#/admin", label: "What happened" },
  { id: "how", hash: "#/admin/how", label: "How Surety works" },
  { id: "ledger", hash: "#/admin/ledger", label: "Escrow ledger" },
  { id: "ask", hash: "#/admin/ask", label: "Ask" },
  { id: "control", hash: "#/admin/control", label: "Control room" },
  { id: "attacks", hash: "#/admin/attacks", label: "Attack lab" },
  { id: "seat", hash: "#/admin/seat", label: "Supplier seat" },
  // The buyer's screen before the chat (13 Nov), kept until it is no longer wanted.
  { id: "classic", hash: "#/admin/classic", label: "Classic view" },
  { id: "display", hash: "#/admin/display", label: "Recordings and display" },
];

export function AdminNav({ tab }: { tab: AdminTab }) {
  return (
    <nav className="admin-nav glass" aria-label="Admin">
      {ADMIN_TABS.map((t) => (
        <a key={t.id} href={t.hash} aria-current={t.id === tab ? "page" : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

export function Log({ record, view }: { record: SourcingRecord | null; view: RunView | null }) {
  if (!record || !view) return <Waiting>No purchase on record yet.</Waiting>;
  const entries = adminLog(record, view);
  return (
    <section className="desk-card glass">
      <h1>What happened</h1>
      <p className="desk-lead">
        Purchase {record.sourcing.ref}: every message, every agent's move, every check and every payment, oldest first. Times are UTC.
      </p>
      <ol className="log">
        {entries.map((e) => (
          <li key={e.key} data-tone={e.tone}>
            <time>{e.time}</time>
            <strong>{e.who}</strong>
            <span>
              {e.what} {e.tx ? <TxLink tx={e.tx} label="See it on the XRP Ledger" /> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const IDEAS = ["What happened with the last purchase?", "How far is the payment?", "Was any supplier removed, and why?", "What did the inspector say?"];

export function AskAdmin({ canAsk }: { canAsk: boolean }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<{ q: string; a: string; basedOn: string[]; failed?: boolean }[]>([]);
  const ask = async (q: string) => {
    const asked = q.trim();
    if (!asked || busy) return;
    setBusy(true);
    setQuestion("");
    try {
      const r = await askAdmin((u, i) => fetch(u, i), asked);
      setTurns((t) => [...t, { q: asked, a: r.answer, basedOn: r.basedOn }]);
    } catch (e) {
      const missing = e instanceof ApiError && (e.status === 404 || e.status === 403 || e.status === 0);
      setTurns((t) => [...t, { q: asked, a: missing ? "The assistant is not connected on this machine." : e instanceof ApiError ? e.message : "That did not go through.", basedOn: [], failed: true }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="desk-card glass">
      <h1>Ask about a purchase</h1>
      <p className="desk-lead">
        Ask in your own words. The assistant answers from the records of the last five purchases and nothing else. It is an AI model, so check anything important against the log. It can read; it cannot change anything.
      </p>
      {!canAsk ? <Waiting>The assistant needs the live backend. It is not available on a recording.</Waiting> : null}
      <ol className="talk" aria-live="polite">
        {turns.map((t, i) => (
          <li key={`${i}-${t.q}`} data-who="team" data-failed={t.failed || undefined}>
            <span className="talk-who">You asked: {t.q}</span>
            <p>{t.a}</p>
            {t.basedOn.length > 0 ? <span className="fine">From the records of {t.basedOn.join(", ")}</span> : null}
          </li>
        ))}
      </ol>
      <form
        className="say"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label className="visually-hidden" htmlFor="ask-box">
          Your question
        </label>
        <textarea id="ask-box" rows={2} value={question} placeholder="Your question" onChange={(e) => setQuestion(e.target.value)} disabled={!canAsk} />
        <Speak onText={(t) => setQuestion(question ? `${question} ${t}` : t)} disabled={!canAsk || busy} />
        <button type="submit" className="btn btn-primary" disabled={!canAsk || busy || !question.trim()}>
          {busy ? "Reading the records" : "Ask"}
        </button>
      </form>
      <p className="ideas">
        {IDEAS.map((q) => (
          <button key={q} type="button" className="btn" onClick={() => void ask(q)} disabled={!canAsk || busy}>
            {q}
          </button>
        ))}
      </p>
    </section>
  );
}

export function Display({ children }: { children: ReactNode }) {
  return (
    <section className="desk-card glass">
      <h1>Recordings and display</h1>
      <p className="desk-lead">
        The main screen shows the live purchase. Here you can switch it to a recording of a real test purchase, which is always marked <Chip tone="held">Recorded</Chip> on screen.
      </p>
      {children}
    </section>
  );
}
