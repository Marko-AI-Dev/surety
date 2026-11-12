import { useMemo, useState } from "react";
import { CHAT_THRESHOLDS, DOCUMENTED_LIMITS, RECORDED_RUN_FILE } from "../data/evidence";
import { ruleOf, shortAddress, usd, utcTime } from "../data/format";
import { verdictPlain } from "../data/plain";
import { QR_MAX_BYTES, qrMatrix, qrPath } from "../data/qr";
import { type InviteView, type MessageView, type RunView, negotiatorEyes } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { Arc, useMedia } from "./Spatial";
import { Cards, CardMark, Chip, Meter, More, Panel, Term, Waiting } from "./bits";

const CHECK_LABELS: Record<string, string> = {
  crookOut: "The crook is out of the sourcing",
  quarantinedNeverInInbox: "No held message is in the Negotiator's inbox",
  maxNeverShownToNegotiator: "The maximum is in nothing the API showed the Negotiator",
  strangerSuggestedNotInvited: "The unapproved supplier was suggested, not invited",
  winnerIsCheapestValidCommitted: "The winner is the cheapest valid committed quote",
  paidFinishValidated: "The payout is a validated ledger result",
  treasuryDownByExactlyTotal: "The treasury is down by exactly the deal total",
  everyLeadDecisionHasReason: "Every Lead decision has a reason",
};

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

