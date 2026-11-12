import { useState } from "react";
import { type FeedItem, type Stage, buyerFeed } from "../data/buyer";
import { TRADE_RULES, TRADE_THRESHOLDS } from "../data/evidence";
import { shortAddress, usd, utcTime } from "../data/format";
import type { InviteView, RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { Arc, Detail } from "./Spatial";
import { CardMark, Cards, Chip, Meter, More, Panel, Term, TxLink, Waiting } from "./bits";

// The buyer's view, and the demo's first screen. Three panes on the arc: the quotes, the negotiation
// (in front to begin with) and the settlement. Scores, rule ids and held text live in the Control room.

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
        <strong>{item.name}</strong> submitted a final price of <span className="num">{usd(item.unitCents)}</span> a unit.
        {item.overMaximum ? " That is over your limit." : ""}
      </span>
    </li>
  );
}

// A pane holds what it shows and never scrolls inside itself. The conversation shows its newest
// messages; the earlier ones open in place, and the pane grows to hold them.
export const FEED_TAIL = 6;

function Feed({ items, opened, only }: { items: FeedItem[]; opened: boolean; only: boolean }) {
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, items.length - FEED_TAIL);
  const shown = hidden > 0 ? items.slice(hidden) : items;
  return (
    <ol className="feed" aria-label="Messages, oldest first">
      {items.length === 0 ? (
        <li className="feed-empty">{!opened ? "The Lead has not opened the sourcing yet." : only ? "No messages with this supplier yet." : "Your Negotiator has not started talking yet."}</li>
      ) : null}
      {items.length > FEED_TAIL ? (
        <li className="feed-more">
          <button type="button" className="btn" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? "Show only the latest" : `Show ${hidden} earlier`}
          </button>
        </li>
      ) : null}
      {shown.map((i) => (
        <Bubble key={i.key} item={i} />
      ))}
    </ol>
  );
}

