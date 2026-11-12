import { usd } from "./format";
import { verdictPlain } from "./plain";
import { type RunView, type Step, buildTimeline } from "./timeline";
import type { Card, LedgerTx, SourcingRecord } from "./types";

// What the live screen shows, worked out from the record alone: three headline numbers, the list of
// conversations, and (for testing only) the record as it stood at an earlier moment. Pure.

export interface Headline {
  // The best price any supplier opened with, and the best price on the table now, per unit.
  openingBestCents: number | null;
  bestNowCents: number | null;
  // Opening minus now: positive when the negotiation brought the price down.
  movedCents: number | null;
  movedTotalCents: number | null;
  ejected: number;
  money: { state: "none" | "locked" | "paid" | "refunded"; cents: number; tx: LedgerTx | null };
}

export function headline(record: SourcingRecord, view: RunView): Headline {
  const first = new Map<string, number>();
  const latest = new Map<string, number>();
  for (const m of view.messages) {
    if (m.kind !== "report" || !m.offer) continue;
    if (!first.has(m.supplier)) first.set(m.supplier, m.offer.unitCents);
    latest.set(m.supplier, m.offer.unitCents);
  }
  // A committed quote is that supplier's price now, whatever it said in chat.
  for (const i of view.invites) if (i.quote) latest.set(i.address, i.quote.unitCents);
  const out = new Set(view.invites.filter((i) => i.status === "out").map((i) => i.address));
  const opening = [...first.values()];
  const now = [...latest.entries()].filter(([address]) => !out.has(address)).map(([, cents]) => cents);
  const openingBestCents = opening.length > 0 ? Math.min(...opening) : null;
  const bestNowCents = now.length > 0 ? Math.min(...now) : null;
  const movedCents = openingBestCents !== null && bestNowCents !== null ? openingBestCents - bestNowCents : null;
  const cents = view.money.totalCents;
  const money: Headline["money"] = view.paid
    ? { state: "paid", cents, tx: record.finish ?? null }
    : view.refunded
      ? { state: "refunded", cents, tx: record.cancel ?? null }
      : view.locked
        ? { state: "locked", cents, tx: record.create ?? null }
        : { state: "none", cents: 0, tx: null };
  return {
    openingBestCents,
    bestNowCents,
    movedCents,
    movedTotalCents: movedCents === null ? null : movedCents * record.sourcing.brief.goods.quantity,
    ejected: out.size,
    money,
  };
}

export interface ChatRow {
  id: string;
  kind: "supplier" | "lead" | "inspector";
  title: string;
  status: "in" | "out" | null;
  cards: { yellow: number; red: number };
  // The newest line, in plain words. Never the text of a held message.
  last: string;
  lastAt: number | null;
  messages: number;
  held: number;
  priceCents: number | null;
  committed: boolean;
  tone: "plain" | "ok" | "held" | "stop" | "money";
}

export const LEAD_ROW = "lead";
export const INSPECTOR_ROW = "inspector";

export function chatRows(record: SourcingRecord, view: RunView): ChatRow[] {
  const rows: ChatRow[] = view.invites
    .filter((i) => i.invited)
    .map((i) => {
      const mine = view.messages.filter((m) => m.supplier === i.address && m.kind !== "report");
      const from = mine.filter((m) => m.kind === "from_supplier");
      const last = mine[mine.length - 1];
      const reported = [...view.messages].reverse().find((m) => m.supplier === i.address && m.kind === "report" && m.offer);
      return {
        id: i.address,
        kind: "supplier" as const,
        title: i.name,
        status: i.status,
        cards: i.cards,
        last: !last ? "No messages yet." : last.kind === "to_supplier" ? `Negotiator: ${last.body}` : last.delivered ? last.body : verdictPlain(last).text,
        lastAt: last?.atMs ?? null,
        messages: mine.length,
        held: from.filter((m) => !m.delivered).length,
        priceCents: i.quote?.unitCents ?? reported?.offer?.unitCents ?? null,
        committed: i.quote !== null,
        tone: i.status === "out" ? ("stop" as const) : i.selected ? ("ok" as const) : ("plain" as const),
      };
    });

  const decided = view.decisions[view.decisions.length - 1];
  const reports = view.messages.filter((m) => m.kind === "report");
  rows.push({
    id: LEAD_ROW,
    kind: "lead",
    title: "Lead agent's decision",
    status: null,
    cards: { yellow: 0, red: 0 },
    last: view.accepted
      ? `Chose ${view.accepted.supplier.name} at ${usd(view.accepted.quote?.unitCents ?? 0)} a unit.`
      : decided
        ? `Turned down ${decided.supplier.name}.`
        : view.closed
          ? "Choosing among the final prices."
          : "Waiting for the negotiation to finish.",
    lastAt: null,
    messages: reports.length + view.decisions.length,
    held: reports.filter((m) => !m.delivered).length,
    priceCents: view.accepted?.quote?.unitCents ?? null,
    committed: view.accepted !== null,
    tone: view.accepted ? "ok" : "plain",
  });

  rows.push({
    id: INSPECTOR_ROW,
    kind: "inspector",
    title: "Inspector",
    status: null,
    cards: { yellow: 0, red: 0 },
    last:
      view.inspection === "attested"
        ? "Confirmed the shipment."
        : view.inspection === "refused"
          ? "Did not confirm the shipment."
          : view.inspection === "waiting"
            ? view.refunded
              ? "Gave no answer before the deadline."
              : "Has not answered yet."
            : view.locked
              ? "Not part of this purchase."
              : "Checks the shipment once the money is locked.",
    lastAt: record.inspection?.at ? Date.parse(record.inspection.at) : null,
    messages: view.inspection === "attested" || view.inspection === "refused" ? 1 : 0,
    held: 0,
    priceCents: null,
    committed: false,
    tone: view.inspection === "attested" ? "ok" : view.inspection === "refused" ? "stop" : view.inspection === "waiting" && !view.refunded ? "money" : "plain",
  });
  return rows;
}

