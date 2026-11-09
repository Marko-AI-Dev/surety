import { TRADE_RULES, TRADE_THRESHOLDS } from "../data/evidence";
import { usd } from "../data/format";
import type { InviteView, RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { Cards, Chip, Meter, Panel, TxLink, Waiting } from "./bits";

// The buyer's view: what I asked for, what my agents did, what it cost, and the proof.
export function Business({ record, view, replaying }: { record: SourcingRecord; view: RunView; replaying: boolean }) {
  const b = record.sourcing.brief;
  const g = b.goods;
  const invited = view.invites.filter((i) => i.invited);
  const out = view.invites.filter((i) => i.status === "out");
  const talking = view.messages.some((m) => m.kind === "to_supplier");
  const committed = view.invites.filter((i) => i.quote);
  const decision = view.accepted?.decision ?? null;
  const overruled = view.decisions.filter((d) => d.decision?.final === "decline");

  const quoteNote = (i: InviteView): { tone: "ok" | "held" | "stop" | "plain"; text: string } => {
    if (i.status === "out") return { tone: "stop", text: "Removed for manipulation" };
    if (!i.quote) return { tone: "plain", text: i.replied ? "No committed quote" : "No reply" };
    if (i.quote.unitCents > g.maxUnitCents) return { tone: "held", text: "Over your maximum" };
    if (i.selected) return { tone: "ok", text: "Selected" };
    return { tone: "plain", text: "Within the brief" };
  };

  return (
    <div className="grid business">
      <Panel title="Your brief" note={replaying ? "Read-only: this is the brief the recorded run was given." : `Sourcing ${record.sourcing.ref}`}>
        <dl className="brief">
          <div>
            <dt>Goods</dt>
            <dd>
              {g.quantity.toLocaleString("en-US")} x {g.description}
            </dd>
          </div>
          <div>
            <dt>Target price</dt>
            <dd className="num">{usd(g.targetUnitCents)} a unit</dd>
          </div>
          <div>
            <dt>Maximum price</dt>
            <dd className="num">
              {usd(g.maxUnitCents)} a unit
              <span className="hint">Held by Surety. The Negotiator is never shown it.</span>
            </dd>
          </div>
          <div>
            <dt>Delivery terms</dt>
            <dd>
              {b.incoterm} {b.port}
            </dd>
          </div>
          <div>
            <dt>Most you can spend</dt>
            <dd className="num">{usd(g.quantity * g.maxUnitCents)}</dd>
          </div>
          <div>
            <dt>Refund deadline</dt>
            <dd>{b.deadlineSeconds} seconds after the lock, by ledger time</dd>
          </div>
        </dl>
      </Panel>

      <Panel title="What your team is doing">
        {!view.opened ? (
          <Waiting>The Lead has not opened the sourcing yet.</Waiting>
        ) : (
          <ul className="activity">
            <li data-done="true">
              <strong>Lead</strong> opened sourcing {record.sourcing.ref} from your brief.
            </li>
            <li data-done={invited.length > 0}>
              <strong>Sourcing</strong>{" "}
              {invited.length === 0
                ? "is choosing from your approved suppliers."
                : `invited ${invited.length} approved supplier${invited.length === 1 ? "" : "s"}${
                    view.suggestions.length > 0 ? ` and passed ${view.suggestions.length} unapproved supplier to you for approval, without inviting it` : ""
                  }.`}
            </li>
            <li data-done={talking}>
              <strong>Negotiator</strong>{" "}
              {!talking
                ? "has not started talking yet."
                : view.closed
                  ? "finished negotiating. It was given your target. Surety never showed it your maximum."
                  : `is talking to ${invited.length} suppliers, pushing for ${usd(g.targetUnitCents)}.`}
            </li>
            {out.length > 0 ? (
              <li data-done="true" data-tone="stop">
                <strong>Surety</strong> removed {out.map((i) => i.name).join(", ")} for trying to manipulate your agents. Your agents never read those messages.
              </li>
            ) : null}
            {overruled.map((d) => (
              <li key={d.id} data-done="true" data-tone="held">
                <strong>Surety</strong> did not lock for {d.supplier.name}: {d.decision?.reasonCodes.join(", ")}.
              </li>
            ))}
            {decision ? (
              <li data-done="true">
                <strong>Lead</strong> chose {view.accepted?.supplier.name}.
              </li>
            ) : view.closed ? (
              <li data-done="false">
                <strong>Lead</strong> is choosing among the committed quotes.
              </li>
            ) : null}
          </ul>
        )}
      </Panel>

      <Panel title="Committed quotes" note="Chat is never binding. Only a quote committed on the form can be chosen." wide>
        {invited.length === 0 ? (
          <Waiting>No suppliers invited yet.</Waiting>
        ) : (
          <div className="table-wrap">
            <table className="quotes">
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col" className="r">
                    Unit price
                  </th>
                  <th scope="col" className="r">
                    Total
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
                        {i.unnamed ? <span className="hint">Approved wallet with no name in the supplier directory</span> : null}
                      </th>
                      <td className="r num">{i.quote ? usd(i.quote.unitCents) : <span className="nil">No quote</span>}</td>
                      <td className="r num">{i.quote ? usd(i.quote.totalCents) : null}</td>
                      <td>
                        <Chip tone={n.tone}>{n.text}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {committed.length === 0 && invited.length > 0 ? <Waiting>Waiting for suppliers to commit their final quotes.</Waiting> : null}
      </Panel>

      <Panel title="The decision" note="Made by the Lead agent. Checked again by Surety before anything locks.">
        {decision && view.accepted ? (
          <>
            <p className="verdict">
              Accepted {view.accepted.supplier.name} at <span className="num">{usd(view.accepted.quote?.unitCents ?? 0)}</span> a unit
            </p>
            <blockquote className="reason">{decision.agent.reason}</blockquote>
            <p className="fine">
              Lead agent ({decision.agent.model}). Surety ran its checks again and did not overrule it (recorded as {decision.reasonCodes.join(", ")}).
            </p>
          </>
        ) : (
          <Waiting>{view.closed ? "The Lead is deciding." : "The Lead decides after the negotiation ends."}</Waiting>
        )}
      </Panel>

      <Panel title="Surety Verify" note="Rules first, and a failed rule is final. Then a decision model scores the documents.">
        {view.verified && record.verify ? (
          <>
            <p className="verdict" data-tone={record.verify.outcome === "APPROVE" ? "ok" : "stop"}>
              {record.verify.outcome === "APPROVE" ? "Approved: the documents match the order" : `Not approved: ${record.verify.reasonCodes.join(", ")}`}
            </p>
            <ul className="rules" aria-label="Trade rules">
              {TRADE_RULES.map((r) => {
                const failed = record.verify?.reasonCodes.includes(`rule:${r.id}`);
                return (
                  <li key={r.id} data-pass={!failed}>
                    {r.label}
                  </li>
                );
              })}
            </ul>
            <p className="fine">
              The record keeps the outcome and scores. The decision model is asked only when all 12 rules pass, so an approval means they did.
            </p>
            <Meter label="Consistency" value={record.verify.satisfaction} threshold={TRADE_THRESHOLDS.approveMinConsistency} good="above" />
            <Meter label="Trick score" value={record.verify.injectionRisk} threshold={TRADE_THRESHOLDS.approveMaxTrick} good="below" />
            <p className="fine">Policy {record.verify.policyVersion}. The decision model gives scores, not certainties.</p>
          </>
        ) : view.documents ? (
          <Waiting>Checking the supplier's invoice and bill of lading against the order.</Waiting>
        ) : view.locked ? (
          <Waiting>The payment is locked. Waiting for the supplier's invoice and shipping details.</Waiting>
        ) : (
          <Waiting>Runs after the payment is locked and the supplier sends its documents.</Waiting>
        )}
      </Panel>

      <Panel title="Receipt" note="Every line links to the XRP Ledger testnet explorer." wide>
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
  );
}
