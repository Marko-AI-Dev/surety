import { type LogEntry, adminLog } from "./desk";
import { usd, utcTime } from "./format";
import { type RunView, silentUnnamed } from "./timeline";
import type { LedgerTx, SourcingRecord } from "./types";

// One purchase in the order it happens, worked out from the record alone: six steps, each with where
// it stands, one line of summary, the facts an auditor asks for and the events that belong to it.
// The buyer's deal rail and the admin's audit both read this, so they can never disagree. Pure, so it
// is tested without a screen.

export type StepId = "brief" | "suppliers" | "negotiating" | "decision" | "locked" | "settled";
export type StepState = "done" | "now" | "todo" | "stopped";

export interface DealStep {
  id: StepId;
  n: number;
  label: string;
  state: StepState;
  // A few words for the closed row.
  summary: string;
  // One or two plain sentences for the open row on the buyer's side.
  detail: string;
}

const PRIORITY = { price: "The lowest price matters most.", speed: "The fastest delivery matters most.", balanced: "A balance of price and speed." } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const totalCents = (record: SourcingRecord) => (record.job ? Number(record.job.amount.cents) : null);

export function dealSteps(record: SourcingRecord, view: RunView): DealStep[] {
  const brief = record.sourcing.brief;
  const shown = view.invites.filter((i) => i.invited && !silentUnnamed(i));
  const committed = shown.filter((i) => i.quote).length;
  const a = record.approval ?? null;
  const decided = a !== null || view.locked || view.accepted !== null;
  const total = totalCents(record);
  const money = total === null ? "The payment" : usd(total);

  const decision: Pick<DealStep, "state" | "summary" | "detail"> =
    a?.state === "waiting"
      ? { state: "now", summary: "Waiting for you", detail: "Your agent has recommended a deal. Nothing is locked until you say yes." }
      : a?.state === "approved"
        ? { state: "done", summary: "You said yes", detail: "You approved the deal your agent recommended." }
        : a?.state === "declined"
          ? { state: "stopped", summary: "You said no", detail: "You turned the deal down. Nothing was locked and nothing was paid." }
          : view.locked || view.accepted
            ? { state: "done", summary: "Chosen by the Lead agent", detail: "This purchase was recorded before the buyer's final yes was added." }
            : { state: "todo", summary: "Yes or no", detail: "Your agent brings you its recommendation, and you decide." };

  const locked: Pick<DealStep, "state" | "summary" | "detail"> = view.locked
    ? { state: "done", summary: `${money} locked`, detail: `${money} was locked on the XRP Ledger, not sent to the supplier.` }
    : a?.state === "approved"
      ? { state: "now", summary: "Locking", detail: "Your yes is in. The payment is being locked on the XRP Ledger." }
      : a?.state === "declined"
        ? { state: "todo", summary: "Nothing was locked", detail: "You said no, so no payment was created." }
        : { state: "todo", summary: "Only on your yes", detail: "The payment locks only after you say yes." };

  const settled: Pick<DealStep, "label" | "state" | "summary" | "detail"> = view.paid
    ? { label: "Checked and paid", state: "done", summary: "Supplier paid", detail: `The paperwork passed, the inspector confirmed the shipment, and ${money.toLowerCase() === "the payment" ? "the payment" : money} was released to the supplier.` }
    : view.refunded
      ? { label: "Refunded", state: "stopped", summary: "Money returned to you", detail: "A check did not pass, so the money came back to you. The supplier was not paid." }
      : view.locked
        ? { label: "Checked and paid", state: "now", summary: "Waiting for the checks", detail: "The money is released only when the paperwork passes and the inspector confirms the shipment. Otherwise it comes back to you." }
        : { label: "Checked and paid", state: "todo", summary: "After inspection", detail: "Paid only after the paperwork and the inspector's check." };

  const steps: Omit<DealStep, "n">[] = [
    {
      id: "brief",
      label: "Your brief",
      state: "done",
      summary: "Done",
      detail: `${brief.goods.quantity.toLocaleString("en-US")} x ${brief.goods.description}. Aim for ${usd(brief.goods.targetUnitCents)}, never above ${usd(brief.goods.maxUnitCents)}${brief.latestDeliveryDays ? `, within ${brief.latestDeliveryDays} days` : ""}. ${PRIORITY[brief.priority ?? "balanced"]}`,
    },
    {
      id: "suppliers",
      label: "Suppliers invited",
      state: shown.length > 0 ? "done" : "now",
      summary: shown.length > 0 ? `${shown.length} invited` : "Inviting",
      detail: shown.length > 0 ? `From your approved list: ${list(shown.map((i) => i.name))}.` : "Your Sourcing agent is inviting the suppliers on your approved list.",
    },
    {
      id: "negotiating",
      label: "Negotiating",
      state: decided ? "done" : shown.length > 0 ? "now" : "todo",
      summary: decided ? plural(committed, "final price") : shown.length > 0 ? "Now" : "Next",
      detail: decided ? `${plural(committed, "supplier")} gave a final price.` : "Your negotiator is writing to each supplier. You see every message.",
    },
    { id: "decision", label: "Your decision", ...decision },
    { id: "locked", label: "Payment locked", ...locked },
    { id: "settled", ...settled },
  ];
  return steps.map((s, i) => ({ ...s, n: i + 1 }));
}

