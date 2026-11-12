import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, type InspectorClient, type InspectorDeal, createInspectorClient } from "../data/live";
import type { Inspection } from "../data/types";
import { Chip, Waiting } from "./bits";

// The inspector's page, built for a phone. A person, not an agent, holds this second key: they read
// the shipping document number off the shipment and send it. The queue never shows the number the
// supplier submitted, so the reading is the inspector's own. One answer per deal, and it cannot be
// corrected, so the page reads the number back before it is sent.

// What the inspector is about to send, in the words the confirmation shows.
export function confirmLine(blNumber: string, outcome: "attested" | "refused"): string {
  const n = blNumber.trim();
  return outcome === "attested" ? `You read ${n} and the shipment is in order. Send?` : `You read ${n} and you are refusing this shipment. Send?`;
}

export function Inspector({ token, client: given }: { token: string | null; client?: InspectorClient }) {
  const client = useMemo<InspectorClient | null>(() => given ?? (token ? createInspectorClient((u, i) => fetch(u, i), token) : null), [given, token]);
  const [queue, setQueue] = useState<InspectorDeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [blNumber, setBlNumber] = useState("");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<"attested" | "refused" | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ deal: InspectorDeal; result: Inspection } | null>(null);

  useEffect(() => {
    if (!client) return;
    let stopped = false;
    const poll = async () => {
      try {
        const q = await client.queue();
        if (stopped) return;
        setQueue(q);
        setError(null);
      } catch (e) {
        if (!stopped) setError(e instanceof ApiError ? e.message : "The Surety API is not reachable.");
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 3000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [client]);

  if (!client) {
    return (
      <div className="seat glass">
        <header className="seat-head">
          <h2>Inspector</h2>
        </header>
        <p className="banner" data-tone="held">
          This page needs the inspector's link from the operator. It carries the inspector's token after the # of the address, so it is never sent in a
          request line or stored.
        </p>
      </div>
    );
  }

  const deal = queue?.find((d) => d.dealId === dealId) ?? (queue?.length === 1 ? queue[0] : undefined);
  const ready = blNumber.trim().length > 0 && blNumber.trim().length <= 120;
  const ask = (e: FormEvent, outcome: "attested" | "refused") => {
    e.preventDefault();
    if (ready) setAsking(outcome);
  };
  const send = async () => {
    if (!deal || !asking) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.attest(deal.dealId, { blNumber: blNumber.trim(), outcome: asking, note: note.trim() });
      setSent({ deal, result });
      setBlNumber("");
      setNote("");
      setDealId(null);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.status === 409
            ? `This deal already has an answer, or it can no longer take one. ${e.message}`
            : e.message
          : "That did not go through. Nothing was sent.",
      );
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  return (
    <div className="seat glass">
      <header className="seat-head">
        <h2>Inspector</h2>
        <p className="panel-note">You hold the second key. Read the shipping document number off the shipment itself, then send it. Nobody is paid without your answer.</p>
      </header>

      {error ? (
        <p className="banner" data-tone="stop" role="alert">
          {error}
        </p>
      ) : null}

      {sent ? (
        <section className="seat-card" data-tone={sent.result.state === "attested" ? "ok" : "stop"} role="status">
          <h3>{sent.result.state === "attested" ? "Sent. You confirmed the shipment." : "Sent. You refused the shipment."}</h3>
          <p className="fine">
            {sent.deal.poNumber}, {sent.deal.supplierName}. You read <span className="mono">{sent.result.blNumber}</span>.{" "}
            {sent.result.state === "attested"
              ? "If it matches the supplier's paperwork, the money is released. If it does not, the buyer is refunded."
              : "Nothing will be paid. The ledger returns the money to the buyer at the deadline."}
          </p>
        </section>
      ) : null}

      {queue === null ? (
        <Waiting>Loading the shipments waiting for you.</Waiting>
      ) : queue.length === 0 ? (
        <Waiting>No shipment is waiting for you. One appears here as soon as a payment is locked.</Waiting>
      ) : (
        <>
          <h3>Waiting for you</h3>
          <ul className="lane-list">
            {queue.map((d) => (
              <li key={d.dealId}>
                <button type="button" className="lane-row" aria-pressed={deal?.dealId === d.dealId} onClick={() => setDealId(d.dealId)}>
                  <span className="lane-row-name">{d.supplierName}</span>
                  <span className="lane-row-last">
                    {d.quantity.toLocaleString("en-US")} x {d.goods}, {d.incoterm} {d.port}
                  </span>
                  <span className="lane-row-count">
                    Order {d.poNumber} <Chip tone="money">Money locked</Chip>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {deal && !asking ? (
        <form className="composer" onSubmit={(e) => ask(e, "attested")}>
          <label className="field">
            <span>Shipping document (B/L) number, as printed on the shipment</span>
            <input
              type="text"
              className="bl-input"
              value={blNumber}
              onChange={(e) => setBlNumber(e.target.value)}
              maxLength={120}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
            />
          </label>
          <label className="field">
            <span>Note (optional)</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="400 cartons counted, seal intact" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            Confirm the shipment
          </button>
          <button type="button" className="btn" disabled={!ready} onClick={(e) => ask(e, "refused")}>
            Refuse the shipment
          </button>
          <p className="fine">You can answer once for each deal, and the answer cannot be changed.</p>
        </form>
      ) : null}

      {deal && asking ? (
        <section className="seat-card confirm" data-tone={asking === "attested" ? "money" : "stop"} role="alertdialog" aria-label="Check before sending">
          <h3>Check before sending</h3>
          <p className="seat-big mono">{blNumber.trim()}</p>
          <p>{confirmLine(blNumber, asking)}</p>
          <p className="fine">
            {deal.supplierName}, order {deal.poNumber}. This cannot be changed afterwards.
          </p>
          <div className="confirm-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send()}>
              {busy ? "Sending" : asking === "attested" ? "Yes, send it" : "Yes, refuse it"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setAsking(null)}>
              Go back and edit
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