// One supplier's conversation, as the operator or as the Negotiator saw it.
function Thread({ view, inv, eyes }: { view: RunView; inv: InviteView; eyes: "operator" | "negotiator" }) {
  const mine = view.messages.filter((m) => m.supplier === inv.address);
  const inbox = negotiatorEyes(view.messages).filter((i) => i.supplier === inv.address);
  if (inv.invited && mine.length === 0) return <Waiting>No messages yet.</Waiting>;
  return (
    <ol className="thread">
      {eyes === "operator"
        ? mine.map((m) => (
            <li key={m.index} className="msg" data-kind={m.kind} data-held={m.kind === "from_supplier" && !m.delivered}>
              <p className="msg-meta">
                {m.kind === "to_supplier" ? "Negotiator" : m.kind === "report" ? "Negotiator's report to the Lead" : inv.name}
                <time>{utcTime(m.atMs)}</time>
              </p>
              {m.kind === "report" && m.offer ? (
                <p className="msg-body">
                  <span className="num">{usd(m.offer.unitCents)}</span> a unit, {m.offer.quantity} units, {m.offer.deliveryDays} days. {m.body}
                </p>
              ) : (
                <p className="msg-body">{m.body}</p>
              )}
              {m.kind === "from_supplier" ? <Verdict m={m} /> : null}
            </li>
          ))
        : inbox.map((i) => (
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

function LaneMeta({ inv, eyes }: { inv: InviteView; eyes: "operator" | "negotiator" }) {
  if (!inv.invited) return <>Not invited yet</>;
  return (
    <>
      <Chip tone={inv.status === "out" ? "stop" : "plain"}>{inv.status === "out" ? "Removed" : "Active"}</Chip>
      <Cards {...inv.cards} />
      {inv.quote && eyes === "operator" ? <Chip tone="money">Final price {usd(inv.quote.unitCents)}</Chip> : null}
      {inv.quote && eyes === "negotiator" ? <Chip tone="plain">Final price in</Chip> : null}
    </>
  );
}

// Four conversations do not fit side by side on a laptop at a size anyone can read. So the pane shows
// all four suppliers as a short list (who is in, who is out, cards, quotes, how many messages and how
// many were held) and one conversation at full reading width beside it. "Side by side" is still one
// click away for a wide screen.
function Lanes({ view, eyes }: { view: RunView; eyes: "operator" | "negotiator" }) {
  const [pick, setPick] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState(false);
  const narrow = useMedia("(max-width: 760px)");
  const chosen = view.invites.find((i) => i.address === pick) ?? view.invites[0];
  const counts = (address: string) => {
    const from = view.messages.filter((m) => m.supplier === address && m.kind === "from_supplier");
    const all = view.messages.filter((m) => m.supplier === address && m.kind !== "report");
    return { all: all.length, held: from.filter((m) => !m.delivered).length };
  };

  if (sideBySide && !narrow) {
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
                <p className="lane-meta">
                  <LaneMeta inv={inv} eyes={eyes} />
                </p>
                <p className="mono lane-wallet">{shortAddress(inv.address)}</p>
              </header>
              <Thread view={view} inv={inv} eyes={eyes} />
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="lanes-wrap">
      <div className="lane-pick">
        <ul className="lane-list" aria-label="Suppliers in this negotiation">
          {view.invites.map((inv) => {
            const c = counts(inv.address);
            return (
              <li key={inv.address}>
                <button type="button" className="lane-row" aria-pressed={chosen?.address === inv.address} data-status={inv.status} onClick={() => setPick(inv.address)}>
                  <span className="lane-row-name">{inv.name}</span>
                  <span className="lane-meta">
                    <LaneMeta inv={inv} eyes={eyes} />
                  </span>
                  <span className="lane-row-count">
                    {c.all === 1 ? "1 message" : `${c.all} messages`}
                    {c.held > 0 ? <span className="lane-row-held">, {c.held} held</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {narrow ? null : (
          <button type="button" className="btn lanes-all" onClick={() => setSideBySide(true)}>
            Side by side
          </button>
        )}
      </div>
      {chosen ? (
        <article className="lane lane-solo" data-status={chosen.status} data-invited={chosen.invited} aria-label={`Conversation with ${chosen.name}`}>
          <header className="lane-head">
            <h3>{chosen.name}</h3>
            <p className="mono lane-wallet">{shortAddress(chosen.address)}</p>
          </header>
          <Thread view={view} inv={chosen} eyes={eyes} />
        </article>
      ) : null}
    </div>
  );
}

// The supplier seat as a QR code. A phone cannot open "localhost", so the address is editable: put
// in this machine's network address, or the hosted one. The code is drawn here, in the browser, by
// src/data/qr.ts; nothing is sent to a QR service. Always dark on white, whatever the theme.
function SeatQr() {
  const [base, setBase] = useState(() => `${location.origin}${location.pathname}`);
  const url = `${base.trim().replace(/#.*$/, "")}#/supplier`;
  const local = /\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(url);
  const code = useMemo(() => {
    if (new TextEncoder().encode(url).length > QR_MAX_BYTES) return null;
    return qrPath(qrMatrix(url));
  }, [url]);
  return (
    <div className="seat-qr">
      {code ? (
        <svg className="qr" viewBox={`0 0 ${code.size} ${code.size}`} role="img" aria-label={`QR code for ${url}`} shapeRendering="crispEdges">
          <rect width={code.size} height={code.size} fill="#ffffff" />
          <path d={code.d} fill="#000000" />
        </svg>
      ) : (
        <Waiting>That address is too long for the QR code. Use a shorter one.</Waiting>
      )}
      <div className="seat-qr-side">
        <label className="field">
          <span>Address phones should open</span>
          <input type="url" value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} autoCapitalize="off" />
        </label>
        <p className="seat-url mono">{url}</p>
        {local ? (
          <p className="fine" data-tone="held">
            A phone cannot reach "localhost". Replace it with this machine's network address (start the app with <code>pnpm web --host</code>) or the hosted
            address.
          </p>
        ) : null}
        <p className="fine">
          Practice mode needs no backend and runs the bouncer's real code rules. <a href="#/supplier">Open the seat here</a>
        </p>
      </div>
    </div>
  );
}

export function Control({ record, view, replaying, flat }: { record: SourcingRecord; view: RunView; replaying: boolean; flat: boolean }) {
  const [eyes, setEyes] = useState<"operator" | "negotiator">("operator");
  const held = view.messages.filter((m) => m.kind === "from_supplier" && !m.delivered);
  const done = view.paid || view.refunded;
  const limits = record.policy
    ? {
        source: "Read from the signer",
        policyVersion: record.policy.policyVersion,
        perDealCents: Number(record.policy.limits.perDealCents),
        dailyCents: Number(record.policy.limits.dailyCents),
        openDeals: record.policy.limits.openDeals,
      }
    : DOCUMENTED_LIMITS;
  const target = record.sourcing.brief.goods.targetUnitCents;

  const controls = (
    <>
      <Panel title="Spending limits" note="Set by a person. The agents can read them and cannot change them.">
        <dl className="limits">
          <div>
            <dt>Per deal</dt>
            <dd className="num">{usd(limits.perDealCents, { decimals: false })}</dd>
          </div>
          <div>
            <dt>Per rolling 24 hours</dt>
            <dd className="num">{usd(limits.dailyCents, { decimals: false })}</dd>
          </div>
          <div>
            <dt>Open deals</dt>
            <dd className="num">{limits.openDeals}</dd>
          </div>
        </dl>
        <More label="How they are enforced">
          <p className="fine">
            <Term k="signer" /> checks them on every lock, and only the operator's own secret can change them. Policy version {limits.policyVersion}.{" "}
            {replaying ? `These figures are not in the run record: ${DOCUMENTED_LIMITS.source}.` : limits.source}
          </p>
        </More>
      </Panel>

      <Panel title="Approved suppliers" note="Each one's wallet is fixed when a person approves it. Nobody types a wallet at payment time.">
        <ul className="suppliers">
          {view.invites.map((i) => (
            <li key={i.address}>
              <span>
                {i.name} <Cards {...i.cards} />
              </span>
              <span className="mono">{shortAddress(i.address)}</span>
              <Chip tone={i.cards.yellow + i.cards.red > 0 ? "held" : "ok"}>{i.cards.yellow + i.cards.red > 0 ? "On hold" : "In good standing"}</Chip>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Waiting for your approval" note="An agent can suggest a new supplier. Only a person can approve one.">
        {view.suggestions.length === 0 ? (
          <Waiting>No suggestions.</Waiting>
        ) : (
          <ul className="suggestions">
            {view.suggestions.map((s) => (
              <li key={s.id}>
                <p>
                  <strong>{s.name}</strong> <Chip tone="held">Not approved, so not invited</Chip>
                </p>
                <p className="mono">{s.address}</p>
                <p className="fine">Sourcing agent: {s.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Let someone play a supplier" note="Scan to open the supplier seat on a phone.">
        <SeatQr />
      </Panel>
    </>
  );

  const audit = (
    <>
      <Panel
        title="Held messages"
        note={
          <>
            Stopped before any agent could read them. <Term k="bouncer">What stops them</Term>
          </>
        }
      >
        {held.length === 0 ? (
          <Waiting>Nothing held.</Waiting>
        ) : (
          <ul className="quarantine">
            {held.map((m) => (
              <li key={m.index}>
                <p className="msg-meta">
                  {m.card ? <CardMark card={m.card} /> : null}
                  {view.invites.find((i) => i.address === m.supplier)?.name}
                  <time>{utcTime(m.atMs)}</time>
                </p>
                <p className="msg-body">{m.body}</p>
                <p className="fine">
                  {verdictPlain(m).text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Everything that happened" note="Every step in order, with the time where the record has one.">
        <ol className="trail">
          {view.trail
            .filter((s) => s.kind !== "message" || s.title.startsWith("Surety held"))
            .map((s) => (
              <li key={s.id} data-kind={s.kind}>
                <time>{s.timed ? utcTime(s.at) : ""}</time>
                <span>
                  {s.title}
                  {s.detail ? <span className="trail-detail"> {s.detail}</span> : null}
                </span>
              </li>
            ))}
        </ol>
        <p className="fine">Chat messages are in the negotiation pane; {view.messages.length} so far.</p>
      </Panel>

      <Panel title="Run checks" note={replaying ? `Computed when the run was recorded, in ${RECORDED_RUN_FILE}.` : "Computed when a run is gathered into evidence."}>
        {done && record.checks ? (
          <ul className="checks">
            {Object.entries(record.checks).map(([k, ok]) => (
              <li key={k} data-pass={ok}>
                {CHECK_LABELS[k] ?? k}
              </li>
            ))}
          </ul>
        ) : (
          <Waiting>Checked once the deal has settled.</Waiting>
        )}
      </Panel>

      <Panel title="What the checks cost" note="The model calls behind the message screen and the paperwork check, for this whole run.">
        {done && record.costUsd ? (
          <dl className="limits">
            <div>
              <dt>Message screen</dt>
              <dd className="num">${record.costUsd.bouncer.toFixed(6)}</dd>
            </div>
            <div>
              <dt>Paperwork check</dt>
              <dd className="num">${record.costUsd.verify.toFixed(6)}</dd>
            </div>
          </dl>
        ) : (
          <Waiting>Totalled once the deal has settled.</Waiting>
        )}
      </Panel>
    </>
  );

  return (
    <Arc
      label="Parts of the control room"
      flat={flat}
      initial={1}
      panes={[
        { id: "controls", title: "Limits and suppliers", note: "What a person decides. The agents work inside it.", body: controls },
        {
          id: "lanes",
          title: "The negotiation",
          note:
            eyes === "operator"
              ? "Every message, and what Surety did with it. Held messages are shown only here."
              : `Exactly what your Negotiator saw. Held messages never reached it. It was told to aim for ${usd(target)} and never shown your maximum.`,
          tools: (
            <div className="seg" role="group" aria-label="Whose eyes">
              <button type="button" aria-pressed={eyes === "operator"} onClick={() => setEyes("operator")}>
                Operator's eyes
              </button>
              <button type="button" aria-pressed={eyes === "negotiator"} onClick={() => setEyes("negotiator")}>
                Negotiator's eyes
              </button>
            </div>
          ),
          body: view.opened ? <Lanes view={view} eyes={eyes} /> : <Waiting>The sourcing has not opened yet.</Waiting>,
        },
        { id: "audit", title: "Audit", note: "What was stopped, every step in order, and the checks on the whole run.", body: audit },
      ]}
    />
  );
}
