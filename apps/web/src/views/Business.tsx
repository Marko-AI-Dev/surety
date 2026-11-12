import { useState } from "react";
import type { Stage } from "../data/buyer";
import { TRADE_RULES, TRADE_THRESHOLDS } from "../data/evidence";
import { shortAddress, usd } from "../data/format";
import type { Headline } from "../data/livescreen";
import type { InviteView, RunView } from "../data/timeline";
import type { LedgerTx, SourcingRecord } from "../data/types";
import { Conversations } from "./Conversations";
import { SeatQr } from "./SeatQr";
import { Arc, Detail } from "./Spatial";
import { Cards, Chip, Meter, More, Panel, Term, TxLink, Waiting } from "./bits";

// The main screen: one purchase, as it happens. Three panes on the arc: the brief and the prices, the
// conversations (in front), and the decision and payment. The same screen plays a recorded run.

export function Stages({ stages, thin }: { stages: Stage[]; thin?: boolean }) {
  return (
    <ol className="stages" data-thin={thin || undefined} aria-label="The deal, step by step">
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

const PRIORITY: Record<string, string> = { price: "The lowest price", speed: "The fastest delivery", balanced: "A balance of price and speed" };

// The three numbers on top, worked out from the record: how far the price moved, how many crooks were
// removed, and where the money is.
export function Numbers({ h }: { h: Headline }) {
  const moved = h.movedCents ?? 0;
  return (
    <dl className="numbers">
      <div data-tone={moved > 0 ? "ok" : "plain"}>
        <dt>Price per unit</dt>
        <dd className="num">
          {h.openingBestCents === null ? (
            <span className="nil">No offer yet</span>
          ) : (
            <>
              {h.bestNowCents !== null && h.bestNowCents !== h.openingBestCents ? <s>{usd(h.openingBestCents)}</s> : null} {usd(h.bestNowCents ?? h.openingBestCents)}
            </>
          )}
        </dd>
        <dd className="numbers-note">
          {h.openingBestCents === null
            ? "A supplier's first offer against its price now"
            : moved > 0
              ? `${h.supplierName ?? "The supplier"} came down ${usd(moved)} a unit from its first offer, ${usd(h.movedTotalCents ?? 0, { decimals: false })} on the order`
              : moved < 0
                ? `${h.supplierName ?? "The supplier"} is ${usd(-moved)} a unit above its first offer`
                : `${h.chosen ? "The chosen supplier" : "Best offer so far"}${h.supplierName ? `, ${h.supplierName}` : ""}. No movement yet`}
        </dd>
      </div>
      <div data-tone={h.ejected > 0 ? "stop" : "plain"}>
        <dt>Suppliers removed</dt>
        <dd className="num">{h.ejected}</dd>
        <dd className="numbers-note">{h.ejected > 0 ? "For trying to trick the agents or redirect the money" : "For trying to trick the agents. None so far"}</dd>
      </div>
      <div data-tone={h.money.state === "paid" ? "ok" : h.money.state === "locked" ? "money" : h.money.state === "refunded" ? "stop" : "plain"}>
        <dt>{h.money.state === "paid" ? "Paid to the supplier" : h.money.state === "refunded" ? "Refunded to you" : h.money.state === "locked" ? "Locked on the ledger" : "Money moved"}</dt>
        <dd className="num">{usd(h.money.cents)}</dd>
        <dd className="numbers-note">
          {h.money.tx ? (
            <a href={h.money.tx.explorer} target="_blank" rel="noreferrer">
              See it on the XRP Ledger, ledger {h.money.tx.ledgerIndex}
            </a>
          ) : (
            "Nothing has left your treasury"
          )}
        </dd>
      </div>
    </dl>
  );
}

// Every move of the money, as a link to the public test ledger.
export function LedgerLinks({ record, view }: { record: SourcingRecord; view: RunView }) {
  const links: { label: string; tx: LedgerTx }[] = [];
  if (view.locked && record.create) links.push({ label: "Lock", tx: record.create });
  if (view.paid && record.finish) links.push({ label: "Payment", tx: record.finish });
  if (view.refunded && record.cancel) links.push({ label: "Refund", tx: record.cancel });
  return (
    <p className="ledger-links">
      <span className="ledger-links-name">XRP Ledger escrow</span>
      {links.length === 0 ? (
        <span className="ledger-links-none">No transaction yet. Each lock, payment and refund will link to testnet.xrpl.org here.</span>
      ) : (
        links.map((l) => (
          <a key={l.label} href={l.tx.explorer} target="_blank" rel="noreferrer" title={`${l.tx.txHash}, result ${l.tx.result}`}>
            {l.label} <span className="mono">{l.tx.txHash.slice(0, 8)}</span> on testnet.xrpl.org
          </a>
        ))
      )}
    </p>
  );
}

function SupplierDetail({ record, view, invite, onClose }: { record: SourcingRecord; view: RunView; invite: InviteView; onClose: () => void }) {
  const mine = view.messages.filter((m) => m.supplier === invite.address && m.kind === "from_supplier");
  const delivered = mine.filter((m) => m.delivered);
  const last = delivered[delivered.length - 1];
  const max = record.sourcing.brief.goods.maxUnitCents;
  const days = record.invites.find((i) => i.address === invite.address)?.deliveryDays;
  return (
    <Detail title={invite.name} onClose={onClose}>
      <p className="detail-lead">
        {invite.status === "out" ? <Chip tone="stop">Removed from this purchase</Chip> : invite.selected ? <Chip tone="ok">Chosen</Chip> : <Chip tone="plain">In the negotiation</Chip>}{" "}
        <Cards {...invite.cards} />
      </p>
      <dl className="detail-facts">
        <div>
          <dt>Approved wallet</dt>
          <dd className="mono">{shortAddress(invite.address)}</dd>
        </div>
        <div>
          <dt>Final price</dt>
          <dd className="num">{invite.quote ? `${usd(invite.quote.unitCents)} a unit` : "None yet"}</dd>
        </div>
        <div>
          <dt>Messages delivered</dt>
          <dd className="num">{delivered.length}</dd>
        </div>
        <div>
          <dt>Messages held by Surety</dt>
          <dd className="num">{mine.length - delivered.length}</dd>
        </div>
      </dl>
      {invite.quote ? (
        <p className="fine">
          {usd(invite.quote.totalCents)} in total for {invite.quote.quantity} units{days ? `, delivered in ${days} days` : ""}.{" "}
          {invite.quote.unitCents > max ? "Over your limit, so it cannot be locked." : "Within your limit."}
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
  const [detail, setDetail] = useState<string | null>(null);
  const b = record.sourcing.brief;
  const g = b.goods;
  const invited = view.invites.filter((i) => i.invited);
  const decision = view.accepted?.decision ?? null;
  const overruled = view.decisions.filter((d) => d.decision?.final === "decline");
  const picked = detail ? view.invites.find((i) => i.address === detail) : undefined;
  const daysOf = (address: string) => (view.invites.find((i) => i.address === address)?.quote ? record.invites.find((i) => i.address === address)?.deliveryDays : null);

  const quoteNote = (i: InviteView): { tone: "ok" | "held" | "stop" | "plain"; text: string } => {
    if (i.status === "out") return { tone: "stop", text: "Removed" };
    if (!i.quote) return { tone: "plain", text: i.replied ? "Still talking" : "No reply" };
    if (i.quote.unitCents > g.maxUnitCents) return { tone: "held", text: "Over your limit" };
    const days = daysOf(i.address);
    if (b.latestDeliveryDays && days && days > b.latestDeliveryDays) return { tone: "held", text: "Too slow" };
    if (i.selected) return { tone: "ok", text: "Chosen" };
    return { tone: "plain", text: "Within your limit" };
  };

  const brief = (
    <>
      <Panel title="Your brief" note={replaying ? undefined : `Purchase ${record.sourcing.ref}`}>
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
          {b.priority ? (
            <div>
              <dt>What matters most</dt>
              <dd>{PRIORITY[b.priority] ?? b.priority}</dd>
            </div>
          ) : null}
          {b.latestDeliveryDays ? (
            <div>
              <dt>Delivered within</dt>
              <dd className="num">{b.latestDeliveryDays} days</dd>
            </div>
          ) : null}
        </dl>
      </Panel>
      <Panel title="Suppliers" note="Select one to see more about it.">
        {invited.length === 0 ? (
          <Waiting>No suppliers invited yet.</Waiting>
        ) : (
          <ul className="quote-rows">
            {invited.map((i) => {
              const n = quoteNote(i);
              const days = daysOf(i.address);
              return (
                <li key={i.address}>
                  <button type="button" className="quote-row" data-selected={i.selected} onClick={() => setDetail(i.address)}>
                    <span className="quote-name">
                      {i.name} <Cards {...i.cards} />
                    </span>
                    <span className="quote-price num">
                      {i.quote ? usd(i.quote.unitCents) : <span className="nil">No price yet</span>}
                      {days ? <span className="quote-days">{days} days</span> : null}
                    </span>
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
      <Panel title="Play a supplier" note="Scan to try the supplier's seat on a phone, in practice mode. Haggle, or try to trick the Negotiator.">
        <SeatQr page="supplier" />
      </Panel>
    </>
  );

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
        title="Inspector"
        note={
          <>
            The second key. <Term k="inspector">Who this is</Term>
          </>
        }
      >
        {view.inspection === "attested" ? (
          <p className="verdict" data-tone="ok">
            Confirmed the shipment.
          </p>
        ) : view.inspection === "refused" ? (
          <p className="verdict" data-tone="stop">
            Did not confirm the shipment. Nothing is paid.
          </p>
        ) : view.inspection === "waiting" ? (
          <Waiting>{view.refunded ? "Gave no answer before the deadline, so nothing was paid." : "Waiting for a person to check the shipment and confirm it from a phone."}</Waiting>
        ) : (
          <Waiting>{view.locked ? "Not part of this purchase." : "Checks the shipment once the money is locked."}</Waiting>
        )}
        {record.inspection?.note && view.inspection !== "waiting" && view.inspection !== "none" ? <p className="fine">"{record.inspection.note}"</p> : null}
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
                ? "Every rule passed, and the free text showed no sign of a trick."
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
                The model is asked only when every rule passes. It gives scores, not certainties. Recorded as {record.verify.reasonCodes.join(", ")} under{" "}
                {record.verify.policyVersion}.
              </p>
            </More>
          </>
        ) : view.documents ? (
          <Waiting>
            {view.inspection === "waiting" ? "Waiting for the inspector to confirm the shipment." : "Checking the supplier's invoice and shipping document against your order."}
          </Waiting>
        ) : view.locked ? (
          <Waiting>{view.refunded ? "No paperwork arrived before the deadline." : "The money is locked. Waiting for the supplier's invoice and shipping document."}</Waiting>
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
          { id: "quotes", title: "Brief and prices", note: "A price counts only once the supplier submits it on Surety's form.", body: brief },
          {
            id: "negotiation",
            title: "Conversations",
            note: `Your Negotiator asks each supplier for a better price, aiming for ${usd(g.targetUnitCents)}. Nothing said here can move money.`,
            body: <Conversations record={record} view={view} eyes="screen" />,
          },
          { id: "settlement", title: "Decision and payment", note: "Who was chosen, whether the shipment and paperwork passed, and the proof.", body: settlement },
        ]}
      />
      {picked ? <SupplierDetail record={record} view={view} invite={picked} onClose={() => setDetail(null)} /> : null}
    </>
  );
}