export function Stages({ stages }: { stages: Stage[] }) {
  return (
    <ol className="stages" aria-label="The deal, step by step">
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

function SupplierDetail({ record, view, invite, onClose }: { record: SourcingRecord; view: RunView; invite: InviteView; onClose: () => void }) {
  const mine = view.messages.filter((m) => m.supplier === invite.address && m.kind === "from_supplier");
  const delivered = mine.filter((m) => m.delivered);
  const last = delivered[delivered.length - 1];
  const max = record.sourcing.brief.goods.maxUnitCents;
  return (
    <Detail title={invite.name} onClose={onClose}>
      <p className="detail-lead">
        {invite.status === "out" ? <Chip tone="stop">Removed from this purchase</Chip> : invite.selected ? <Chip tone="ok">Selected</Chip> : <Chip tone="plain">In the negotiation</Chip>}{" "}
        <Cards {...invite.cards} />
      </p>
      <dl className="detail-facts">
        <div>
          <dt>Approved wallet</dt>
          <dd className="mono">{shortAddress(invite.address)}</dd>
        </div>
        <div>
          <dt>Messages delivered</dt>
          <dd className="num">{delivered.length}</dd>
        </div>
        <div>
          <dt>Messages held by Surety</dt>
          <dd className="num">{mine.length - delivered.length}</dd>
        </div>
        <div>
          <dt>Committed quote</dt>
          <dd className="num">{invite.quote ? `${usd(invite.quote.unitCents)} a unit` : "None"}</dd>
        </div>
      </dl>
      {invite.quote ? (
        <p className="fine">
          {usd(invite.quote.totalCents)} in total for {invite.quote.quantity} units. {invite.quote.unitCents > max ? "Over your maximum, so it cannot be locked." : "Within your brief."}
        </p>
      ) : null}
      {last ? (
        <>
          <h3 className="detail-sub">Its latest delivered message</h3>
          <blockquote className="reason">{last.body}</blockquote>
        </>
      ) : (
        <p className="fine">{invite.replied ? "Nothing it sent was delivered." : "It has not replied."}</p>
      )}
      {invite.unnamed ? <p className="fine">This approved wallet has no name in the supplier directory.</p> : null}
    </Detail>
  );
}

export function Business({ record, view, replaying, flat }: { record: SourcingRecord; view: RunView; replaying: boolean; flat: boolean }) {
  const [only, setOnly] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const b = record.sourcing.brief;
  const g = b.goods;
  const invited = view.invites.filter((i) => i.invited);
  const decision = view.accepted?.decision ?? null;
  const overruled = view.decisions.filter((d) => d.decision?.final === "decline");
  const feed = buyerFeed(record, view);
  const items = only ? feed.filter((i) => (i.kind === "negotiator" ? i.suppliers.includes(only) : i.supplier === only)) : feed;
  const picked = detail ? view.invites.find((i) => i.address === detail) : undefined;

  const quoteNote = (i: InviteView): { tone: "ok" | "held" | "stop" | "plain"; text: string } => {
    if (i.status === "out") return { tone: "stop", text: "Removed" };
    if (!i.quote) return { tone: "plain", text: i.replied ? "Still talking" : "No reply" };
    if (i.quote.unitCents > g.maxUnitCents) return { tone: "held", text: "Over your limit" };
    if (i.selected) return { tone: "ok", text: "Chosen" };
    return { tone: "plain", text: "Within your limit" };
  };

  const quotes = (
    <>
      <Panel title="Your brief" note={replaying ? undefined : `Sourcing ${record.sourcing.ref}`}>
        <p className="brief-line">
          {g.quantity.toLocaleString("en-US")} x {g.description}, {b.incoterm} {b.port}
        </p>
        <dl className="brief">
          <div>
            <dt>Aim for</dt>
            <dd className="num">{usd(g.targetUnitCents)}</dd>
          </div>
          <div>
            <dt>Pay at most</dt>
            <dd className="num">{usd(g.maxUnitCents)}</dd>
          </div>
          <div>
            <dt>Most you can spend</dt>
            <dd className="num">{usd(g.quantity * g.maxUnitCents, { decimals: false })}</dd>
          </div>
        </dl>
      </Panel>
      <Panel title="Suppliers" note="Select one to see more about it.">
        {invited.length === 0 ? (
          <Waiting>No suppliers invited yet.</Waiting>
        ) : (
          <ul className="quote-rows">
            {invited.map((i) => {
              const n = quoteNote(i);
              return (
                <li key={i.address}>
                  <button type="button" className="quote-row" data-selected={i.selected} onClick={() => setDetail(i.address)}>
                    <span className="quote-name">
                      {i.name} <Cards {...i.cards} />
                    </span>
                    <span className="quote-price num">{i.quote ? usd(i.quote.unitCents) : <span className="nil">No price yet</span>}</span>
                    <Chip tone={n.tone}>{n.text}</Chip>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {view.suggestions.map((s) => (
          <p key={s.id} className="fine">
            {s.name} is not on your approved list. Your Sourcing agent passed it to you and did not invite it.
          </p>
        ))}
      </Panel>
    </>
  );

  const negotiation = <Feed items={items} opened={view.opened} only={only !== null} />;
  const chips =
    invited.length > 0 ? (
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
    ) : null;

  const settlement = (
    <>
      <Panel title="The decision" note="Your Lead agent chooses. Surety checks the choice before any money locks.">
        {decision && view.accepted ? (
          <>
            <p className="verdict">
              {view.accepted.supplier.name} at <span className="num">{usd(view.accepted.quote?.unitCents ?? 0)}</span> a unit,{" "}
              <span className="num">{usd(view.accepted.quote?.totalCents ?? 0)}</span> in total
            </p>
            <p className="fine">Its reason, in its own words:</p>
            <blockquote className="reason">{decision.agent.reason}</blockquote>
          </>
        ) : (
          <Waiting>{view.closed ? "Your Lead agent is choosing among the final prices." : "Your Lead agent decides once the negotiation ends."}</Waiting>
        )}
        {overruled.map((d) => (
          <p key={d.id} className="fine">
            Nothing was locked for {d.supplier.name}: {d.decision?.reasonCodes.join(", ")}.
          </p>
        ))}
      </Panel>
      <Panel
        title="Paperwork check"
        note={
          <>
            Does the supplier's paperwork match your order? <Term k="verify">How it is checked</Term>
          </>
        }
      >
        {view.verified && record.verify ? (
          <>
            <p className="verdict" data-tone={record.verify.outcome === "APPROVE" ? "ok" : "stop"}>
              {record.verify.outcome === "APPROVE" ? "Passed. The paperwork matches your order." : "Did not pass. Nothing is paid."}
            </p>
            <p className="fine">
              {record.verify.outcome === "APPROVE"
                ? "All 12 rules passed, and the free text showed no sign of a trick."
                : "Your money stays locked and the ledger returns it to you at the deadline."}
            </p>
            <More label="Show the checks">
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
                The model is asked only when all 12 rules pass. It gives scores, not certainties. Recorded as {record.verify.reasonCodes.join(", ")} under{" "}
                {record.verify.policyVersion}.
              </p>
            </More>
          </>
        ) : view.documents ? (
          <Waiting>
            {view.inspection === "waiting" ? "Waiting for the inspector to confirm the shipment." : "Checking the supplier's invoice and shipping document against your order."}
          </Waiting>
        ) : view.locked ? (
          <Waiting>The money is locked. Waiting for the supplier's invoice and shipping document.</Waiting>
        ) : (
          <Waiting>Happens after the money is locked and the supplier sends its paperwork.</Waiting>
        )}
      </Panel>
      <Panel title="Proof" note="On the public test ledger. Each line opens the transaction.">
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
    </>
  );

  return (
    <>
      <Arc
        label="Parts of this purchase"
        flat={flat}
        initial={1}
        panes={[
          { id: "quotes", title: "Suppliers and prices", note: "A price counts only once the supplier submits it on Surety's form.", body: quotes },
          {
            id: "negotiation",
            title: "The negotiation",
            note: `Your Negotiator asks each supplier for a better price, aiming for ${usd(g.targetUnitCents)}. Nothing said here can move money.`,
            tools: chips,
            body: negotiation,
          },
          { id: "settlement", title: "Decision and payment", note: "Who was chosen, whether the paperwork passed, and the proof.", body: settlement },
        ]}
      />
      {picked ? <SupplierDetail record={record} view={view} invite={picked} onClose={() => setDetail(null)} /> : null}
    </>
  );
}
