import type { RunView } from "./timeline";
import type { Card, SourcingRecord } from "./types";

// What the Buy view shows: the negotiation as one conversation, and the deal as a row of stages.
// Pure, like the timeline. The buyer sees less than the operator on purpose: no scores, no rule ids,
// and never the text of a message the bouncer held.

export type FeedItem =
  | { key: string; kind: "negotiator"; atMs: number; text: string; to: string[]; suppliers: string[] }
  | { key: string; kind: "supplier"; atMs: number; supplier: string; name: string; text: string }
  | { key: string; kind: "held"; atMs: number; supplier: string; name: string; card: Card | null; removed: boolean }
  | { key: string; kind: "quote"; atMs: number; supplier: string; name: string; unitCents: number; overMaximum: boolean };

// The negotiator often sends the same line to every supplier at once. Those become one bubble.
const SAME_MOMENT_MS = 5_000;

export function buyerFeed(record: SourcingRecord, view: RunView): FeedItem[] {
  const name = (address: string) => view.invites.find((i) => i.address === address)?.name ?? address;
  const max = record.sourcing.brief.goods.maxUnitCents;
  const items: FeedItem[] = [];
  const cards = new Map<string, { yellow: number; red: number }>();

  for (const step of view.trail) {
    if (step.kind === "quote" && step.supplier) {
      const quote = record.invites.find((i) => i.address === step.supplier)?.quote;
      if (quote) {
        items.push({ key: step.id, kind: "quote", atMs: step.at, supplier: step.supplier, name: name(step.supplier), unitCents: quote.unitCents, overMaximum: quote.unitCents > max });
      }
      continue;
    }
    if (step.kind !== "message" || step.messageIndex === undefined) continue;
    const m = record.messages[step.messageIndex];
    if (!m || m.kind === "report") continue;

    if (m.kind === "to_supplier") {
      const last = items[items.length - 1];
      if (last?.kind === "negotiator" && last.text === m.body && step.at - last.atMs <= SAME_MOMENT_MS && !last.suppliers.includes(m.supplier)) {
        last.to.push(name(m.supplier));
        last.suppliers.push(m.supplier);
      } else {
        items.push({ key: step.id, kind: "negotiator", atMs: step.at, text: m.body, to: [name(m.supplier)], suppliers: [m.supplier] });
      }
    } else if (m.delivered) {
      items.push({ key: step.id, kind: "supplier", atMs: step.at, supplier: m.supplier, name: name(m.supplier), text: m.body });
    } else {
      const c = cards.get(m.supplier) ?? { yellow: 0, red: 0 };
      const wasOut = c.red > 0 || c.yellow >= 2;
      if (m.card === "yellow") c.yellow++;
      if (m.card === "red") c.red++;
      cards.set(m.supplier, c);
      const isOut = c.red > 0 || c.yellow >= 2;
      items.push({ key: step.id, kind: "held", atMs: step.at, supplier: m.supplier, name: name(m.supplier), card: m.card, removed: isOut && !wasOut });
    }
  }
  return items;
}

export type StageState = "done" | "now" | "todo" | "stopped" | "off";

export interface Stage {
  id: "brief" | "suppliers" | "negotiation" | "decision" | "locked" | "documents" | "inspector" | "verify" | "settled";
  label: string;
  state: StageState;
  note: string;
}

// The deal from brief to payout. The inspector's stage is always in the row: "off" when the record
// has no second key, so the place it will take is visible before the API exists.
export function dealStages(record: SourcingRecord, view: RunView): Stage[] {
  const invited = view.invites.filter((i) => i.invited).length;
  const committed = view.invites.filter((i) => i.quote).length;
  const talking = view.messages.some((m) => m.kind === "to_supplier");
  const declined = view.decisions.length > 0 && !view.accepted;
  const verifyFailed = view.verified && record.verify?.outcome !== "APPROVE";
  const step = (done: boolean, started: boolean): StageState => (done ? "done" : started ? "now" : "todo");

  const inspector: Stage =
    view.inspection === "none"
      ? { id: "inspector", label: "Inspector", state: "off", note: "A second check, coming soon. Not part of this run" }
      : view.inspection === "attested"
        ? { id: "inspector", label: "Inspector", state: "done", note: "Confirmed the shipment" }
        : view.inspection === "refused"
          ? { id: "inspector", label: "Inspector", state: "stopped", note: "Did not confirm the shipment" }
          : { id: "inspector", label: "Inspector", state: view.documents ? "now" : "todo", note: view.documents ? "Waiting for confirmation" : "Confirms the shipment" };

  const settled: Stage = view.paid
    ? { id: "settled", label: "Paid", state: "done", note: "Supplier has the money" }
    : view.refunded
      ? { id: "settled", label: "Refunded", state: "stopped", note: "You have the money back" }
      : { id: "settled", label: "Paid", state: view.verified && !verifyFailed ? "now" : "todo", note: "Or you are refunded" };

  return [
    { id: "brief", label: "Brief", state: step(view.opened, false), note: view.opened ? "What to buy, and the most to pay" : "Not opened yet" },
    {
      id: "suppliers",
      label: "Suppliers",
      state: step(invited > 0 && talking, view.opened),
      note: invited > 0 ? `${invited} invited from your approved list` : "From your approved list",
    },
    {
      id: "negotiation",
      label: "Negotiation",
      state: step(view.closed, talking),
      note: view.closed ? `${committed} final price${committed === 1 ? "" : "s"} submitted` : talking ? "In progress" : "Agents ask for a better price",
    },
    {
      id: "decision",
      label: "Decision",
      state: view.accepted ? "done" : declined ? "stopped" : view.closed ? "now" : "todo",
      note: view.accepted ? `${view.accepted.supplier.name}` : declined ? "Nothing accepted yet" : "Your Lead agent picks one",
    },
    { id: "locked", label: "Money locked", state: step(view.locked, view.accepted !== null), note: view.locked ? "Held by the ledger" : "Held by the ledger, not by anyone" },
    { id: "documents", label: "Paperwork", state: step(view.documents, view.locked), note: view.documents ? "Invoice and shipping document" : "Sent by the supplier" },
    inspector,
    {
      id: "verify",
      label: "Check",
      state: verifyFailed ? "stopped" : step(view.verified, view.documents && view.inspection !== "waiting"),
      note: view.verified ? (verifyFailed ? "Paperwork did not match" : "Paperwork matches the order") : "Does the paperwork match the order",
    },
    settled,
  ];
}
