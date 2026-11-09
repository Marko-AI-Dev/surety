import type { ReactNode } from "react";
import { shortHash } from "../data/format";
import type { Card, LedgerTx } from "../data/types";

export function CardMark({ card }: { card: Card }) {
  return <span className="cardmark" data-card={card} role="img" aria-label={`${card} card`} />;
}

export function Cards({ yellow, red }: { yellow: number; red: number }) {
  if (yellow + red === 0) return null;
  return (
    <span className="cards">
      {Array.from({ length: yellow }, (_, i) => (
        <CardMark key={`y${i}`} card="yellow" />
      ))}
      {Array.from({ length: red }, (_, i) => (
        <CardMark key={`r${i}`} card="red" />
      ))}
    </span>
  );
}

// A score on a 0 to 1 track with the threshold it is judged against. `good` says which side passes.
export function Meter({ label, value, threshold, good }: { label: string; value: number | null | undefined; threshold: number; good: "above" | "below" }) {
  if (typeof value !== "number") {
    return (
      <div className="meter">
        <span className="meter-label">{label}</span>
        <span className="meter-value">not asked</span>
      </div>
    );
  }
  const pass = good === "above" ? value >= threshold : value <= threshold;
  return (
    <div className="meter" data-pass={pass}>
      <span className="meter-label">{label}</span>
      <span className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ width: `${value * 100}%` }} />
        <span className="meter-threshold" style={{ left: `${threshold * 100}%` }} />
      </span>
      <span className="meter-value">
        {value.toFixed(2)}
        <span className="meter-need">
          {" "}
          needs {good === "above" ? "at least" : "at most"} {threshold.toFixed(2)}
        </span>
      </span>
    </div>
  );
}

export function TxLink({ tx, label }: { tx: LedgerTx; label: string }) {
  return (
    <a className="tx" href={tx.explorer} target="_blank" rel="noreferrer">
      <span>{label}</span>
      <span className="mono">{shortHash(tx.txHash)}</span>
      <span>ledger {tx.ledgerIndex}</span>
      <span className="ok">{tx.result}</span>
    </a>
  );
}

export function Panel({ title, note, children, wide }: { title: string; note?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? "panel panel-wide" : "panel"}>
      <header className="panel-head">
        <h2>{title}</h2>
        {note ? <p className="panel-note">{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Waiting({ children }: { children: ReactNode }) {
  return <p className="waiting">{children}</p>;
}

export function Chip({ tone, children }: { tone: "ok" | "held" | "stop" | "money" | "plain"; children: ReactNode }) {
  return (
    <span className="chip" data-tone={tone}>
      {children}
    </span>
  );
}
