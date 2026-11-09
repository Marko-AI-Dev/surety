import { useEffect, useRef, useState } from "react";
import { type FeedItem, type Stage, buyerFeed, dealStages } from "../data/buyer";
import { TRADE_RULES, TRADE_THRESHOLDS } from "../data/evidence";
import { usd, utcTime } from "../data/format";
import type { InviteView, RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { CardMark, Cards, Chip, Meter, Panel, TxLink, Waiting } from "./bits";

// The buyer's view, and the demo's first screen: the money rail above, the negotiation as it
// happens, the quotes it produced, and the deal from brief to payout. Scores, rule ids and held
// text live in the Control room.

function Bubble({ item }: { item: FeedItem }) {
  if (item.kind === "negotiator") {
    return (
      <li className="bubble" data-side="us">
        <p className="bubble-who">
          Your Negotiator to {item.to.length > 2 ? `${item.to.length} suppliers` : item.to.join(" and ")}
          <time>{utcTime(item.atMs)}</time>
        </p>
        <p className="bubble-text">{item.text}</p>
      </li>
    );
  }
  if (item.kind === "supplier") {
    return (
      <li className="bubble" data-side="them">
        <p className="bubble-who">
          {item.name}
          <time>{utcTime(item.atMs)}</time>
        </p>
        <p className="bubble-text">{item.text}</p>
      </li>
    );
  }
  if (item.kind === "held") {
    return (
      <li className="feed-note" data-tone={item.card === "red" || item.removed ? "stop" : "held"}>
        {item.card ? <CardMark card={item.card} /> : null}
        <span>
          <strong>Surety held a message from {item.name.replace(/\.$/, "")}.</strong> Your agents never read it.
          {item.removed ? " That supplier is now out of this purchase." : ""}
        </span>
      </li>
    );
  }
  return (
    <li className="feed-note" data-tone={item.overMaximum ? "held" : "money"}>
      <span>
        <strong>{item.name}</strong> committed <span className="num">{usd(item.unitCents)}</span> a unit on the quote form.
        {item.overMaximum ? " That is over your maximum." : ""}
      </span>
    </li>
  );
}

function Negotiation({ record, view }: { record: SourcingRecord; view: RunView }) {
  const [only, setOnly] = useState<string | null>(null);
  const all = buyerFeed(record, view);
  const items = only ? all.filter((i) => (i.kind === "negotiator" ? i.suppliers.includes(only) : i.supplier === only)) : all;
  const invited = view.invites.filter((i) => i.invited);
  const box = useRef<HTMLOListElement>(null);
  // Keep the newest message in view as the run plays.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, only]);

  return (
    <section className="panel chat">
      <header className="panel-head chat-head">
        <div>
          <h2>The negotiation</h2>
          <p className="panel-note">
            Your Negotiator is pushing for {usd(record.sourcing.brief.goods.targetUnitCents)}. It was never shown your maximum. Chat is not binding and cannot move
            money.
          </p>
        </div>
        {invited.length > 0 ? (
          <div className="chips" role="group" aria-label="Show one supplier">
            <button type="button" className="chip-btn" aria-pressed={only === null} onClick={() => setOnly(null)}>
              All
            </button>
            {invited.map((i) => (
              <button key={i.address} type="button" className="chip-btn" aria-pressed={only === i.address} data-out={i.status === "out"} onClick={() => setOnly(i.address)}>
                {i.name.split(" ").slice(0, 2).join(" ")}
                <Cards {...i.cards} />
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {/* The box keeps its height when empty, so the page does not jump when the first message lands. */}
      <ol className="feed" ref={box} tabIndex={0} aria-label="Messages, oldest first">
        {items.length === 0 ? (
          <li className="feed-empty">
            {!view.opened ? "The Lead has not opened the sourcing yet." : only ? "No messages with this supplier yet." : "Your Negotiator has not started talking yet."}
          </li>
        ) : (
          items.map((i) => <Bubble key={i.key} item={i} />)
        )}
      </ol>
    </section>
  );
}

function Stages({ stages }: { stages: Stage[] }) {
  return (
    <ol className="stages">
      {stages.map((s, i) => (
        <li key={s.id} className="stage" data-state={s.state} aria-current={s.state === "now" ? "step" : undefined}>
          <span className="stage-dot" aria-hidden="true">
            {s.state === "off" ? "+" : i + 1}
          </span>
          <span className="stage-label">{s.label}</span>
          <span className="stage-note">{s.note}</span>
        </li>
      ))}
    </ol>
  );
}

export function Business({ record, view, replaying }: { record: SourcingRecord; view: RunView; replaying: boolean }) {
  const b = record.sourcing.brief;
  const g = b.goods;
  const invited = view.invites.filter((i) => i.invited);
  const decision = view.accepted?.decision ?? null;
  const overruled = view.decisions.filter((d) => d.decision?.final === "decline");
  const stages = dealStages(record, view);

  const quoteNote = (i: InviteView): { tone: "ok" | "held" | "stop" | "plain"; text: string } => {
    if (i.status === "out") return { tone: "stop", text: "Removed" };
    if (!i.quote) return { tone: "plain", text: i.replied ? "Talking" : "No reply" };
    if (i.quote.unitCents > g.maxUnitCents) return { tone: "held", text: "Over maximum" };
    if (i.selected) return { tone: "ok", text: "Selected" };
    return { tone: "plain", text: "Within brief" };
  };

  return (
    <div className="buy">
      <section className="panel stages-panel" aria-label="The deal, step by step">
        <Stages stages={stages} />
      </section>

      <div className="buy-hero">
        <Negotiation record={record} view={view} />

        <div className="buy-side">
          <Panel title="Your brief" note={replaying ? undefined : `Sourcing ${record.sourcing.ref}`}>
            <p className="brief-line">
              {g.quantity.toLocaleString("en-US")} x {g.description}, {b.incoterm} {b.port}
            </p>
            <dl className="brief">
              <div>
                <dt>Target</dt>
                <dd className="num">{usd(g.targetUnitCents)}</dd>
              </div>
              <div>
                <dt>Maximum</dt>
                <dd className="num">{usd(g.maxUnitCents)}</dd>
              </div>
              <div>
                <dt>Most you can spend</dt>
                <dd className="num">{usd(g.quantity * g.maxUnitCents, { decimals: false })}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Quotes" note="Only a quote committed on the form can be chosen.">
            {invited.length === 0 ? (
              <Waiting>No suppliers invited yet.</Waiting>
            ) : (
              <table className="quotes">
                <thead>
                  <tr>
                    <th scope="col">Supplier</th>
                    <th scope="col" className="r">
                      A unit
                    </th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {invited.map((i) => {
                    const n = quoteNote(i);
                    return (
                      <tr key={i.address} data-selected={i.selected}>
                        <th scope="row">
                          {i.name} <Cards {...i.cards} />
                        </th>
                        <td className="r num">{i.quote ? usd(i.quote.unitCents) : <span className="nil">None</span>}</td>
                        <td>
                          <Chip tone={n.tone}>{n.text}</Chip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {view.suggestions.map((s) => (
              <p key={s.id} className="fine">
                {s.name} is not on your approved list. Your Sourcing agent passed it to you and did not invite it.
              </p>
            ))}
          </Panel>

          <Panel title="The decision" note="Made by your Lead agent. Checked again by Surety before anything locks.">
            {decision && view.accepted ? (
              <>
                <p className="verdict">
                  {view.accepted.supplier.name} at <span className="num">{usd(view.accepted.quote?.unitCents ?? 0)}</span> a unit,{" "}
                  <span className="num">{usd(view.accepted.quote?.totalCents ?? 0)}</span> in total
                </p>
                <blockquote className="reason">{decision.agent.reason}</blockquote>
              </>
            ) : (
              <Waiting>{view.closed ? "The Lead is choosing among the committed quotes." : "The Lead decides after the negotiation ends."}</Waiting>
            )}
            {overruled.map((d) => (
              <p key={d.id} className="fine">
                Nothing was locked for {d.supplier.name}: {d.decision?.reasonCodes.join(", ")}.
              </p>
            ))}
          </Panel>
        </div>
      </div>

      <div className="grid">
        <Panel title="Surety Verify" note="Rules first, and a failed rule is final. Then a decision model scores the documents.">
          {view.verified && record.verify ? (
            <>
              <p className="verdict" data-tone={record.verify.outcome === "APPROVE" ? "ok" : "stop"}>
                {record.verify.outcome === "APPROVE" ? "Approved: the documents match the order" : `Not approved: ${record.verify.reasonCodes.join(", ")}`}
              </p>
              <ul className="rules" aria-label="Trade rules">
                {TRADE_RULES.map((r) => (
                  <li key={r.id} data-pass={!record.verify?.reasonCodes.includes(`rule:${r.id}`)}>
                    {r.label}
                  </li>
                ))}
              </ul>
              <Meter label="Consistency" value={record.verify.satisfaction} threshold={TRADE_THRESHOLDS.approveMinConsistency} good="above" />
              <Meter label="Trick score" value={record.verify.injectionRisk} threshold={TRADE_THRESHOLDS.approveMaxTrick} good="below" />
              <p className="fine">
                The decision model is asked only when all 12 rules pass. It gives scores, not certainties. Policy {record.verify.policyVersion}.
              </p>
            </>
          ) : view.documents ? (
            <Waiting>
              {view.inspection === "waiting" ? "Waiting for the inspector to attest the bill of lading." : "Checking the supplier's invoice and bill of lading against the order."}
            </Waiting>
          ) : view.locked ? (
            <Waiting>The payment is locked. Waiting for the supplier's invoice and shipping details.</Waiting>
          ) : (
            <Waiting>Runs after the payment is locked and the supplier sends its documents.</Waiting>
          )}
        </Panel>

        <Panel title="Receipt" note="Every line links to the XRP Ledger testnet explorer.">
          {view.locked && record.create ? (
            <div className="receipt">
              <TxLink tx={record.create} label={`Locked ${usd(view.money.totalCents)}`} />
              {view.paid && record.finish ? <TxLink tx={record.finish} label={`Paid ${usd(view.money.totalCents)} to ${view.accepted?.supplier.name ?? "the supplier"}`} /> : null}
              {view.refunded && record.cancel ? <TxLink tx={record.cancel} label={`Refunded ${usd(view.money.totalCents)}`} /> : null}
              {view.paid && record.treasuryCents?.before && record.treasuryCents.after ? (
                <p className="fine">
                  Treasury before {usd(Number(record.treasuryCents.before))}, after {usd(Number(record.treasuryCents.after))}: exactly{" "}
                  {usd(Number(record.treasuryCents.before) - Number(record.treasuryCents.after))} lower. Deal {record.job?.ref}.
                </p>
              ) : null}
            </div>
          ) : (
            <Waiting>Nothing has moved. Your money is in your treasury.</Waiting>
          )}
        </Panel>
      </div>
    </div>
  );
}
