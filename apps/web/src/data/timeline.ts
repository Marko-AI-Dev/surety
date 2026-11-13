import type { Card, RecordDeal, RecordInvite, RecordMessage, SourcingRecord } from "./types";

// The run as an ordered list of steps, and what is visible at a moment of it. Pure: no clock, no DOM.
//
// What the record times exactly: every chat message and report, the supplier suggestion, and the end
// of the negotiation; the opening is the end minus the negotiation length. What it orders but does
// not time: the invites, the committed quotes, the lead's decision, the lock, the supplier's
// documents, Surety Verify and the payout. Those steps are placed in their true order with
// `timed: false`, and the UI says so on each one.

export type StepKind =
  | "opened"
  | "invited"
  | "suggested"
  | "message"
  | "quote"
  | "closed"
  | "decision"
  | "locked"
  | "documents"
  | "inspected"
  | "verified"
  | "paid"
  | "refunded";

export interface Step {
  id: string;
  at: number;
  timed: boolean;
  kind: StepKind;
  supplier?: string;
  messageIndex?: number;
  dealId?: string;
  title: string;
  detail?: string;
}

const SECOND = 1000;
// Spacing, in seconds, for steps the record orders but does not time.
const GAP = { invite: 2, quote: 4, decision: 12, lock: 10, documents: 8, inspect: 7, verify: 7, settle: 7 };

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const nameOf = (r: SourcingRecord, address: string) => {
  const i = r.invites.find((x) => x.address === address);
  return !i || i.name === i.address ? short(address) : i.name;
};
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function openedAt(r: SourcingRecord): number {
  return Date.parse(r.sourcing.negotiationEndsAt) - r.sourcing.brief.negotiationSeconds * SECOND;
}

// When the job reached a state, from the record's own event log, when it has one. Live records and
// newer evidence carry it; then the lock, the documents, the check and the payout have real times.
function eventAt(r: SourcingRecord, to: string[]): number | null {
  const e = (r.events ?? []).find((x) => to.includes(x.to));
  const at = e ? Date.parse(e.at) : Number.NaN;
  return Number.isFinite(at) ? at : null;
}

