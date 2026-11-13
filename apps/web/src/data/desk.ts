import { usd, utcTime } from "./format";
import { verdictPlain } from "./plain";
import type { RunView } from "./timeline";
import type { LedgerTx, SourcingRecord } from "./types";

// The buyer's desk, worked out from the record alone: where the purchase stands for the buyer, the
// deals put in front of them, each conversation as a thread with the buyer copied in, the parcel-style
// tracker after payment, and the plain-words log for the admin. Pure, so it is tested without a screen.

export type DeskStage =
  | "ask" // nothing running: say what you need
  | "working" // the team is inviting suppliers and negotiating
  | "review" // the Lead recommends a deal and waits for the buyer's yes
  | "declined" // the buyer said no; nothing moved
  | "tracking" // the payment is locked; the deal is on its way
  | "done" // the supplier was paid
  | "refunded"; // the money came back

export function deskStage(record: SourcingRecord | null, view: RunView | null): DeskStage {
  if (!record || !view) return "ask";
  if (view.paid) return "done";
  if (view.refunded) return "refunded";
  if (view.locked) return "tracking";
  if (record.approval?.state === "waiting") return "review";
  if (record.approval?.state === "declined") return "declined";
  return "working";
}

const nameOf = (record: SourcingRecord, address: string) => record.invites.find((i) => i.address === address)?.name ?? address;

export interface ReviewDeal {
  supplier: string;
  name: string;
  unitCents: number;
  totalCents: number;
  deliveryDays: number | null;
  eligible: boolean;
  why: string;
  pick: boolean;
}

// What the Lead puts in front of the buyer: every committed quote in Surety's order for the buyer's
// priority, the Lead's pick marked, and its reason in its own words.
export function reviewOf(record: SourcingRecord): { deals: ReviewDeal[]; pick: ReviewDeal | null; reason: string; dealId: string } | null {
  const a = record.approval;
  if (!a) return null;
  const quantity = record.sourcing.brief.goods.quantity;
  const ranked = record.ranking ?? [];
  const rows: ReviewDeal[] = ranked.map((q) => ({
    supplier: q.supplier,
    name: nameOf(record, q.supplier),
    unitCents: q.unitCents,
    totalCents: q.unitCents * quantity,
    deliveryDays: q.deliveryDays,
    eligible: q.eligible,
    why: q.why,
    pick: q.supplier === a.supplier,
  }));
  // The ranking can be missing from a record; every committed quote is still shown, the pick first.
  for (const invite of record.invites) {
    if (!invite.quote || invite.status === "out" || rows.some((r) => r.supplier === invite.address)) continue;
    const row: ReviewDeal = { supplier: invite.address, name: invite.name, unitCents: invite.quote.unitCents, totalCents: invite.quote.totalCents, deliveryDays: invite.deliveryDays ?? null, eligible: true, why: "", pick: invite.address === a.supplier };
    if (row.pick) rows.unshift(row);
    else rows.push(row);
  }
  return { deals: rows, pick: rows.find((r) => r.pick) ?? null, reason: a.leadReason, dealId: a.dealId };
}

export interface Mail {
  key: string;
  at: number;
  from: string;
  to: string;
  // The buyer is copied in on everything its negotiator sends and receives.
  body: string | null;
  // A message Surety stopped: never shown as text here, only that it was stopped and why.
  held: { tone: "held" | "stop"; text: string; card: "yellow" | "red" | null } | null;
  mine: boolean;
}

// One supplier's conversation as an email thread, oldest first. The negotiator's reports to the Lead
// are not part of the thread.
export function threadOf(record: SourcingRecord, view: RunView, supplier: string): Mail[] {
  const name = nameOf(record, supplier);
  return view.messages
    .filter((m) => m.supplier === supplier && m.kind !== "report")
    .map((m) => {
      const mine = m.kind === "to_supplier";
      const verdict = verdictPlain(m);
      return {
        key: `${m.index}`,
        at: m.atMs,
        from: mine ? "Your negotiator" : name,
        to: mine ? name : "Your negotiator",
        body: mine || m.delivered ? m.body : null,
        held: mine || m.delivered ? null : { tone: verdict.tone === "stop" ? "stop" : "held", text: verdict.text, card: m.card },
        mine,
      };
    });
}

