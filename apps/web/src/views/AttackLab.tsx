import { useMemo, useState } from "react";
import { type AttackCase, type StoppedAt, attackCounters, chatAttacks, dealAttacks, signerAttacks } from "../data/attacks";
import { dealsEvidence, recordedRun, signerEvidence } from "../data/evidence";
import { usd } from "../data/format";
import { Detail } from "./Spatial";
import { Chip } from "./bits";

// The layers in the order a purchase meets them. An attack is listed under the layer that stopped it.
const LAYERS: { at: StoppedAt; what: string }[] = [
  { at: "Bouncer, code rule", what: "Code reads every supplier message for wallets and bank details before any agent does." },
  { at: "Bouncer, decision model", what: "Then a decision model scores whether the message steers the buyer's agents." },
  { at: "Sourcing rule", what: "Agents can invite approved suppliers only." },
  { at: "Policy step", what: "A deal cannot open for a wallet the operator has not approved." },
  { at: "Quote check", what: "A committed quote is checked against the brief and the live limits, whatever the agent says." },
  { at: "Surety Verify, rule", what: "The documents are compared with the order by code. A failed rule is final." },
  { at: "Surety Verify, decision model", what: "Free text in the documents is scored for instructions to the payer." },
  { at: "Signer", what: "The only holder of keys refuses any lock outside the operator's limits." },
];

export function AttackLab() {
  const cases = useMemo<AttackCase[]>(() => [...chatAttacks(recordedRun), ...dealAttacks(dealsEvidence), ...signerAttacks(signerEvidence)], []);
  const counters = attackCounters(cases);
  const [open, setOpen] = useState<string | null>(null);
  const picked = cases.find((c) => c.id === open);
  const layerNo = (c: AttackCase) => LAYERS.findIndex((l) => l.at === c.stoppedAt) + 1;
  return (
    <div className="attack">
      <section className="attack-top glass">
        <header className="attack-head">
          <div>
            <h2>Attack lab</h2>
            <p className="attack-lead">
              {counters.attempts} real attempts to cheat the system. {counters.gotThrough === 0 ? "None got through." : `${counters.gotThrough} got through.`}
            </p>
            <p className="panel-note">Each one was run on the test ledger on 9 Nov 2026 and is read from the recorded evidence. Nothing here is simulated. Select one to see what happened.</p>
          </div>
          <dl className="counters">
            <div>
              <dt>Attempts</dt>
              <dd className="num">{counters.attempts}</dd>
            </div>
            <div>
              <dt>Got through</dt>
              <dd className="num" data-tone={counters.gotThrough === 0 ? "ok" : "stop"}>
                {counters.gotThrough}
              </dd>
            </div>
            <div>
              <dt>Money lost</dt>
              <dd className="num" data-tone={counters.moneyToAttackersCents === 0 ? "ok" : "stop"}>
                {usd(counters.moneyToAttackersCents)}
              </dd>
            </div>
          </dl>
        </header>

        <ol className="layer-strip" aria-label="The layers a purchase meets, in order">
          {LAYERS.map((layer, n) => {
            const count = cases.filter((c) => c.stoppedAt === layer.at).length;
            return (
              <li key={layer.at}>
                <span className="layer-n num">{n + 1}</span>
                <span className="layer-name">{layer.at}</span>
                <span className="layer-what">{layer.what}</span>
                <span className="layer-count num">Stopped {count}</span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Each case is a short card. Picking one brings the whole record of it forward. */}
      <ul className="cases">
        {LAYERS.flatMap((layer, n) =>
          cases
            .filter((c) => c.stoppedAt === layer.at)
            .map((c) => (
              <li key={c.id}>
                <button type="button" className="case" onClick={() => setOpen(c.id)}>
                  <span className="case-layer">
                    <Chip tone="stop">
                      Stopped at {n + 1}. {layer.at}
                    </Chip>
                  </span>
                  <span className="case-title">{c.title}</span>
                  <span className="case-outcome">{c.outcome}</span>
                </button>
              </li>
            )),
        )}
      </ul>

      {picked ? (
        <Detail title={picked.title} onClose={() => setOpen(null)}>
          <p className="detail-lead">
            <Chip tone="stop">
              Stopped at {layerNo(picked)}. {picked.stoppedAt}
            </Chip>
          </p>
          <h3 className="detail-sub">What was tried</h3>
          <p className="case-tried">{picked.tried}</p>
          <h3 className="detail-sub">What the record says</h3>
          <p className="case-recorded">{picked.recorded}</p>
          <h3 className="detail-sub">Outcome</h3>
          <p>
            {picked.outcome}{" "}
            {picked.link ? (
              <a href={picked.link.href} target="_blank" rel="noreferrer">
                {picked.link.label}
              </a>
            ) : null}
          </p>
          <p className="fine mono">{picked.source}</p>
        </Detail>
      ) : null}
    </div>
  );
}
