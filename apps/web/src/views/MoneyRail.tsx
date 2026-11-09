import { usd } from "../data/format";
import type { RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { useTween } from "../run";

// Where the money is, at every moment: treasury, XRPL escrow, supplier. The one thing every view keeps.
export function MoneyRail({ record, view }: { record: SourcingRecord; view: RunView }) {
  const m = view.money;
  const treasury = useTween(m.treasuryCents ?? 0);
  const escrow = useTween(m.escrowCents);
  const supplier = useTween(m.supplierCents);
  const brief = record.sourcing.brief;
  const chosen = view.accepted?.supplier.name ?? null;

  const lockLeg = view.locked ? (view.refunded ? "returned" : "done") : "idle";
  const payLeg = view.paid ? "done" : view.refunded ? "blocked" : "idle";
  const escrowState = view.paid ? "Released to the supplier" : view.refunded ? "Refunded to the treasury" : view.locked ? "Locked on the ledger" : "Nothing locked";

  return (
    <section className="rail" aria-label="Where the money is">
      <div className="rail-node">
        <p className="rail-role">Buyer treasury</p>
        <p className="rail-name">{brief.buyer.name}</p>
        <p className="rail-amount" aria-live="polite">
          {m.treasuryCents === null ? "Balance not in this record" : usd(treasury)}
        </p>
        <p className="rail-note">{m.treasuryCents === null ? "Read from the ledger when the run is recorded" : "Test dollars (TESTUSD), no value"}</p>
      </div>

      <div className="rail-leg" data-state={lockLeg}>
        <span className="rail-leg-line" aria-hidden="true" />
        <span className="rail-leg-label">
          {view.locked && record.create ? (
            <a href={record.create.explorer} target="_blank" rel="noreferrer">
              Lock, ledger {record.create.ledgerIndex}
            </a>
          ) : (
            "Lock"
          )}
        </span>
      </div>

      <div className="rail-node rail-escrow" data-state={view.locked && !view.paid && !view.refunded ? "holding" : "empty"}>
        <p className="rail-role">XRPL escrow</p>
        <p className="rail-name">{escrowState}</p>
        <p className="rail-amount" aria-live="polite">
          {usd(escrow)}
        </p>
        <p className="rail-note">
          {view.locked && !view.paid && !view.refunded
            ? `Released only if Surety Verify approves. Otherwise the ledger refunds it ${brief.deadlineSeconds} s after the lock.`
            : view.paid && record.finish
              ? `${record.finish.result}, validated`
              : "The agents cannot move it. Only the signer can lock, and only within the operator's limits."}
        </p>
      </div>

      <div className="rail-leg" data-state={payLeg}>
        <span className="rail-leg-line" aria-hidden="true" />
        <span className="rail-leg-label">
          {view.paid && record.finish ? (
            <a href={record.finish.explorer} target="_blank" rel="noreferrer">
              Release, ledger {record.finish.ledgerIndex}
            </a>
          ) : view.refunded && record.cancel ? (
            <a href={record.cancel.explorer} target="_blank" rel="noreferrer">
              Refund, ledger {record.cancel.ledgerIndex}
            </a>
          ) : (
            "Release"
          )}
        </span>
      </div>

      <div className="rail-node" data-state={view.paid ? "paid" : "waiting"}>
        <p className="rail-role">Supplier</p>
        <p className="rail-name">{chosen ?? "Not chosen yet"}</p>
        <p className="rail-amount" aria-live="polite">
          {usd(supplier)}
        </p>
        <p className="rail-note">{view.paid ? "Paid for this deal" : chosen ? "Paid only after Surety Verify" : "The Lead picks from committed quotes"}</p>
      </div>
    </section>
  );
}