export interface TrackStep {
  id: "locked" | "paperwork" | "inspector" | "check" | "paid" | "delivery";
  label: string;
  detail: string;
  state: "done" | "now" | "todo" | "stopped";
  tx: LedgerTx | null;
  // True for the one step this build cannot follow for real.
  notTracked?: boolean;
}

export interface Tracker {
  steps: TrackStep[];
  supplier: string;
  totalCents: number;
  blNumber: string | null;
  // From the day the payment locked to the day the supplier promised delivery.
  lockedAt: number | null;
  promisedAt: number | null;
  deliveryDays: number | null;
  // 0 to 1: how far today is along that bar.
  progress: number;
}

const DAY = 86_400_000;

export function trackerOf(record: SourcingRecord, view: RunView, now: number): Tracker | null {
  if (!view.locked || !view.accepted) return null;
  const supplier = view.accepted.supplier.address;
  const invite = record.invites.find((i) => i.address === supplier);
  const lockedStep = view.trail.find((s) => s.kind === "locked");
  const lockedAt = lockedStep?.at ?? null;
  const deliveryDays = invite?.deliveryDays ?? null;
  const promisedAt = lockedAt !== null && deliveryDays !== null ? lockedAt + deliveryDays * DAY : null;
  const insp = record.inspection ?? null;
  const stopped = view.refunded;
  const state = (done: boolean, isNow: boolean): TrackStep["state"] => (done ? "done" : stopped ? "stopped" : isNow ? "now" : "todo");
  const inspected = view.inspection === "attested";
  const steps: TrackStep[] = [
    { id: "locked", label: "Payment locked", detail: `${usd(view.money.totalCents)} is held on the XRP Ledger for ${nameOf(record, supplier)}.`, state: "done", tx: record.create ?? null },
    { id: "paperwork", label: "Supplier sent the paperwork", detail: view.documents ? "Invoice and shipping document received." : "Waiting for the invoice and the shipping document.", state: state(view.documents, true), tx: null },
    {
      id: "inspector",
      label: "Inspector checked the shipment",
      detail:
        view.inspection === "attested"
          ? `Confirmed. Shipping document ${insp?.blNumber ?? ""}${insp?.note ? `: "${insp.note}"` : ""}`
          : view.inspection === "refused"
            ? `Not confirmed${insp?.note ? `: "${insp.note}"` : "."}`
            : "A person, not an agent, confirms the shipment from a phone.",
      state: view.inspection === "refused" ? "stopped" : state(inspected, view.documents),
      tx: null,
    },
    { id: "check", label: "Paperwork checked against your order", detail: view.verified ? "It matches." : "Surety checks the paperwork before any money is released.", state: state(view.verified, inspected), tx: null },
    {
      id: "paid",
      label: stopped ? "Money returned to you" : "Supplier paid",
      detail: view.paid ? `${usd(view.money.totalCents)} released to the supplier.` : stopped ? `${usd(view.money.totalCents)} is back with you. Nothing was paid.` : "Released only after the two steps above.",
      state: view.paid || stopped ? "done" : state(false, view.verified),
      tx: view.paid ? (record.finish ?? null) : stopped ? (record.cancel ?? null) : null,
    },
  ];
  if (!stopped) {
    steps.push({
      id: "delivery",
      label: "Delivery",
      detail: deliveryDays !== null ? `Promised within ${deliveryDays} days of the payment.` : "The supplier gave no delivery time.",
      state: "todo",
      tx: null,
      notTracked: true,
    });
  }
  const progress = lockedAt !== null && promisedAt !== null ? Math.min(1, Math.max(0, (now - lockedAt) / (promisedAt - lockedAt))) : 0;
  return { steps, supplier: nameOf(record, supplier), totalCents: view.money.totalCents, blNumber: inspected ? (insp?.blNumber ?? null) : null, lockedAt, promisedAt, deliveryDays, progress };
}

