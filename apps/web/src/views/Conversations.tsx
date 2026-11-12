import { useState } from "react";
import { CHAT_THRESHOLDS } from "../data/evidence";
import { ruleOf, shortAddress, usd, utcTime } from "../data/format";
import { type ChatRow, INSPECTOR_ROW, LEAD_ROW, chatRows } from "../data/livescreen";
import { verdictPlain } from "../data/plain";
import { type InviteView, type MessageView, type RunView, negotiatorEyes } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { useMedia } from "./Spatial";
import { CardMark, Cards, Chip, Meter, More, Waiting } from "./bits";

// The conversations of one purchase: a list on the left, one conversation to read on the right.
// Three pairs of eyes read the same record:
//   screen      the big screen. Every supplier, the Lead's decision and the inspector. A held message
//               shows that it was held and why, never its text.
//   operator    the Control room. Held messages in full, with the scores.
//   negotiator  exactly what the Negotiator's inbox carried.
export type Eyes = "screen" | "operator" | "negotiator";

// What Surety did with a supplier message: one plain sentence, with the scores and rule names under "Why".
function Verdict({ m }: { m: MessageView }) {
  const s = m.screen;
  const rule = ruleOf(s?.reasonCodes);
  const plain = verdictPlain(m);
  return (
    <div className="screen" data-verdict={m.delivered ? "deliver" : rule ? "red" : (m.card ?? "held")}>
      <p className="screen-head">
        {m.card ? <CardMark card={m.card} /> : null}
        {plain.text}
      </p>
      <More label="Why">
        {rule ? (
          <p className="screen-detail">
            Stopped by a fixed rule (<code>{rule}</code>): {s?.rules?.results.find((x) => x.id === rule)?.detail}. The model was not asked.
          </p>
        ) : (
          <>
            <p className="screen-detail">
              A model scored the message{s?.samples ? `, ${s.samples.length} times because the first answer was close to the line` : ""}. To be delivered it must read as
              ordinary business and must not try to steer the agent.
            </p>
            <Meter label="Ordinary" value={s?.satisfaction} threshold={CHAT_THRESHOLDS.deliverMinOrdinary} good="above" />
            <Meter label="Steering" value={s?.injectionRisk} threshold={CHAT_THRESHOLDS.deliverMaxSteering} good="below" />
            {s?.samples ? <p className="screen-detail">Steering each time: {s.samples.map((x) => x.injectionRisk.toFixed(2)).join(", ")}. A card at {CHAT_THRESHOLDS.yellowMinSteering.toFixed(2)} or more.</p> : null}
          </>
        )}
      </More>
    </div>
  );
}