// `now` is the clock of a run still in progress. A recorded run has none: every step is in the past.
export function buildTimeline(r: SourcingRecord, opts: { now?: number } = {}): Step[] {
  const steps: Step[] = [];
  // Place a step at its recorded time when there is one, never before the step that precedes it.
  const place = (cursor: number, real: number | null, gapSeconds: number) =>
    real === null ? { at: cursor + gapSeconds * SECOND, timed: false } : { at: Math.max(cursor, real), timed: true };
  const t0 = openedAt(r);
  const closeAt = Date.parse(r.sourcing.negotiationEndsAt);
  const g = r.sourcing.brief.goods;
  steps.push({
    id: "opened",
    at: t0,
    timed: true,
    kind: "opened",
    title: "Your Lead agent opened the purchase from your brief",
    detail: `${g.quantity} x ${g.description}, target ${dollars(g.targetUnitCents)}, ${r.sourcing.brief.incoterm} ${r.sourcing.brief.port}`,
  });

  const firstTimed = Math.min(...r.messages.map((m) => Date.parse(m.at)), ...r.suggestions.map((s) => Date.parse(s.createdAt)), closeAt);
  // Invites sit between the opening and the first timed thing that follows them.
  const inviteStart = t0 + Math.min(20 * SECOND, Math.max(SECOND, (firstTimed - t0) / 2));
  r.invites.forEach((inv, i) => {
    steps.push({
      id: `invited:${inv.address}`,
      at: inviteStart + i * GAP.invite * SECOND,
      timed: false,
      kind: "invited",
      supplier: inv.address,
      title: `Your Sourcing agent invited ${nameOf(r, inv.address)}`,
      detail: "An approved supplier",
    });
  });
  for (const s of r.suggestions) {
    steps.push({
      id: `suggested:${s.id}`,
      at: Date.parse(s.createdAt),
      timed: true,
      kind: "suggested",
      supplier: s.address,
      title: `Your Sourcing agent flagged ${s.name}, which is not approved, and did not invite it`,
      detail: s.reason,
    });
  }
  r.messages.forEach((m, i) => {
    const who = nameOf(r, m.supplier);
    const title =
      m.kind === "to_supplier"
        ? `Your Negotiator wrote to ${who}`
        : m.kind === "report"
          ? `Your Negotiator reported ${who}'s offer to the Lead agent`
          : m.delivered
            ? `${who} replied`
            : m.card
              ? `Surety held a message from ${who}, ${m.card} card`
              : `Surety held a message from ${who}`;
    steps.push({ id: `message:${i}`, at: Date.parse(m.at), timed: true, kind: "message", supplier: m.supplier, messageIndex: i, title });
  });

  const lastMessageAt =
    r.messages.length > 0 ? Math.max(...r.messages.map((m) => Date.parse(m.at))) : inviteStart + r.invites.length * GAP.invite * SECOND;
  let cursor = lastMessageAt;
  for (const inv of r.invites) {
    if (!inv.quote) continue;
    cursor += GAP.quote * SECOND;
    steps.push({
      id: `quote:${inv.address}`,
      at: cursor,
      timed: false,
      kind: "quote",
      supplier: inv.address,
      title: `${nameOf(r, inv.address)} submitted its final price`,
      detail: `${dollars(inv.quote.unitCents)} a unit, ${dollars(inv.quote.totalCents)} in total`,
    });
  }
  // In a live run the negotiation has ended only once its time is up or the Lead has decided.
  if (opts.now === undefined || opts.now >= closeAt || r.sourcing.state !== "OPEN") {
    steps.push({ id: "closed", at: closeAt, timed: true, kind: "closed", title: "The negotiation ended" });
  }

  cursor = Math.max(cursor, closeAt);
  // Declined deals first, the accepted one last: a decline reopens the sourcing for the next supplier.
  const ordered = [...(r.deals ?? [])].sort((a, b) => Number(a.decision?.final === "accept") - Number(b.decision?.final === "accept"));
  let accepted: RecordDeal | null = null;
  for (const d of ordered) {
    if (!d.decision) continue;
    cursor += GAP.decision * SECOND;
    const ok = d.decision.final === "accept";
    if (ok) accepted = d;
    const who = nameOf(r, d.supplier.address);
    steps.push({
      id: `decision:${d.id}`,
      at: cursor,
      timed: false,
      kind: "decision",
      supplier: d.supplier.address,
      dealId: d.id,
      title: ok
        ? `Your Lead agent chose ${who}, and Surety checked the choice`
        : d.decision.agent.outcome === "accept"
          ? `Your Lead agent chose ${who}, and Surety refused it`
          : `Your Lead agent turned down ${who}`,
      detail: d.decision.agent.reason,
    });
  }

  if (accepted && r.create) {
    const who = nameOf(r, accepted.supplier.address);
    const lockedAt = place(cursor, eventAt(r, ["LOCKED"]), GAP.lock);
    cursor = lockedAt.at;
    steps.push({
      id: "locked",
      at: cursor,
      timed: lockedAt.timed,
      kind: "locked",
      supplier: accepted.supplier.address,
      title: `${dollars(Number(r.job?.amount.cents ?? accepted.quote?.totalCents ?? 0))} was locked on the ledger`,
      detail: `Ledger ${r.create.ledgerIndex}, ${r.create.result}`,
    });
    const deliveredAt = eventAt(r, ["DELIVERED"]);
    if (r.verify || deliveredAt !== null) {
      const documentsAt = place(cursor, deliveredAt, GAP.documents);
      cursor = documentsAt.at;
      steps.push({
        id: "documents",
        at: cursor,
        timed: documentsAt.timed,
        kind: "documents",
        supplier: accepted.supplier.address,
        title: `${who} sent its invoice and shipping document`,
      });
      if (r.inspection && r.inspection.state !== "pending") {
        const at = r.inspection.at ? Date.parse(r.inspection.at) : Number.NaN;
        cursor = Number.isFinite(at) ? Math.max(cursor, at) : cursor + GAP.inspect * SECOND;
        steps.push({
          id: "inspected",
          at: cursor,
          timed: Number.isFinite(at),
          kind: "inspected",
          title: r.inspection.state === "attested" ? "The inspector confirmed the shipment" : "The inspector did not confirm the shipment",
          detail: r.inspection.inspector ?? undefined,
        });
      }
      if (r.verify) {
        const verifiedAt = place(cursor, eventAt(r, ["APPROVED", "REJECTED_AWAITING_EXPIRY", "REVIEW_REQUIRED"]), GAP.verify);
        cursor = verifiedAt.at;
        steps.push({
          id: "verified",
          at: cursor,
          timed: verifiedAt.timed,
          kind: "verified",
          title: r.verify.outcome === "APPROVE" ? "The paperwork check passed" : "The paperwork check did not pass",
          detail: r.verify.policyVersion,
        });
      }
    }
    if (r.finish?.validated && r.finish.result === "tesSUCCESS") {
      const paidAt = place(cursor, eventAt(r, ["PAID"]), GAP.settle);
      cursor = paidAt.at;
      steps.push({
        id: "paid",
        at: cursor,
        timed: paidAt.timed,
        kind: "paid",
        supplier: accepted.supplier.address,
        title: `${who} was paid`,
        detail: `Ledger ${r.finish.ledgerIndex}, ${r.finish.result}`,
      });
    } else if (r.cancel?.validated && r.cancel.result === "tesSUCCESS") {
      const refundedAt = place(cursor, eventAt(r, ["REFUNDED"]), GAP.settle);
      cursor = refundedAt.at;
      steps.push({
        id: "refunded",
        at: cursor,
        timed: refundedAt.timed,
        kind: "refunded",
        title: "The ledger refunded the buyer after the deadline",
        detail: `Ledger ${r.cancel.ledgerIndex}, ${r.cancel.result}`,
      });
    }
  }

  // Stable order: by time, then by the order built above.
  return steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.at - b.s.at || a.i - b.i)
    .map((x) => x.s);
}

