import { usd } from "./format";
import { chatRows } from "./livescreen";
import { type RunView, silentUnnamed } from "./timeline";
import type { SourcingRecord } from "./types";

// The buyer's one conversation with its agent, worked out from the record alone. What the buyer and
// the agent said to each other comes from the record's chat. Everything else in the feed is written
// here by code from what happened: who was invited, each price as it moved, a message Surety stopped,
// a message waiting for the buyer, the recommendation, the answer. No model writes a progress line,
// and a held message never appears as text. Pure, so it is tested without a screen.

export type FeedTone = "plain" | "ok" | "held" | "stop" | "money";

export type FeedItem =
  | { kind: "you"; key: string; at: number; text: string }
  | { kind: "agent"; key: string; at: number; text: string }
  // Written by code from the record. `supplier` set: the line is about that conversation.
  | { kind: "update"; key: string; at: number; text: string; tone: FeedTone; supplier?: string }
  // A message the negotiator wrote that waits for the buyer.
  | { kind: "draft"; key: string; at: number; id: string; supplier: string; name: string; text: string }
  | { kind: "review"; key: string; at: number }
  | { kind: "tracker"; key: string; at: number };

const nameOf = (record: SourcingRecord, address: string) => record.invites.find((i) => i.address === address)?.name ?? address;
const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export const openedAt = (record: SourcingRecord) => Date.parse(record.sourcing.negotiationEndsAt) - record.sourcing.brief.negotiationSeconds * 1000;

export function chatFeed(record: SourcingRecord, view: RunView): FeedItem[] {
  const out: FeedItem[] = [];
  const brief = record.sourcing.brief;
  const start = openedAt(record);
  const hidden = new Set(view.invites.filter(silentUnnamed).map((i) => i.address));
  const update = (key: string, at: number, text: string, tone: FeedTone = "plain", supplier?: string) => out.push({ kind: "update", key, at, text, tone, ...(supplier ? { supplier } : {}) });

  update(
    "opened",
    start,
    `I have opened your purchase: ${brief.goods.quantity.toLocaleString("en-US")} x ${brief.goods.description}, delivered to ${brief.port}. I am aiming for ${usd(brief.goods.targetUnitCents)} a panel and will never agree to more than ${usd(brief.goods.maxUnitCents)}.`,
  );
  const invited = view.invites.filter((i) => i.invited && !hidden.has(i.address));
  if (invited.length > 0) update("invited", start + 1, `I invited ${invited.length === 1 ? "one supplier" : `${invited.length} suppliers`} from your approved list: ${list(invited.map((i) => i.name))}.`);

  // Each price as it moves, from the negotiator's reports; and each message Surety stopped.
  const lastSaid = new Map<string, string>();
  for (const m of view.messages) {
    if (hidden.has(m.supplier)) continue;
    const name = nameOf(record, m.supplier);
    if (m.kind === "report" && m.offer) {
      const said = `${m.offer.unitCents}/${m.offer.deliveryDays}`;
      if (lastSaid.get(m.supplier) === said) continue;
      const first = !lastSaid.has(m.supplier);
      lastSaid.set(m.supplier, said);
      update(`price:${m.index}`, m.atMs, `${name} ${first ? "offers" : "is now at"} ${usd(m.offer.unitCents)} a panel, delivered in ${m.offer.deliveryDays} days.`, "plain", m.supplier);
    } else if (m.kind === "from_supplier" && !m.delivered) {
      const text =
        m.card === "red"
          ? `Surety stopped a message from ${name} before I could read it and gave it a red card. ${name} is out of this purchase.`
          : m.card === "yellow"
            ? `Surety stopped a message from ${name} before I could read it and gave it a yellow card.`
            : `Surety stopped a message from ${name} before I could read it.`;
      update(`held:${m.index}`, m.atMs, text, m.card === "red" ? "stop" : "held", m.supplier);
    } else if (m.kind === "to_supplier" && m.by === "buyer") {
      update(`wrote:${m.index}`, m.atMs, `You wrote to ${name} yourself.`, "plain", m.supplier);
    }
  }

  for (const l of record.chat ?? []) out.push({ kind: l.role === "buyer" ? "you" : "agent", key: `chat:${l.at}:${l.role}`, at: Date.parse(l.at), text: l.text });
  for (const d of record.drafts ?? []) out.push({ kind: "draft", key: `draft:${d.id}`, at: Date.parse(d.at), id: d.id, supplier: d.supplier, name: nameOf(record, d.supplier), text: d.text });

  const a = record.approval;
  if (a) {
    const asked = Date.parse(a.at);
    if (a.state === "waiting") out.push({ kind: "review", key: `review:${a.dealId}`, at: asked });
    else {
      const quote = record.invites.find((i) => i.address === a.supplier)?.quote;
      update(`recommended:${a.dealId}`, asked, `I recommended ${nameOf(record, a.supplier)}${quote ? ` at ${usd(quote.unitCents)} a panel (${usd(quote.totalCents)} in all)` : ""}${a.leadReason ? `: ${a.leadReason}` : "."}`, "money", a.supplier);
      const answered = a.answeredAt ? Date.parse(a.answeredAt) : asked + 1;
      if (a.state === "approved") update(`answer:${a.dealId}`, answered, "You said yes. Only then could the payment lock.", "ok");
      else update(`answer:${a.dealId}`, answered, "You said no. Nothing was locked and nothing was paid.", "stop");
    }
  }
  // The order follows the buyer's yes. A recording from before the buyer's yes existed has no answer
  // time, so there it follows the lock.
  if (view.locked) {
    const yes = a?.state === "approved" && a.answeredAt ? Date.parse(a.answeredAt) + 1 : null;
    out.push({ kind: "tracker", key: "tracker", at: yes ?? view.trail.find((s) => s.kind === "locked")?.at ?? start + 2 });
  }

  // Oldest first; items at the same instant keep the order they were written in.
  return out.map((item, i) => ({ item, i })).sort((x, y) => x.item.at - y.item.at || x.i - y.i).map((x) => x.item);
}

