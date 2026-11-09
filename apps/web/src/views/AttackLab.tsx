import { useMemo } from "react";
import { type AttackCase, type StoppedAt, attackCounters, chatAttacks, dealAttacks, signerAttacks } from "../data/attacks";
import { dealsEvidence, recordedRun, signerEvidence } from "../data/evidence";
import { usd } from "../data/format";
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
  return (
    <div className="attack">
      <header className="attack-head">
        <div>
          <h2>Attack lab</h2>
          <p className="panel-note">
            Every case below was run on XRPL Testnet on 9 Nov 2026 and is read from the evidence files. None is simulated here, and the counters are
            counted from those files.
          </p>
        </div>
        <dl className="counters">
          <div>
            <dt>Recorded attempts</dt>
            <dd className="num">{counters.attempts}</dd>
          </div>
          <div>
            <dt>Got through</dt>
            <dd className="num" data-tone={counters.gotThrough === 0 ? "ok" : "stop"}>
              {counters.gotThrough}
            </dd>
          </div>
          <div>
            <dt>Money moved to attackers</dt>
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

      <ul className="cases">
        {LAYERS.flatMap((layer, n) =>
          cases
            .filter((c) => c.stoppedAt === layer.at)
            .map((c) => (
              <li key={c.id} className="case">
                <p className="case-layer">
                  <Chip tone="stop">
                    Stopped at {n + 1}. {layer.at}
                  </Chip>
                </p>
                <h3>{c.title}</h3>
                <p className="case-tried">{c.tried}</p>
                <p className="case-recorded">{c.recorded}</p>
                <p className="case-outcome">
                  {c.outcome}{" "}
                  {c.link ? (
                    <a href={c.link.href} target="_blank" rel="noreferrer">
                      {c.link.label}
                    </a>
                  ) : null}
                </p>
                <p className="fine mono">{c.source}</p>
              </li>
            )),
        )}
      </ul>
    </div>
  );
}