export interface InviteView {
  address: string;
  name: string;
  unnamed: boolean;
  invited: boolean;
  cards: { yellow: number; red: number };
  status: "in" | "out";
  replied: boolean;
  quote: RecordInvite["quote"];
  selected: boolean;
}

// An approved wallet with no name in the supplier directory that has never written. The buyer's screen
// leaves it out: it would show as a bare address that never answers. The admin log still has it.
export const silentUnnamed = (i: InviteView) => i.unnamed && !i.replied;

export interface MessageView extends RecordMessage {
  index: number;
  atMs: number;
}

export type Phase = "idle" | "sourcing" | "negotiating" | "deciding" | "locked" | "verifying" | "paid" | "refunded";

export interface RunView {
  t: number;
  phase: Phase;
  opened: boolean;
  closed: boolean;
  invites: InviteView[];
  suggestions: SourcingRecord["suggestions"];
  messages: MessageView[];
  decisions: RecordDeal[];
  accepted: RecordDeal | null;
  locked: boolean;
  documents: boolean;
  // "none": this record has no second key. Otherwise where the inspector's attestation stands now.
  inspection: "none" | "waiting" | "attested" | "refused";
  verified: boolean;
  paid: boolean;
  refunded: boolean;
  money: { treasuryCents: number | null; escrowCents: number; supplierCents: number; totalCents: number };
  trail: Step[];
  upcoming: number;
}