// The step to show open: the one in progress, else the last one that finished or stopped.
export function currentStep(steps: DealStep[]): StepId {
  return (steps.find((s) => s.state === "now") ?? [...steps].reverse().find((s) => s.state !== "todo") ?? steps[0])?.id ?? "brief";
}

export interface AuditStage extends DealStep {
  facts: { label: string; value: string }[];
  events: LogEntry[];
  tx: LedgerTx | null;
}

// The same six steps for the admin: each with the facts an auditor asks for and its own events.
export function auditStages(record: SourcingRecord, view: RunView): AuditStage[] {
  const brief = record.sourcing.brief;
  const log = adminLog(record, view);
  const shown = view.invites.filter((i) => i.invited && !silentUnnamed(i));
  const a = record.approval ?? null;
  const total = totalCents(record);
  const nameOf = (address: string) => record.invites.find((i) => i.address === address)?.name ?? address;

  const facts: Record<StepId, { label: string; value: string }[]> = {
    brief: [
      { label: "Goods", value: `${brief.goods.quantity.toLocaleString("en-US")} x ${brief.goods.description}, ${brief.incoterm} ${brief.port}` },
      { label: "Price", value: `Target ${usd(brief.goods.targetUnitCents)}, maximum ${usd(brief.goods.maxUnitCents)} a unit. The negotiator never saw the maximum.` },
      ...(brief.latestDeliveryDays ? [{ label: "Delivery", value: `Within ${brief.latestDeliveryDays} days.` }] : []),
      { label: "What matters most", value: PRIORITY[brief.priority ?? "balanced"] },
    ],
    suppliers: view.invites
      .filter((i) => i.invited)
      .map((i) => ({ label: i.unnamed ? "A wallet with no name" : i.name, value: i.status === "out" ? "Invited, then removed by Surety." : i.unnamed && !i.replied ? "Invited from the approved list. Never answered." : "Invited from the approved list." })),
    negotiating: shown.map((i) => {
      const reports = view.messages.filter((m) => m.supplier === i.address && m.kind === "report" && m.offer);
      const first = reports[0]?.offer;
      const last = reports.at(-1)?.offer;
      const stopped = view.messages.filter((m) => m.supplier === i.address && m.kind === "from_supplier" && !m.delivered).length;
      const price = !first || !last ? "No price reported." : first.unitCents === last.unitCents ? `${usd(last.unitCents)}, ${last.deliveryDays} days.` : `${usd(first.unitCents)} to ${usd(last.unitCents)}, ${last.deliveryDays} days.`;
      return { label: i.name, value: `${price}${stopped > 0 ? ` ${plural(stopped, "message")} stopped by the bouncer.` : ""}` };
    }),
    decision: a
      ? [
          { label: "Recommended by", value: `Lead (agent): ${nameOf(a.supplier)}. ${a.leadReason}`.trim() },
          {
            label: "Decided by",
            value: a.state === "waiting" ? "Waiting for the buyer. Nothing is locked." : a.state === "approved" ? `The buyer said yes${a.answeredAt ? ` at ${utcTime(Date.parse(a.answeredAt))}` : ""}. Nothing was locked before this.` : `The buyer said no${a.answeredAt ? ` at ${utcTime(Date.parse(a.answeredAt))}` : ""}. Nothing was locked or paid.`,
          },
          ...shown.filter((i) => i.quote && i.address !== a.supplier).map((i) => ({ label: "Other offer", value: `${i.name} at ${usd(i.quote?.unitCents ?? 0)}. Not chosen.` })),
        ]
      : view.accepted
        ? [{ label: "Decided by", value: "The Lead agent. This purchase was recorded before the buyer's final yes was added." }]
        : [],
    locked: view.locked ? [{ label: "Amount", value: `${total === null ? "The payment" : usd(total)} locked on the XRP Ledger.` }, { label: "Signed by", value: "Surety's signer, within the limits a person set." }] : [],
    settled: [
      ...(record.verify ? [{ label: "Paperwork", value: record.verify.outcome === "APPROVE" ? "The invoice and shipping document match the order." : "The paperwork did not pass the check." }] : []),
      ...(record.inspection && record.inspection.state !== "pending"
        ? [{ label: "Inspector (a person)", value: `${record.inspection.state === "attested" ? "Confirmed" : "Did not confirm"} the shipment${record.inspection.blNumber ? `. Shipping document ${record.inspection.blNumber}` : ""}${record.inspection.note ? `: ${record.inspection.note}` : ""}.` }]
        : []),
      ...(view.paid ? [{ label: "Released", value: `${total === null ? "The payment" : usd(total)} to ${record.job ? nameOf(record.job.seller) : "the supplier"}.` }] : []),
      ...(view.refunded ? [{ label: "Returned", value: `${total === null ? "The payment" : usd(total)} to the buyer. The supplier was not paid.` }] : []),
    ],
  };
  const tx: Record<StepId, LedgerTx | null> = { brief: null, suppliers: null, negotiating: null, decision: null, locked: view.locked ? (record.create ?? null) : null, settled: view.paid ? (record.finish ?? null) : view.refunded ? (record.cancel ?? null) : null };
  return dealSteps(record, view).map((s) => ({ ...s, facts: facts[s.id], events: log.filter((e) => e.stage === s.id), tx: tx[s.id] }));
}