function SupplierThread({ view, inv, eyes }: { view: RunView; inv: InviteView; eyes: Eyes }) {
  const mine = view.messages.filter((m) => m.supplier === inv.address);
  const inbox = negotiatorEyes(view.messages).filter((i) => i.supplier === inv.address);
  const shown = eyes === "screen" ? mine.filter((m) => m.kind !== "report") : mine;
  if (inv.invited && shown.length === 0) return <Waiting>No messages yet.</Waiting>;
  if (eyes === "negotiator") {
    return (
      <ol className="thread">
        {inbox.map((i) => (
          <li key={i.index} className="msg" data-kind={i.kind} data-held={"withheld" in i}>
            <p className="msg-meta">
              {i.kind === "to_supplier" ? "Negotiator" : inv.name}
              <time>{utcTime(i.atMs)}</time>
            </p>
            {"withheld" in i ? (
              <p className="msg-body withheld">Withheld by Surety. The Negotiator sees only this line{i.card ? ` and a ${i.card} card` : ""}.</p>
            ) : (
              <p className="msg-body">{i.text}</p>
            )}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="thread">
      {shown.map((m) => {
        const held = m.kind === "from_supplier" && !m.delivered;
        return (
          <li key={m.index} className="msg" data-kind={m.kind} data-held={held} data-new={view.t - m.atMs < 6000 || undefined}>
            <p className="msg-meta">
              {m.kind === "to_supplier" ? "Negotiator" : m.kind === "report" ? "Negotiator's report to the Lead" : inv.name}
              <time>{utcTime(m.atMs)}</time>
            </p>
            {m.kind === "report" && m.offer ? (
              <p className="msg-body">
                <span className="num">{usd(m.offer.unitCents)}</span> a unit, {m.offer.quantity} units, {m.offer.deliveryDays} days. {m.body}
              </p>
            ) : held && eyes === "screen" ? (
              // The big screen says that a message was held and why. Its text stays in the Control room.
              <p className="msg-body withheld">This message was stopped before any agent read it.</p>
            ) : (
              <p className="msg-body">{m.body}</p>
            )}
            {m.kind === "from_supplier" && (eyes === "operator" || held) ? <Verdict m={m} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function LeadThread({ record, view }: { record: SourcingRecord; view: RunView }) {
  const reports = view.messages.filter((m) => m.kind === "report");
  const nameOf = (address: string) => view.invites.find((i) => i.address === address)?.name ?? shortAddress(address);
  const ranking = view.closed ? (record.ranking ?? []) : [];
  if (reports.length === 0 && view.decisions.length === 0) return <Waiting>The Negotiator has not reported any offer to the Lead yet.</Waiting>;
  return (
    <ol className="thread">
      {reports.map((m) => (
        <li key={m.index} className="msg" data-kind="report">
          <p className="msg-meta">
            Negotiator's report on {nameOf(m.supplier)}
            <time>{utcTime(m.atMs)}</time>
          </p>
          <p className="msg-body">
            {m.offer ? (
              <>
                <span className="num">{usd(m.offer.unitCents)}</span> a unit, {m.offer.deliveryDays} days.{" "}
              </>
            ) : null}
            {m.delivered ? m.body : "Surety withheld the summary. The Lead got the figures only."}
          </p>
        </li>
      ))}
      {ranking.length > 0 ? (
        <li className="msg" data-kind="ranking">
          <p className="msg-meta">Surety's ranking for the buyer's priority{record.sourcing.brief.priority ? ` (${record.sourcing.brief.priority})` : ""}</p>
          <ol className="ranking">
            {ranking.map((r, i) => (
              <li key={r.supplier} data-eligible={r.eligible}>
                <span className="num">{i + 1}.</span> {nameOf(r.supplier)}: <span className="num">{usd(r.unitCents)}</span>
                {r.deliveryDays ? `, ${r.deliveryDays} days` : ""}. {r.why}
              </li>
            ))}
          </ol>
        </li>
      ) : null}
      {view.decisions.map((d) => (
        <li key={d.id} className="msg" data-kind="decision" data-held={d.decision?.final !== "accept"}>
          <p className="msg-meta">Lead agent{d.decision?.agent.model ? ` (${d.decision.agent.model})` : ""}</p>
          <p className="msg-body">
            <strong>
              {d.decision?.final === "accept"
                ? `Chose ${d.supplier.name} at ${usd(d.quote?.unitCents ?? 0)} a unit.`
                : d.decision?.agent.outcome === "accept"
                  ? `Chose ${d.supplier.name}, and Surety refused it.`
                  : `Turned down ${d.supplier.name}.`}
            </strong>{" "}
            {d.decision?.agent.reason}
          </p>
          {d.decision && d.decision.final !== "accept" && d.decision.agent.outcome === "accept" ? (
            <p className="fine">Surety's checks: {d.decision.reasonCodes.join(", ")}. Nothing was locked.</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function InspectorThread({ record, view }: { record: SourcingRecord; view: RunView }) {
  const i = record.inspection;
  if (view.inspection === "none") {
    return <Waiting>{view.locked ? "This purchase was released on the supplier's paperwork alone. No inspector was part of it." : "An independent inspector confirms the shipment after the money is locked."}</Waiting>;
  }
  if (view.inspection === "waiting") {
    return (
      <Waiting>
        {view.refunded
          ? "No inspector answered before the deadline, so nothing was paid."
          : "Waiting for the inspector. A person, not an agent, reads the shipping document number off the shipment and sends it from a phone. Without it the money cannot be released."}
      </Waiting>
    );
  }
  return (
    <ol className="thread">
      <li className="msg" data-kind="decision" data-held={view.inspection === "refused"}>
        <p className="msg-meta">
          {i?.inspector ?? "Inspector"}
          {i?.at ? <time>{utcTime(Date.parse(i.at))}</time> : null}
        </p>
        <p className="msg-body">
          <strong>{view.inspection === "attested" ? "Confirmed the shipment." : "Did not confirm the shipment."}</strong>{" "}
          {i?.blNumber ? (
            <>
              Shipping document number read: <span className="mono">{i.blNumber}</span>.{" "}
            </>
          ) : null}
          {i?.note}
        </p>
        <p className="fine">
          {view.inspection === "attested"
            ? "This is the second key. The money is released only if this number matches the supplier's paperwork."
            : "Without the second key nothing is paid. The ledger returns the money to the buyer at the deadline."}
        </p>
      </li>
    </ol>
  );
}

function RowMeta({ row, eyes }: { row: ChatRow; eyes: Eyes }) {
  if (row.kind !== "supplier") return null;
  return (
    <span className="lane-meta">
      <Chip tone={row.status === "out" ? "stop" : "plain"}>{row.status === "out" ? "Removed" : "Active"}</Chip>
      <Cards {...row.cards} />
      {eyes === "negotiator" ? (
        row.committed ? (
          <Chip tone="plain">Final price in</Chip>
        ) : null
      ) : row.priceCents !== null ? (
        <Chip tone={row.committed ? "money" : "plain"}>
          {row.committed ? "Final price" : "Says"} {usd(row.priceCents)}
        </Chip>
      ) : null}
    </span>
  );
}

export function Conversations({ record, view, eyes }: { record: SourcingRecord; view: RunView; eyes: Eyes }) {
  // null follows whichever conversation spoke last, so the big screen is always on the action.
  const [pick, setPick] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState(false);
  const narrow = useMedia("(max-width: 760px)");
  const all = chatRows(record, view);
  const rows = eyes === "screen" ? all : all.filter((r) => r.kind === "supplier");
  const latest = [...rows].filter((r) => r.lastAt !== null).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0];
  const stage =
    eyes !== "screen"
      ? undefined
      : view.inspection === "waiting" && !view.refunded
        ? rows.find((r) => r.id === INSPECTOR_ROW)
        : view.closed
          ? rows.find((r) => r.id === (view.inspection === "attested" || view.inspection === "refused" ? INSPECTOR_ROW : LEAD_ROW))
          : undefined;
  const chosen = rows.find((r) => r.id === pick) ?? stage ?? latest ?? rows[0];
  const invite = chosen ? view.invites.find((i) => i.address === chosen.id) : undefined;

  if (rows.length === 0) return <Waiting>No suppliers have been invited yet.</Waiting>;

  if (sideBySide && !narrow && eyes !== "screen") {
    return (
      <div className="lanes-wrap">
        <p className="lanes-switch">
          <button type="button" className="btn" onClick={() => setSideBySide(false)}>
            One at a time
          </button>
        </p>
        <div className="lanes">
          {view.invites.map((inv) => (
            <article key={inv.address} className="lane" data-status={inv.status} data-invited={inv.invited}>
              <header className="lane-head">
                <h3>{inv.name}</h3>
                <p className="mono lane-wallet">{shortAddress(inv.address)}</p>
              </header>
              <SupplierThread view={view} inv={inv} eyes={eyes} />
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="lanes-wrap">
      <div className="lane-pick">
        <ul className="lane-list" aria-label="Conversations in this purchase">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" className="lane-row" aria-pressed={chosen?.id === row.id} data-status={row.status ?? undefined} data-kind={row.kind} data-tone={row.tone} onClick={() => setPick(row.id)}>
                <span className="lane-row-name">{row.title}</span>
                <RowMeta row={row} eyes={eyes} />
                {eyes === "screen" ? <span className="lane-row-last">{row.last}</span> : null}
                {row.kind === "supplier" ? (
                  <span className="lane-row-count">
                    {row.messages === 1 ? "1 message" : `${row.messages} messages`}
                    {row.held > 0 ? <span className="lane-row-held">, {row.held} held</span> : null}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {eyes === "screen" ? (
          pick !== null ? (
            <button type="button" className="btn lanes-all" onClick={() => setPick(null)}>
              Follow the latest
            </button>
          ) : (
            <p className="fine">Following the latest conversation. Select one to stay on it.</p>
          )
        ) : narrow ? null : (
          <button type="button" className="btn lanes-all" onClick={() => setSideBySide(true)}>
            Side by side
          </button>
        )}
      </div>
      {chosen ? (
        <article className="lane lane-solo" data-status={chosen.status ?? undefined} aria-label={`Conversation: ${chosen.title}`}>
          <header className="lane-head">
            <h3>{chosen.title}</h3>
            {invite ? <p className="mono lane-wallet">{shortAddress(invite.address)}</p> : null}
          </header>
          {chosen.kind === "lead" ? (
            <LeadThread record={record} view={view} />
          ) : chosen.kind === "inspector" ? (
            <InspectorThread record={record} view={view} />
          ) : invite ? (
            <SupplierThread view={view} inv={invite} eyes={eyes} />
          ) : null}
        </article>
      ) : null}
    </div>
  );
}
