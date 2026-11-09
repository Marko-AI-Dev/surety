import { useState } from "react";
import { CHAT_THRESHOLDS, DOCUMENTED_LIMITS, RECORDED_RUN_FILE } from "../data/evidence";
import { ruleOf, shortAddress, usd, utcTime } from "../data/format";
import { type MessageView, type RunView, negotiatorEyes } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { Cards, CardMark, Chip, Meter, Panel, Waiting } from "./bits";

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

function Verdict({ m }: { m: MessageView }) {
  const s = m.screen;
  const rule = ruleOf(s?.reasonCodes);
  if (m.delivered) {
    return (
      <div className="screen" data-verdict="deliver">
        <p className="screen-head">Bouncer: delivered</p>
        <p className="screen-detail num">
          Ordinary {s?.satisfaction?.toFixed(2) ?? "not scored"} (needs {CHAT_THRESHOLDS.deliverMinOrdinary.toFixed(2)} or more), steering{" "}
          {s?.injectionRisk?.toFixed(2) ?? "not scored"} (needs {CHAT_THRESHOLDS.deliverMaxSteering.toFixed(2)} or less)
        </p>
      </div>
    );
  }
  if (rule) {
    return (
      <div className="screen" data-verdict="red">
        <p className="screen-head">
          <CardMark card="red" /> Bouncer: held by code rule <code>{rule}</code>
        </p>
        <p className="screen-detail">{s?.rules?.results.find((x) => x.id === rule)?.detail}. The decision model was not asked.</p>
      </div>
    );
  }
  return (
    <div className="screen" data-verdict={m.card ?? "held"}>
      <p className="screen-head">
        {m.card ? <CardMark card={m.card} /> : null} Bouncer: held by the decision model
        {s?.samples ? `, asked ${s.samples.length} times` : ""}
      </p>
      <Meter label="Ordinary" value={s?.satisfaction} threshold={CHAT_THRESHOLDS.deliverMinOrdinary} good="above" />
      <Meter label="Steering" value={s?.injectionRisk} threshold={CHAT_THRESHOLDS.deliverMaxSteering} good="below" />
      {s?.samples ? <p className="screen-detail">Steering each time: {s.samples.map((x) => x.injectionRisk.toFixed(2)).join(", ")}. A card at {CHAT_THRESHOLDS.yellowMinSteering.toFixed(2)} or more.</p> : null}
    </div>
  );
}