export interface SupplierCard {
  address: string;
  name: string;
  // In plain words, what this conversation is doing now.
  state: "typing" | "waiting_for_you" | "waiting_for_reply" | "quiet" | "final" | "out";
  line: string;
  priceCents: number | null;
  committed: boolean;
  tone: FeedTone;
}

// How long a supplier's "I am writing" signal counts on the screen.
export const TYPING_SHOWN_MS = 20_000;

// The suppliers the buyer can open, each with one line saying what is happening in that conversation.
export function supplierCards(record: SourcingRecord, view: RunView, now: number): SupplierCard[] {
  const hidden = new Set(view.invites.filter(silentUnnamed).map((i) => i.address));
  const open = record.sourcing.state === "OPEN";
  return chatRows(record, view)
    .filter((r) => r.kind === "supplier" && !hidden.has(r.id))
    .map((r) => {
      const typedAt = record.typing?.[r.id];
      const typing = open && typedAt !== undefined && now - Date.parse(typedAt) < TYPING_SHOWN_MS;
      const draft = (record.drafts ?? []).some((d) => d.supplier === r.id);
      const lastToThem = [...view.messages].reverse().find((m) => m.supplier === r.id && m.kind !== "report")?.kind === "to_supplier";
      const state: SupplierCard["state"] = r.status === "out" ? "out" : r.committed ? "final" : draft ? "waiting_for_you" : typing ? "typing" : open && lastToThem ? "waiting_for_reply" : "quiet";
      const price = r.priceCents !== null ? usd(r.priceCents) : null;
      const line =
        state === "out"
          ? "Removed by Surety"
          : state === "final"
            ? `Final price ${price ?? ""}`.trim()
            : state === "waiting_for_you"
              ? "A message is waiting for you"
              : state === "typing"
                ? "Writing a reply"
                : state === "waiting_for_reply"
                  ? price
                    ? `Says ${price}. Waiting for a reply`
                    : "Waiting for a reply"
                  : price
                    ? `Says ${price}`
                    : "No price yet";
      return {
        address: r.id,
        name: r.title,
        state,
        line,
        priceCents: r.priceCents,
        committed: r.committed,
        tone: state === "out" ? "stop" : state === "final" ? "money" : state === "waiting_for_you" ? "held" : "plain",
      };
    });
}

// What the buyer sees under the agent's name: one line for where the purchase stands.
export function agentStatus(record: SourcingRecord, view: RunView): string {
  if (view.paid) return "The supplier has been paid.";
  if (view.refunded) return "Your money came back to you.";
  if (view.locked) return "Your payment is locked. I am following the order.";
  if (record.approval?.state === "waiting") return "I have a recommendation for you.";
  if (record.approval?.state === "declined") return "You said no. Nothing moved.";
  if ((record.drafts ?? []).length > 0) return "A message is waiting for you.";
  if (record.controls?.wrapUpAt) return "Getting final quotes for you.";
  return view.invites.some((i) => i.invited) ? "Negotiating with your suppliers." : "Inviting your suppliers.";
}
