import { useState } from "react";
import { DOCUMENTED_LIMITS } from "../data/evidence";
import { shortAddress, usd, utcTime } from "../data/format";
import { verdictPlain } from "../data/plain";
import type { RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { Conversations } from "./Conversations";
import { SeatQr } from "./SeatQr";
import { Arc } from "./Spatial";
import { Cards, CardMark, Chip, More, Panel, Term, Waiting } from "./bits";

const CHECK_LABELS: Record<string, string> = {
  crookOut: "The crook is out of the sourcing",
  quarantinedNeverInInbox: "No held message is in the Negotiator's inbox",
  maxNeverShownToNegotiator: "The maximum is in nothing the API showed the Negotiator",
  strangerSuggestedNotInvited: "The unapproved supplier was suggested, not invited",
  winnerIsCheapestValidCommitted: "The winner is the cheapest valid committed quote",
  paidFinishValidated: "The payout is a validated ledger result",
  treasuryDownByExactlyTotal: "The treasury is down by exactly the deal total",
  everyLeadDecisionHasReason: "Every Lead decision has a reason",
  crookKeptOut: "The crook was kept out of the purchase",
  winnerBestForPriorityOrNoted: "The winner is the best for the buyer's priority, or the exception is noted",
  negotiationMovedPrice: "The negotiation moved the price",
  leverageCitedAnonymously: "Other suppliers' offers were cited without naming them",
  committedQuotesCarryDeliveryDays: "Every final price carries a delivery time",
  inspectionAttestedBeforePaid: "The inspector confirmed before anything was paid",
  refusedAttestationRefunded: "The inspector's refusal stopped the payment and the buyer was refunded",
  treasuryBackToBefore: "The treasury is back to where it started",
};

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
        <SeatQr page="supplier" tokenLabel="Supplier token for the judge's seat" tokenHelp="The code now opens the live seat as that supplier." />
      </Panel>

      <Panel title="The inspector's phone" note="The second key. Scan this with the inspector's own phone, never on the big screen.">
        <SeatQr page="inspector" tokenLabel="Inspector token" tokenHelp="The code now opens the inspector's page. Whoever scans it can confirm or refuse a shipment." />
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

      <Panel title="Run checks" note={replaying ? "Computed from the ledger and the database when the run was recorded." : "Computed when a run is gathered into evidence."}>
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
          body: view.opened ? <Conversations record={record} view={view} eyes={eyes} /> : <Waiting>The purchase has not opened yet.</Waiting>,
        },
        { id: "audit", title: "Audit", note: "What was stopped, every step in order, and the checks on the whole run.", body: audit },
      ]}
    />
  );
}