function Lanes({ view, eyes }: { view: RunView; eyes: "operator" | "negotiator" }) {
  const inbox = negotiatorEyes(view.messages);
  return (
    <div className="lanes">
      {view.invites.map((inv) => {
        const mine = view.messages.filter((m) => m.supplier === inv.address);
        return (
          <article key={inv.address} className="lane" data-status={inv.status} data-invited={inv.invited}>
            <header className="lane-head">
              <h3>{inv.name}</h3>
              <p className="lane-meta">
                {!inv.invited ? (
                  "Not invited yet"
                ) : (
                  <>
                    <Chip tone={inv.status === "out" ? "stop" : "plain"}>{inv.status === "out" ? "Out" : "In"}</Chip>
                    <Cards {...inv.cards} />
                    {inv.quote && eyes === "operator" ? <Chip tone="money">Committed {usd(inv.quote.unitCents)}</Chip> : null}
                    {inv.quote && eyes === "negotiator" ? <Chip tone="plain">Committed</Chip> : null}
                  </>
                )}
              </p>
              <p className="mono lane-wallet">{shortAddress(inv.address)}</p>
            </header>
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
                : inbox
                    .filter((i) => i.supplier === inv.address)
                    .map((i) => (
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
            {inv.invited && mine.length === 0 ? <Waiting>No messages yet.</Waiting> : null}
          </article>
        );
      })}
    </div>
  );
}

export function Control({ record, view, replaying, seatUrl }: { record: SourcingRecord; view: RunView; replaying: boolean; seatUrl: string }) {
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

  return (
    <div className="control">
      <section className="negotiation">
        <header className="negotiation-head">
          <div>
            <h2>The negotiation</h2>
            <p className="panel-note">
              {eyes === "operator"
                ? "Everything, including what the bouncer held and why. Only the operator sees this."
                : `Exactly what the Negotiator's inbox carried. It knows the target, ${usd(target)}, and nothing about the maximum.`}
            </p>
          </div>
          <div className="seg" role="group" aria-label="Whose eyes">
            <button type="button" aria-pressed={eyes === "operator"} onClick={() => setEyes("operator")}>
              Operator's eyes
            </button>
            <button type="button" aria-pressed={eyes === "negotiator"} onClick={() => setEyes("negotiator")}>
              Negotiator's eyes
            </button>
          </div>
        </header>
        {view.opened ? <Lanes view={view} eyes={eyes} /> : <Waiting>The sourcing has not opened yet.</Waiting>}
      </section>

      <div className="grid controls">
        <Panel title="Limits the agents cannot change" note={`Signer policy version ${limits.policyVersion}. ${replaying ? `Not in the run record: ${DOCUMENTED_LIMITS.source}.` : limits.source}`}>
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
          <p className="fine">Set by the operator with a secret the agents and the worker never hold. The signer checks them on every lock.</p>
        </Panel>

        <Panel title="Approved suppliers" note="Wallets are fixed at approval and never typed at payment time.">
          <ul className="suppliers">
            {view.invites.map((i) => (
              <li key={i.address}>
                <span>
                  {i.name} <Cards {...i.cards} />
                </span>
                <span className="mono">{shortAddress(i.address)}</span>
                <Chip tone={i.cards.yellow + i.cards.red > 0 ? "held" : "ok"}>{i.cards.yellow + i.cards.red > 0 ? "On hold until you clear it" : "Clear"}</Chip>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Waiting for your approval" note="Agents can suggest a supplier. Only the operator can approve one.">
          {view.suggestions.length === 0 ? (
            <Waiting>No suggestions.</Waiting>
          ) : (
            <ul className="suggestions">
              {view.suggestions.map((s) => (
                <li key={s.id}>
                  <p>
                    <strong>{s.name}</strong> <Chip tone="held">Not approved, not invited</Chip>
                  </p>
                  <p className="mono">{s.address}</p>
                  <p className="fine">Sourcing agent: {s.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Held messages" note="Quarantined by the bouncer before any agent could read them.">
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
                    {ruleOf(m.screen?.reasonCodes)
                      ? `Code rule ${ruleOf(m.screen?.reasonCodes)}`
                      : `Decision model, steering ${m.screen?.injectionRisk?.toFixed(2) ?? "not scored"}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Audit trail" note="Every step in order. Steps marked with a ring have a recorded order but no recorded time." wide>
          <ol className="trail">
            {view.trail
              .filter((s) => s.kind !== "message" || s.title.includes("held"))
              .map((s) => (
                <li key={s.id} data-kind={s.kind} data-timed={s.timed}>
                  <time>{s.timed ? utcTime(s.at) : "untimed"}</time>
                  <span>
                    {s.title}
                    {s.detail ? <span className="trail-detail"> {s.detail}</span> : null}
                  </span>
                </li>
              ))}
          </ol>
          <p className="fine">
            Chat messages are in the lanes above; {view.messages.length} so far.
          </p>
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

        <Panel title="Decision-model cost" note="What the bouncer and Surety Verify cost for this run.">
          {done && record.costUsd ? (
            <dl className="limits">
              <div>
                <dt>Bouncer</dt>
                <dd className="num">${record.costUsd.bouncer.toFixed(6)}</dd>
              </div>
              <div>
                <dt>Surety Verify</dt>
                <dd className="num">${record.costUsd.verify.toFixed(6)}</dd>
              </div>
            </dl>
          ) : (
            <Waiting>Totalled once the deal has settled.</Waiting>
          )}
        </Panel>

        <Panel title="Let someone play a supplier" note="Open this on a phone. Practice mode needs no backend and runs the bouncer's real code rules.">
          <p className="seat-url mono">{seatUrl}</p>
          <p className="fine">
            <a href="#/supplier">Open the supplier seat here</a>
          </p>
        </Panel>
      </div>
    </div>
  );
}
