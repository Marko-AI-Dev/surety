import { type ReactNode, useId } from "react";
import { GLOSSARY, type TermKey } from "../data/plain";
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

// One of Surety's own words, with its meaning a hover, a focus or a tap away.
export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const id = useId();
  const g = GLOSSARY[k];
  return (
    <span className="term" tabIndex={0} aria-describedby={id}>
      {children ?? g.name}
      <span className="term-pop" role="tooltip" id={id}>
        <strong>{g.name}.</strong> {g.means}
      </span>
    </span>
  );
}

// The detail behind a plain sentence. Closed until asked for; the panel grows to hold it.
export function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="more">
      <summary>{label}</summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

export function TxLink({ tx, label }: { tx: LedgerTx; label: string }) {
  return (
    <a className="tx" href={tx.explorer} target="_blank" rel="noreferrer">
      <span>{label}</span>
      <span className="mono">{shortHash(tx.txHash)}</span>
      <span className="ok" title={`Ledger ${tx.ledgerIndex}, result ${tx.result}`}>
        {tx.validated && tx.result === "tesSUCCESS" ? "Confirmed on the ledger" : tx.result}
      </span>
    </a>
  );
}

export function Panel({ title, note, children, wide }: { title: string; note?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? "panel panel-wide" : "panel"}>
      <header className="panel-head">
        <h3>{title}</h3>
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