// ---------------------------------------------------------------- a record as it stood at time t
// For the simulated feed only: it lets the live path (poll, diff, render) be exercised from a
// recorded run without a backend. Never used on stage and never unbadged.

const cardsOf = (r: SourcingRecord, address: string, included: Set<number>): Card[] =>
  r.messages.flatMap((m, i) => (included.has(i) && m.supplier === address && m.kind === "from_supplier" && m.card ? [m.card] : []));

export function recordUpTo(r: SourcingRecord, steps: Step[], t: number): SourcingRecord | null {
  const done = steps.filter((s) => s.at <= t);
  const ids = new Set(done.map((s) => s.id));
  const has = (kind: Step["kind"]) => done.some((s) => s.kind === kind);
  if (!has("opened")) return null;
  const included = new Set(done.flatMap((s) => (s.kind === "message" && s.messageIndex !== undefined ? [s.messageIndex] : [])));
  const accepted = (r.deals ?? []).some((d) => ids.has(`decision:${d.id}`) && d.decision?.final === "accept");
  const locked = has("locked");
  const paid = has("paid");
  const refunded = has("refunded");
  return {
    ...r,
    recordedAt: new Date(t).toISOString(),
    sourcing: { ...r.sourcing, state: accepted ? "SELECTED" : "OPEN" },
    invites: r.invites
      .filter((i) => ids.has(`invited:${i.address}`))
      .map((i) => {
        const cards = cardsOf(r, i.address, included);
        const committed = ids.has(`quote:${i.address}`);
        return {
          ...i,
          cards,
          status: cards.includes("red") || cards.filter((c) => c === "yellow").length >= 2 ? ("out" as const) : ("in" as const),
          quote: committed ? i.quote : null,
          deliveryDays: committed ? (i.deliveryDays ?? null) : null,
          dealId: (r.deals ?? []).some((d) => d.id === i.dealId && ids.has(`decision:${d.id}`)) ? i.dealId : null,
        };
      }),
    suggestions: r.suggestions.filter((s) => ids.has(`suggested:${s.id}`)),
    messages: r.messages.filter((_m, i) => included.has(i)),
    deals: (r.deals ?? []).filter((d) => ids.has(`decision:${d.id}`)),
    job: locked && r.job ? { ...r.job, state: paid ? "PAID" : refunded ? "REFUNDED" : "LOCKED" } : null,
    verify: has("verified") ? (r.verify ?? null) : null,
    create: locked ? (r.create ?? null) : null,
    finish: paid ? (r.finish ?? null) : null,
    cancel: refunded ? (r.cancel ?? null) : null,
    inspection: !r.inspection ? r.inspection : has("inspected") ? r.inspection : locked ? { state: "pending" } : null,
    events: (r.events ?? null)?.filter((e) => Date.parse(e.at) <= t) ?? null,
    treasuryCents: r.treasuryCents ? { before: r.treasuryCents.before, after: paid || refunded ? r.treasuryCents.after : null } : r.treasuryCents,
    costUsd: paid || refunded ? r.costUsd : null,
    checks: paid || refunded ? r.checks : null,
  };
}

// The steps of a whole recorded run, for pacing the simulated feed.
export const simSteps = (r: SourcingRecord) => buildTimeline(r);
