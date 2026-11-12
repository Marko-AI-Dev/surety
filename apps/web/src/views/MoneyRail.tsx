import { usd } from "../data/format";
import type { RunView } from "../data/timeline";
import type { SourcingRecord } from "../data/types";
import { useTween } from "../run";
import { Term } from "./bits";

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
  const escrowState = view.paid ? "Released to the supplier" : view.refunded ? "Returned to you" : view.locked ? "Held for the supplier" : "Nothing locked yet";

  return (
    <section className="rail" aria-label="Where the money is" data-treasury={m.treasuryCents === null ? "hidden" : "shown"}>
      {m.treasuryCents === null ? null : (
        <div className="rail-node">
        <p className="rail-role">Your money</p>
        <p className="rail-name">{brief.buyer.name}</p>
        <p className="rail-amount" aria-live="polite">
          {usd(treasury)}
        </p>
        <p className="rail-note">Test dollars, no real value</p>
        </div>
      )}

      <div className="rail-leg" data-state={lockLeg}>
        <span className="rail-leg-line" aria-hidden="true" />
        <span className="rail-leg-label">
          {view.locked && record.create ? (
            <a href={record.create.explorer} target="_blank" rel="noreferrer">
              Locked. See it on the ledger
            </a>
          ) : (
            "Lock"
          )}
        </span>
      </div>

      <div className="rail-node rail-escrow" data-state={view.locked && !view.paid && !view.refunded ? "holding" : "empty"}>
        <p className="rail-role">
          <Term k="escrow" />
        </p>
        <p className="rail-name">{escrowState}</p>
        <p className="rail-amount" aria-live="polite">
          {usd(escrow)}
        </p>
        <p className="rail-note">
          {view.locked && !view.paid && !view.refunded
            ? `Released only if the paperwork checks out. Otherwise the ledger returns it to you.`
            : view.paid && record.finish
              ? "Confirmed on the ledger"
              : "Your agents cannot move money. It locks only within the limits a person set."}
        </p>
      </div>

      <div className="rail-leg" data-state={payLeg}>
        <span className="rail-leg-line" aria-hidden="true" />
        <span className="rail-leg-label">
          {view.paid && record.finish ? (
            <a href={record.finish.explorer} target="_blank" rel="noreferrer">
              Paid. See it on the ledger
            </a>
          ) : view.refunded && record.cancel ? (
            <a href={record.cancel.explorer} target="_blank" rel="noreferrer">
              Refunded. See it on the ledger
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
        <p className="rail-note">{view.paid ? "Paid for this deal" : chosen ? "Paid only after the paperwork check" : "Your Lead agent picks one"}</p>
      </div>
    </section>
  );
}
