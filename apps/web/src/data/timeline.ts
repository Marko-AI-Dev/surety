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

export function buildTimeline(r: SourcingRecord): Step[] {
  const steps: Step[] = [];
  const t0 = openedAt(r);
  const closeAt = Date.parse(r.sourcing.negotiationEndsAt);
  const g = r.sourcing.brief.goods;
  steps.push({
    id: "opened",
    at: t0,
    timed: true,
    kind: "opened",
    title: "The Lead opened the sourcing from the brief",
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
      title: `Sourcing invited ${nameOf(r, inv.address)}`,
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
      title: `Sourcing suggested ${s.name} for the operator, and did not invite it`,
      detail: s.reason,
    });
  }
  r.messages.forEach((m, i) => {
    const who = nameOf(r, m.supplier);
    const title =
      m.kind === "to_supplier"
        ? `Negotiator to ${who}`
        : m.kind === "report"
          ? `Negotiator reported the offer from ${who} to the Lead`
          : m.delivered
            ? `${who} replied, delivered`
            : m.card
              ? `${who}: message held, ${m.card} card`
              : `${who}: message held`;
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
      title: `${nameOf(r, inv.address)} committed a binding quote on the form`,
      detail: `${dollars(inv.quote.unitCents)} a unit, ${dollars(inv.quote.totalCents)} in total`,
    });
  }
  steps.push({ id: "closed", at: closeAt, timed: true, kind: "closed", title: "The negotiation time ended" });

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
        ? `The Lead selected ${who} and accepted; Surety re-checked the quote`
        : d.decision.agent.outcome === "accept"
          ? `${who}: the Lead accepted, and Surety's checks overruled it`
          : `${who}: the Lead declined`,
      detail: d.decision.agent.reason,
    });
  }

  if (accepted && r.create) {
    const who = nameOf(r, accepted.supplier.address);
    cursor += GAP.lock * SECOND;
    steps.push({
      id: "locked",
      at: cursor,
      timed: false,
      kind: "locked",
      supplier: accepted.supplier.address,
      title: `The signer locked ${dollars(Number(r.job?.amount.cents ?? accepted.quote?.totalCents ?? 0))} in XRPL escrow`,
      detail: `Ledger ${r.create.ledgerIndex}, ${r.create.result}`,
    });
    if (r.verify) {
      cursor += GAP.documents * SECOND;
      steps.push({
        id: "documents",
        at: cursor,
        timed: false,
        kind: "documents",
        supplier: accepted.supplier.address,
        title: `${who} confirmed its invoice and shipping details`,
      });
      if (r.inspection && r.inspection.state !== "pending") {
        const at = r.inspection.at ? Date.parse(r.inspection.at) : Number.NaN;
        cursor = Number.isFinite(at) ? Math.max(cursor, at) : cursor + GAP.inspect * SECOND;
        steps.push({
          id: "inspected",
          at: cursor,
          timed: Number.isFinite(at),
          kind: "inspected",
          title: r.inspection.state === "attested" ? "The inspector attested the bill of lading" : "The inspector refused the bill of lading",
          detail: r.inspection.inspector ?? undefined,
        });
      }
      cursor += GAP.verify * SECOND;
      steps.push({
        id: "verified",
        at: cursor,
        timed: false,
        kind: "verified",
        title: `Surety Verify: ${r.verify.outcome === "APPROVE" ? "approved" : r.verify.outcome.toLowerCase()}`,
        detail: r.verify.policyVersion,
      });
    }
    if (r.finish?.validated && r.finish.result === "tesSUCCESS") {
      cursor += GAP.settle * SECOND;
      steps.push({
        id: "paid",
        at: cursor,
        timed: false,
        kind: "paid",
        supplier: accepted.supplier.address,
        title: `Paid to ${who}`,
        detail: `Ledger ${r.finish.ledgerIndex}, ${r.finish.result}`,
      });
    } else if (r.cancel?.validated && r.cancel.result === "tesSUCCESS") {
      cursor += GAP.settle * SECOND;
      steps.push({
        id: "refunded",
        at: cursor,
        timed: false,
        kind: "refunded",
        title: "Refunded to the treasury after the deadline",
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