export function viewAt(r: SourcingRecord, steps: Step[], t: number): RunView {
  const done = steps.filter((s) => s.at <= t);
  const has = (kind: StepKind) => done.some((s) => s.kind === kind);
  const doneIds = new Set(done.map((s) => s.id));

  const messages: MessageView[] = done
    .filter((s) => s.kind === "message" && s.messageIndex !== undefined)
    .map((s) => {
      const index = s.messageIndex as number;
      return { ...(r.messages[index] as RecordMessage), index, atMs: s.at };
    });

  const decisions = (r.deals ?? []).filter((d) => doneIds.has(`decision:${d.id}`));
  const accepted = decisions.find((d) => d.decision?.final === "accept") ?? null;
  const cardsOf = (address: string) => {
    const mine = messages.filter((m) => m.supplier === address && m.kind === "from_supplier");
    const count = (c: Card) => mine.filter((m) => m.card === c).length;
    return { yellow: count("yellow"), red: count("red") };
  };
  const invites: InviteView[] = r.invites.map((i) => {
    const cards = cardsOf(i.address);
    return {
      address: i.address,
      name: i.name === i.address ? short(i.address) : i.name,
      unnamed: i.name === i.address,
      invited: doneIds.has(`invited:${i.address}`),
      cards,
      status: cards.red > 0 || cards.yellow >= 2 ? "out" : "in",
      replied: messages.some((m) => m.supplier === i.address && m.kind === "from_supplier"),
      quote: doneIds.has(`quote:${i.address}`) ? i.quote : null,
      selected: accepted?.supplier.address === i.address,
    };
  });

  const locked = has("locked");
  const paid = has("paid");
  const refunded = has("refunded");
  const totalCents = Number(r.job?.amount.cents ?? accepted?.quote?.totalCents ?? 0);
  const before = r.treasuryCents?.before != null ? Number(r.treasuryCents.before) : null;
  const phase: Phase = paid
    ? "paid"
    : refunded
      ? "refunded"
      : has("documents")
        ? "verifying"
        : locked
          ? "locked"
          : has("closed") || decisions.length > 0
            ? "deciding"
            : messages.length > 0
              ? "negotiating"
              : has("opened")
                ? "sourcing"
                : "idle";

  return {
    t,
    phase,
    opened: has("opened"),
    closed: has("closed"),
    invites,
    suggestions: r.suggestions.filter((s) => doneIds.has(`suggested:${s.id}`)),
    messages,
    decisions,
    accepted,
    locked,
    documents: has("documents"),
    inspection: !r.inspection ? "none" : has("inspected") && r.inspection.state !== "pending" ? r.inspection.state : "waiting",
    verified: has("verified"),
    paid,
    refunded,
    money: {
      treasuryCents: before === null ? null : before - (locked && !refunded ? totalCents : 0),
      escrowCents: locked && !paid && !refunded ? totalCents : 0,
      supplierCents: paid ? totalCents : 0,
      totalCents,
    },
    trail: done,
    upcoming: steps.length - done.length,
  };
}

// Exactly what the negotiator's inbox carried: its own messages, delivered supplier messages, and a
// bare "withheld" marker for anything the bouncer held. Reports go up to the Lead and are not in it.
export type InboxItem =
  | { index: number; atMs: number; supplier: string; kind: "to_supplier" | "from_supplier"; text: string }
  | { index: number; atMs: number; supplier: string; kind: "from_supplier"; withheld: true; card: Card | null };

export function negotiatorEyes(messages: MessageView[]): InboxItem[] {
  const out: InboxItem[] = [];
  for (const m of messages) {
    if (m.kind === "report") continue;
    if (m.kind === "to_supplier") out.push({ index: m.index, atMs: m.atMs, supplier: m.supplier, kind: "to_supplier", text: m.body });
    else if (m.delivered) out.push({ index: m.index, atMs: m.atMs, supplier: m.supplier, kind: "from_supplier", text: m.body });
    else out.push({ index: m.index, atMs: m.atMs, supplier: m.supplier, kind: "from_supplier", withheld: true, card: m.card });
  }
  return out;
}

export function timelineBounds(steps: Step[]): { start: number; end: number } {
  const first = steps[0]?.at ?? 0;
  const last = steps[steps.length - 1]?.at ?? first;
  return { start: first - 3 * SECOND, end: last + 4 * SECOND };
}