export interface LogEntry {
  key: string;
  at: number;
  time: string;
  who: string;
  what: string;
  tone: "plain" | "ok" | "held" | "stop" | "money";
  tx: LedgerTx | null;
}

// Everything that happened, oldest first, in plain words: who said what, which agent did what, every
// check and every transaction with its ledger link.
export function adminLog(record: SourcingRecord, view: RunView): LogEntry[] {
  const out: LogEntry[] = [];
  const add = (key: string, at: number, who: string, what: string, tone: LogEntry["tone"] = "plain", tx: LedgerTx | null = null) => out.push({ key, at, time: utcTime(at), who, what, tone, tx });
  for (const s of view.trail) {
    if (s.kind === "message" && s.messageIndex !== undefined) {
      const m = view.messages.find((x) => x.index === s.messageIndex);
      if (!m) continue;
      const name = nameOf(record, m.supplier);
      if (m.kind === "to_supplier") add(s.id, s.at, "Negotiator (agent)", `Wrote to ${name}: "${m.body}"`);
      else if (m.kind === "report") add(s.id, s.at, "Negotiator (agent)", m.offer ? `Reported to the Lead that ${name} offers ${usd(m.offer.unitCents)} a unit in ${m.offer.deliveryDays} days.` : `Reported to the Lead about ${name}.`);
      else if (m.delivered) add(s.id, s.at, name, `Wrote: "${m.body}"`);
      else add(s.id, s.at, "Surety's bouncer", `Stopped a message from ${name} before any agent read it${m.card ? ` and gave a ${m.card} card` : ""}. ${verdictPlain(m).text}`, m.card === "red" ? "stop" : "held");
      continue;
    }
    const tx = s.kind === "locked" ? (record.create ?? null) : s.kind === "paid" ? (record.finish ?? null) : s.kind === "refunded" ? (record.cancel ?? null) : null;
    const who =
      s.kind === "locked" || s.kind === "paid" || s.kind === "refunded"
        ? "Surety's signer"
        : s.kind === "inspected"
          ? "Inspector (a person)"
          : s.kind === "verified"
            ? "Surety Verify"
            : s.supplier
              ? nameOf(record, s.supplier)
              : "Your team";
    add(s.id, s.at, who, s.detail ? `${s.title}. ${s.detail}` : s.title, s.kind === "paid" ? "ok" : s.kind === "refunded" ? "stop" : s.kind === "locked" ? "money" : "plain", tx);
  }
  for (const [i, n] of (record.buyerNotes ?? []).entries()) add(`note:${i}`, Date.parse(n.at), "You", `Told your negotiator: "${n.text}"`);
  const a = record.approval;
  if (a) {
    add("approval:asked", Date.parse(a.at), "Lead (agent)", `Recommended ${nameOf(record, a.supplier)} and asked for your yes: "${a.leadReason}"`);
    if (a.answeredAt) add("approval:answered", Date.parse(a.answeredAt), "You", a.state === "approved" ? "Said yes. Only then could the payment lock." : "Said no. Nothing was locked or paid.", a.state === "approved" ? "ok" : "stop");
  }
  return out.filter((e) => Number.isFinite(e.at)).sort((x, y) => x.at - y.at);
}

// Which conversation the reading pane shows: the one the buyer picked, else the one with the newest
// message among the suppliers on screen, else the first on screen. A supplier left off the screen is
// never opened, even when the negotiator wrote to it last.
export function openThread(view: RunView, shown: string[], picked: string | null): string | null {
  if (picked && shown.includes(picked)) return picked;
  const latest = [...view.messages].reverse().find((m) => m.kind !== "report" && shown.includes(m.supplier))?.supplier;
  return latest ?? shown[0] ?? null;
}
