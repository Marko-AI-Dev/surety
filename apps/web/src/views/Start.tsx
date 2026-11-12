import { type FormEvent, useState } from "react";
import { usd } from "../data/format";
import { ApiError, type StartBrief, startPurchase } from "../data/live";

// Start a purchase from the screen. The browser never holds the Lead agent's token: the button asks
// the backend's demo command to open the purchase, through the dev proxy, from this machine only.
// PROVISIONAL: the route (POST /demo/start) is this app's proposal and is not in the API yet. Until it
// is, the form says how to start a purchase from the terminal instead.
const DEFAULTS: StartBrief = { quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000, priority: "balanced", latestDeliveryDays: 30, negotiationSeconds: 180 };

export function validateBrief(b: StartBrief): string | null {
  if (!Number.isInteger(b.quantity) || b.quantity < 1) return "The quantity must be a whole number of at least 1.";
  if (b.targetUnitCents < 1 || b.maxUnitCents < 1) return "Both prices must be more than zero.";
  if (b.targetUnitCents > b.maxUnitCents) return "The price to aim for cannot be above the most you will pay.";
  if (!Number.isInteger(b.latestDeliveryDays) || b.latestDeliveryDays < 1 || b.latestDeliveryDays > 365) return "Delivery must be between 1 and 365 days.";
  if (!Number.isInteger(b.negotiationSeconds) || b.negotiationSeconds < 30 || b.negotiationSeconds > 3600) return "The negotiation must last between 30 seconds and an hour.";
  return null;
}

export function Start({ waiting }: { waiting: string }) {
  const [b, setB] = useState<StartBrief>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "plain" | "stop"; text: string } | null>(null);
  const problem = validateBrief(b);
  const dollars = (cents: number) => (cents / 100).toString();
  const cents = (v: string) => Math.round(Number(v) * 100);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    setMessage(null);
    try {
      await startPurchase((u, i) => fetch(u, i), b);
      setMessage({ tone: "plain", text: "Started. Your Lead agent is opening the purchase; it appears here in a few seconds." });
    } catch (err) {
      const missing = err instanceof ApiError && (err.status === 404 || err.status === 403 || err.status === 0);
      setMessage({
        tone: "stop",
        text: missing
          ? "This button needs the backend's start command, which is not connected yet. Start the purchase from the terminal with pnpm demo and it will appear here."
          : err instanceof ApiError
            ? err.message
            : "That did not go through.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="start glass">
      <header className="pane-head">
        <div>
          <h2>Start a purchase</h2>
          <p className="panel-note">{waiting} Set what your agents may buy and the most they may pay. They do the rest, and they cannot change these numbers.</p>
        </div>
      </header>
      <form className="start-form" onSubmit={submit}>
        <p className="brief-line">Monocrystalline solar panel 550 W, CIF Durban</p>
        <label className="field">
          <span>How many</span>
          <input type="text" inputMode="numeric" value={b.quantity} onChange={(e) => setB({ ...b, quantity: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Aim for, a unit (USD)</span>
          <input type="text" inputMode="decimal" defaultValue={dollars(b.targetUnitCents)} onChange={(e) => setB({ ...b, targetUnitCents: cents(e.target.value) })} />
        </label>
        <label className="field">
          <span>Pay at most, a unit (USD)</span>
          <input type="text" inputMode="decimal" defaultValue={dollars(b.maxUnitCents)} onChange={(e) => setB({ ...b, maxUnitCents: cents(e.target.value) })} />
        </label>
        <label className="field">
          <span>What matters most</span>
          <select value={b.priority} onChange={(e) => setB({ ...b, priority: e.target.value as StartBrief["priority"] })}>
            <option value="balanced">A balance of price and speed</option>
            <option value="price">The lowest price</option>
            <option value="speed">The fastest delivery</option>
          </select>
        </label>
        <label className="field">
          <span>Delivered within (days)</span>
          <input type="text" inputMode="numeric" value={b.latestDeliveryDays} onChange={(e) => setB({ ...b, latestDeliveryDays: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Negotiate for (seconds)</span>
          <input type="text" inputMode="numeric" value={b.negotiationSeconds} onChange={(e) => setB({ ...b, negotiationSeconds: Number(e.target.value) })} />
        </label>
        <p className="start-total">
          {problem ? <span data-tone="stop">{problem}</span> : <>The most this purchase can lock: <strong className="num">{usd(b.quantity * b.maxUnitCents, { decimals: false })}</strong> in test dollars.</>}
        </p>
        <button type="submit" className="btn btn-primary" disabled={busy || problem !== null}>
          {busy ? "Starting" : "Start the purchase"}
        </button>
      </form>
      {message ? (
        <p className="banner" data-tone={message.tone} role="status">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
