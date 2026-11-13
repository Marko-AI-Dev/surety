import type { InspectionRepo } from "./inspection-repo";
import { type Offer, leverageOffers, namesOtherSupplier } from "./leverage";
import { type RankedQuote, rankQuotes } from "./sourcing-rank";
import { z } from "zod";
import {
  Address,
  type Autonomy,
  BuyerControlsSchema,
  BuyerMessageSchema,
  BuyerNoteSchema,
  type Card,
  ChatTextSchema,
  DraftDecisionSchema,
  MAX_TESTUSD_CENTS,
  type OfferReport,
  OfferReportSchema,
  type Push,
  QuoteFormSchema,
  type SourcingBrief,
  SourcingBriefSchema,
  type SupplierQuote,
  SupplierQuoteSchema,
  canonicalJson,
  sha256Hex,
} from "@surety/contracts";
import { type DecisionEngine, type ScreenResult, type SupplierLine, chatState, screenMessage } from "@surety/gate";
import type { SignerClient } from "@surety/signer-client";
import type { DealsRepo } from "./deal-repo";
import type { JobsRepo } from "./repo";
import {
  type BuyerControls,
  type BuyerNote,
  CommittedQuoteConflict,
  type Invite,
  type MessageDraft,
  type Sourcing,
  type SourcingMessage,
  type SourcingRepo,
  type SupplierSuggestion,
} from "./sourcing-repo";

// Sourcing and negotiation: the lead opens a sourcing from the buyer's brief, the sourcing agent
// invites approved suppliers, the negotiator and suppliers chat through Surety, and suppliers commit
// binding quotes on the form. Every supplier message passes the bouncer before any agent reads it.
// Chat is never binding and never moves money.

export interface SourcingDeps {
  repo: JobsRepo & DealsRepo & SourcingRepo & InspectionRepo;
  signer: SignerClient;
  // The supplier's TESTUSD trust line from the ledger (read-only), used when a deal opens.
  supplierLine: (address: string) => Promise<SupplierLine | null>;
  // The bouncer's decision model.
  engine: DecisionEngine;
  // Display names for supplier wallets.
  directory: (address: string) => string | null;
  now?: () => Date;
}

export class SourcingNotFound extends Error {
  constructor(readonly sourcingId: string) {
    super(`sourcing ${sourcingId} not found`);
    this.name = "SourcingNotFound";
  }
}

// The sourcing no longer takes this action: it isn't OPEN, or its negotiation time is over.
export class SourcingClosed extends Error {
  constructor(
    readonly sourcingId: string,
    readonly why: "not_open" | "time_over",
  ) {
    super(why === "time_over" ? `sourcing ${sourcingId}: the negotiation time is over` : `sourcing ${sourcingId} is not open`);
    this.name = "SourcingClosed";
  }
}

// The supplier is out of this sourcing: one red card or two yellow cards.
export class SupplierOut extends Error {
  constructor(
    readonly sourcingId: string,
    readonly address: string,
  ) {
    super(`supplier ${address} is out of sourcing ${sourcingId}`);
    this.name = "SupplierOut";
  }
}

export class NotInvited extends Error {
  constructor(
    readonly sourcingId: string,
    readonly address: string,
  ) {
    super(`supplier ${address} is not part of sourcing ${sourcingId}`);
    this.name = "NotInvited";
  }
}

// The supplier has sent as many messages as one sourcing takes from it.
export class SupplierMessageLimit extends Error {
  constructor(
    readonly sourcingId: string,
    readonly address: string,
  ) {
    super(`supplier ${address} has reached the limit of ${SUPPLIER_MESSAGE_LIMIT} messages in sourcing ${sourcingId}`);
    this.name = "SupplierMessageLimit";
  }
}

// A request Surety refuses on its terms (not a malformed body).
export class SourcingRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourcingRefused";
  }
}

// The bouncer's time budget for asking again. The negotiation time box limits chat; it isn't a money
// deadline, so screening never runs short because a negotiation is ending.
const SCREEN_SECONDS = 60;

// How many chat messages one supplier may send in one sourcing, delivered or held. A real negotiation
// takes a handful; without a limit one supplier token can flood the negotiator's inbox and spend the
// decision model's budget. Checked before screening, so a refused message costs nothing. Messages
// posted at the same instant can pass it together, so it is a ceiling to within that burst.
export const SUPPLIER_MESSAGE_LIMIT = 20;

const nowOf = (deps: SourcingDeps) => (deps.now ?? (() => new Date()))();
const secondsLeft = (s: Sourcing, now: Date) => Math.max(0, Math.round((Date.parse(s.negotiationEndsAt) - now.getTime()) / 1000));

function newRef(now: Date): string {
  const d = now.toISOString().slice(2, 10).replaceAll("-", "");
  const suffix = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0");
  return `SR-${d}-${suffix}`;
}

async function mustSourcing(deps: SourcingDeps, sourcingId: string): Promise<Sourcing> {
  const s = await deps.repo.getSourcing(sourcingId);
  if (!s) throw new SourcingNotFound(sourcingId);
  return s;
}

function mustBeOpen(s: Sourcing, now: Date, opts: { timed: boolean }): void {
  if (s.state !== "OPEN") throw new SourcingClosed(s.id, "not_open");
  if (opts.timed && now.getTime() >= Date.parse(s.negotiationEndsAt)) throw new SourcingClosed(s.id, "time_over");
}

async function mustInvite(deps: SourcingDeps, sourcingId: string, address: string): Promise<Invite> {
  const invite = (await deps.repo.listInvites(sourcingId)).find((i) => i.address === address);
  if (!invite) throw new NotInvited(sourcingId, address);
  return invite;
}

const cardsOf = (messages: SourcingMessage[]) => ({
  yellow: messages.filter((m) => m.kind === "from_supplier" && m.card === "yellow").length,
  red: messages.filter((m) => m.kind === "from_supplier" && m.card === "red").length,
});

// Out on one red card or a second yellow, within this sourcing.
export function supplierStatus(messages: SourcingMessage[]): "in" | "out" {
  const c = cardsOf(messages);
  return c.red > 0 || c.yellow >= 2 ? "out" : "in";
}

async function statusOf(deps: SourcingDeps, sourcingId: string, address: string): Promise<"in" | "out"> {
  return supplierStatus(await deps.repo.listMessages(sourcingId, { supplier: address }));
}

const orderOf = (b: SourcingBrief) => ({ goods: b.goods.description, quantity: b.goods.quantity, incoterm: b.incoterm, port: b.port });

// What the record keeps of a screening. deliveredText lives in the message row itself.
const screenRecord = (r: ScreenResult) => ({
  reasonCodes: r.reasonCodes,
  satisfaction: r.satisfaction,
  injectionRisk: r.injectionRisk,
  samples: r.samples,
  costUsd: r.costUsd,
  links: r.links,
  rules: r.rules,
});

export async function openSourcing(deps: SourcingDeps, raw: unknown): Promise<Sourcing> {
  const brief = SourcingBriefSchema.parse(raw);
  const health = await deps.signer.health();
  if (brief.buyer.address !== health.buyer) {
    throw new SourcingRefused(`the buyer wallet ${brief.buyer.address} is not the treasury ${health.buyer}`);
  }
  const now = nowOf(deps);
  return deps.repo.createSourcing(newRef(now), brief, new Date(now.getTime() + brief.negotiationSeconds * 1000));
}

// How many notes the buyer may send its negotiator in one sourcing.
export const BUYER_NOTE_LIMIT = 20;

// The buyer nudges its own negotiator. The note is the buyer's own words to its own agent, so it is not
// screened; it never reaches a supplier. Only while the negotiation is open.
export async function addBuyerNote(deps: SourcingDeps, sourcingId: string, raw: unknown): Promise<BuyerNote> {
  const { text } = BuyerNoteSchema.parse(raw);
  const s = await mustSourcing(deps, sourcingId);
  mustBeOpen(s, nowOf(deps), { timed: true });
  if ((await deps.repo.listBuyerNotes(s.id)).length >= BUYER_NOTE_LIMIT) throw new SourcingRefused(`the buyer has sent ${BUYER_NOTE_LIMIT} notes in this sourcing`);
  return deps.repo.addBuyerNote(s.id, text);
}

// Any card since the operator last reviewed this supplier puts it on hold across sourcings.
export async function supplierOnHold(deps: SourcingDeps, address: string): Promise<boolean> {
  const review = await deps.repo.lastReview(address);
  return (await deps.repo.listCards(address, review ? new Date(review.clearedAt) : null)).length > 0;
}

export async function inviteSupplier(
  deps: SourcingDeps,
  sourcingId: string,
  address: string,
): Promise<{ invited: true; invite: Invite } | { invited: false; reason: "not_approved" | "on_hold" | "closed" }> {
  const s = await mustSourcing(deps, sourcingId);
  const now = nowOf(deps);
  if (s.state !== "OPEN" || now.getTime() >= Date.parse(s.negotiationEndsAt)) return { invited: false, reason: "closed" };
  const health = await deps.signer.health();
  if (!health.testUsd?.approvedSuppliers.includes(address)) return { invited: false, reason: "not_approved" };
  if (await supplierOnHold(deps, address)) return { invited: false, reason: "on_hold" };
  const invite = await deps.repo.addInvite(s.id, { address, name: deps.directory(address) ?? address });
  return { invited: true, invite };
}

const SuggestionSchema = z
  .object({ name: z.string().trim().min(1).max(120), address: Address, reason: z.string().trim().min(1).max(500) })
  .strict();

// The sourcing agent may suggest a supplier that isn't approved. Only the operator can approve one.
export async function suggestSupplier(deps: SourcingDeps, sourcingId: string, raw: unknown): Promise<SupplierSuggestion> {
  const input = SuggestionSchema.parse(raw);
  const s = await mustSourcing(deps, sourcingId);
  return deps.repo.addSuggestion({ sourcingId: s.id, ...input });
}

export async function postSupplierMessage(
  deps: SourcingDeps,
  sourcingId: string,
  address: string,
  raw: unknown,
): Promise<{ delivered: boolean; card: Card | null; status: "in" | "out" }> {
  const text = ChatTextSchema.parse(raw);
  const s = await mustSourcing(deps, sourcingId);
  // The invite first: a supplier that isn't part of this sourcing learns nothing about its state.
  const invite = await mustInvite(deps, s.id, address);
  mustBeOpen(s, nowOf(deps), { timed: true });
  const earlier = await deps.repo.listMessages(s.id, { supplier: address });
  if (supplierStatus(earlier) === "out") throw new SupplierOut(s.id, address);
  if (earlier.filter((m) => m.kind === "from_supplier").length >= SUPPLIER_MESSAGE_LIMIT) throw new SupplierMessageLimit(s.id, address);

  const result = await screenMessage(deps.engine, {
    text,
    approvedWallet: address,
    state: chatState(orderOf(s.brief), invite.name, text),
    sourcingId: s.id,
    secondsRemaining: SCREEN_SECONDS,
  });
  await deps.repo.addMessage({
    sourcingId: s.id,
    supplier: address,
    kind: "from_supplier",
    body: text,
    deliveredBody: result.verdict === "deliver" ? result.deliveredText : null,
    verdict: result.verdict,
    card: result.card,
    screen: screenRecord(result),
    offer: null,
  });
  return { delivered: result.verdict === "deliver", card: result.card, status: await statusOf(deps, s.id, address) };
}

// What the buyer's side may say to a supplier right now: the sourcing is open, the supplier is invited
// and still in, and the text names no other supplier (leverage stays anonymous).
async function mayWriteTo(deps: SourcingDeps, sourcingId: string, address: string, text: string): Promise<Sourcing> {
  const s = await mustSourcing(deps, sourcingId);
  mustBeOpen(s, nowOf(deps), { timed: true });
  const invite = await mustInvite(deps, s.id, address);
  if ((await statusOf(deps, s.id, address)) === "out") throw new SupplierOut(s.id, address);
  const others = (await deps.repo.listInvites(s.id)).filter((i) => i.address !== address);
  const allowed = [s.brief.goods.description, s.brief.port, invite.name];
  if (namesOtherSupplier(text, others, allowed) !== null) throw new SourcingRefused("a message must not name another supplier");
  return s;
}

const deliverToSupplier = (deps: SourcingDeps, sourcingId: string, address: string, text: string) =>
  deps.repo.addMessage({ sourcingId, supplier: address, kind: "to_supplier", body: text, deliveredBody: text, verdict: "deliver", card: null, screen: null, offer: null });

// The buyer's settings for this negotiation: what the buyer changed since, else the brief, else the defaults.
export async function controlsOf(deps: SourcingDeps, s: Sourcing): Promise<{ autonomy: Autonomy; push: Push; wrapUpAt: string | null }> {
  const c = await deps.repo.getControls(s.id);
  return { autonomy: c.autonomy ?? s.brief.autonomy ?? "full", push: c.push ?? s.brief.push ?? "firm", wrapUpAt: c.wrapUpAt };
}

export type HeldForBuyer = { held: "buyer_review"; draftId: string; supplier: string };

// The negotiator's message to one supplier. Surety's own agent, so it isn't screened. When the buyer
// approves every message first, it is kept as a draft: no supplier and no agent reads it until the
// buyer sends it. One draft a supplier waits at a time; asking again returns the one that waits.
export async function postNegotiatorMessage(deps: SourcingDeps, sourcingId: string, address: string, raw: unknown): Promise<SourcingMessage | HeldForBuyer> {
  const text = ChatTextSchema.parse(raw);
  const s = await mayWriteTo(deps, sourcingId, address, text);
  if ((await controlsOf(deps, s)).autonomy === "full") return deliverToSupplier(deps, s.id, address, text);
  const waiting = (await deps.repo.listDrafts(s.id)).find((d) => d.supplier === address && d.state === "pending");
  const draft = waiting ?? (await deps.repo.addDraft({ sourcingId: s.id, supplier: address, author: "negotiator", body: text }));
  return { held: "buyer_review", draftId: draft.id, supplier: address };
}

export class DraftNotFound extends Error {
  constructor(readonly draftId: string) {
    super(`draft ${draftId} not found`);
    this.name = "DraftNotFound";
  }
}

// The buyer's answer to a waiting draft. Send delivers the draft, in the buyer's wording when the
// buyer changed it; discard delivers nothing. The draft is claimed before the message is stored, so
// answering twice can never send it twice.
export async function decideDraft(deps: SourcingDeps, draftId: string, raw: unknown): Promise<{ draft: MessageDraft; message: SourcingMessage | null }> {
  const { action, text } = DraftDecisionSchema.parse(raw);
  const draft = await deps.repo.getDraft(draftId);
  if (!draft) throw new DraftNotFound(draftId);
  if (action === "discard") return { draft: await deps.repo.decideDraft(draft.id, "discarded", null), message: null };
  const body = text ?? draft.body;
  await mayWriteTo(deps, draft.sourcingId, draft.supplier, body);
  const sent = await deps.repo.decideDraft(draft.id, "sent", body === draft.body ? null : body);
  const message = await deliverToSupplier(deps, draft.sourcingId, draft.supplier, body);
  await deps.repo.linkDraft(sent.id, message.id);
  return { draft: { ...sent, messageId: message.id }, message };
}

// How many messages the buyer may write to suppliers themself in one sourcing.
export const BUYER_MESSAGE_LIMIT = 40;

// The buyer writes to a supplier themself. It goes out at once, in either mode, and is kept as a sent
// draft so the record knows the buyer wrote it.
export async function postBuyerMessage(deps: SourcingDeps, sourcingId: string, raw: unknown): Promise<SourcingMessage> {
  const { supplier, text } = BuyerMessageSchema.parse(raw);
  const s = await mayWriteTo(deps, sourcingId, supplier, text);
  if ((await deps.repo.listDrafts(s.id)).filter((d) => d.author === "buyer").length >= BUYER_MESSAGE_LIMIT) {
    throw new SourcingRefused(`the buyer has written ${BUYER_MESSAGE_LIMIT} messages in this sourcing`);
  }
  const draft = await deps.repo.addDraft({ sourcingId: s.id, supplier, author: "buyer", body: text });
  await deps.repo.decideDraft(draft.id, "sent", null);
  const message = await deliverToSupplier(deps, s.id, supplier, text);
  await deps.repo.linkDraft(draft.id, message.id);
  return message;
}

// The buyer changes how the negotiator works while the negotiation runs.
export async function setBuyerControls(deps: SourcingDeps, sourcingId: string, raw: unknown) {
  const patch = BuyerControlsSchema.parse(raw);
  const s = await mustSourcing(deps, sourcingId);
  mustBeOpen(s, nowOf(deps), { timed: false });
  await deps.repo.setControls(s.id, { ...(patch.autonomy ? { autonomy: patch.autonomy } : {}), ...(patch.push ? { push: patch.push } : {}) });
  return controlsOf(deps, s);
}

// The buyer asks the agents to bring what they have. Asking again changes nothing.
export async function requestWrapUp(deps: SourcingDeps, sourcingId: string) {
  const s = await mustSourcing(deps, sourcingId);
  mustBeOpen(s, nowOf(deps), { timed: false });
  await deps.repo.setControls(s.id, { wrapUpAt: nowOf(deps) });
  return controlsOf(deps, s);
}

// A committed quote meets the brief when it is at or under the target price and, where the buyer gave
// a latest delivery, inside it.
export const meetsBrief = (brief: SourcingBrief, q: { unitCents: number; deliveryDays: number | null }) =>
  q.unitCents <= brief.goods.targetUnitCents && (brief.latestDeliveryDays === undefined || (q.deliveryDays !== null && q.deliveryDays <= brief.latestDeliveryDays));

export type DecideWhy = "criteria_met" | "buyer_asked" | "time_over";
export interface DecideNow {
  ready: boolean;
  why: DecideWhy | null;
}

// When the lead should stop waiting and bring a deal to the buyer. Worked out by code, not left to an
// agent's sense of time: a committed quote from a supplier still in meets the brief; or the buyer asked
// and at least one quote is committed; or the buyer's decide-by time has passed.
export function readyToDecide(
  s: Sourcing,
  invites: { status: "in" | "out"; quote: { unitCents: number } | null; deliveryDays: number | null }[],
  controls: Pick<BuyerControls, "wrapUpAt">,
  now: Date,
): DecideNow {
  const committed = invites.filter((i) => i.status === "in" && i.quote !== null);
  if (committed.some((i) => meetsBrief(s.brief, { unitCents: (i.quote as { unitCents: number }).unitCents, deliveryDays: i.deliveryDays }))) return { ready: true, why: "criteria_met" };
  if (controls.wrapUpAt !== null && committed.length > 0) return { ready: true, why: "buyer_asked" };
  if (now.getTime() >= Date.parse(s.negotiationEndsAt)) return { ready: true, why: "time_over" };
  return { ready: false, why: null };
}

export type InboxItem =
  | { supplier: string; kind: "to_supplier" | "from_supplier"; text: string; at: string; byBuyer?: true }
  | { supplier: string; kind: "from_supplier"; withheld: true; card: Card | null; at: string };

// What the negotiator reads: its own messages and every delivered supplier message. A quarantined
// message appears only as withheld, never with its text.
export async function negotiatorInbox(deps: SourcingDeps, sourcingId: string): Promise<InboxItem[]> {
  const s = await mustSourcing(deps, sourcingId);
  const items: InboxItem[] = [];
  const buyerWrote = new Set((await deps.repo.listDrafts(s.id)).filter((d) => d.author === "buyer" && d.messageId).map((d) => d.messageId));
  for (const m of await deps.repo.listMessages(s.id)) {
    if (m.kind === "report") continue;
    if (m.kind === "to_supplier") items.push({ supplier: m.supplier, kind: "to_supplier", text: m.body, at: m.createdAt, ...(buyerWrote.has(m.id) ? { byBuyer: true as const } : {}) });
    else if (m.verdict === "deliver" && m.deliveredBody !== null) items.push({ supplier: m.supplier, kind: "from_supplier", text: m.deliveredBody, at: m.createdAt });
    else items.push({ supplier: m.supplier, kind: "from_supplier", withheld: true, card: m.card, at: m.createdAt });
  }
  return items;
}

export interface ThreadItem {
  kind: "to_supplier" | "from_supplier";
  text: string;
  delivered?: boolean;
  card?: Card | null;
  at: string;
}

// One supplier's view of its own conversation. It sees whether each of its messages was delivered.
export async function supplierThread(deps: SourcingDeps, sourcingId: string, address: string): Promise<ThreadItem[]> {
  const s = await mustSourcing(deps, sourcingId);
  await mustInvite(deps, s.id, address);
  const items: ThreadItem[] = [];
  for (const m of await deps.repo.listMessages(s.id, { supplier: address })) {
    if (m.kind === "to_supplier") items.push({ kind: "to_supplier", text: m.body, at: m.createdAt });
    else if (m.kind === "from_supplier") items.push({ kind: "from_supplier", text: m.body, delivered: m.verdict === "deliver", card: m.card, at: m.createdAt });
  }
  return items;
}

// The negotiator's report to the lead: facts, plus a screened summary. A held summary is withheld
// from the lead; it never cards the supplier (the negotiator wrote it).
export async function reportOffer(deps: SourcingDeps, sourcingId: string, raw: unknown): Promise<SourcingMessage> {
  const report = OfferReportSchema.parse(raw);
  const s = await mustSourcing(deps, sourcingId);
  mustBeOpen(s, nowOf(deps), { timed: false });
  const invite = await mustInvite(deps, s.id, report.supplier);
  const summary = report.summary.trim();
  const result =
    summary.length === 0
      ? null
      : await screenMessage(deps.engine, {
          text: summary,
          approvedWallet: report.supplier,
          state: chatState(orderOf(s.brief), invite.name, summary),
          sourcingId: s.id,
          secondsRemaining: SCREEN_SECONDS,
        });
  const delivered = result === null || result.verdict === "deliver";
  return deps.repo.addMessage({
    sourcingId: s.id,
    supplier: report.supplier,
    kind: "report",
    body: summary,
    deliveredBody: delivered ? (result?.deliveredText ?? "") : null,
    verdict: delivered ? "deliver" : "quarantine",
    card: null,
    screen: result ? screenRecord(result) : null,
    offer: report,
  });
}

// The supplier's binding quote. The wallet is the invite's; the total is computed here. The notes are
// supplier free text the lead agent reads, so they pass the bouncer like a chat message: clean notes
// arrive link-stripped, held notes are blanked and recorded (with their card) in the chat record.
export async function commitQuote(deps: SourcingDeps, sourcingId: string, address: string, raw: unknown): Promise<Invite> {
  const form = QuoteFormSchema.parse(raw);
  const s = await mustSourcing(deps, sourcingId);
  const invite = await mustInvite(deps, s.id, address);
  mustBeOpen(s, nowOf(deps), { timed: false });
  if ((await statusOf(deps, s.id, address)) === "out") throw new SupplierOut(s.id, address);
  // A quote is committed once. The same form again (a retry) returns it without screening its notes a
  // second time, so one sentence can never earn two cards; different terms are a conflict.
  if (invite.quote) {
    const q = invite.quote;
    const same =
      q.quoteNumber === form.quoteNumber &&
      q.quantity === form.quantity &&
      q.unitCents === form.unitCents &&
      q.incoterm === form.incoterm &&
      q.port === form.port &&
      invite.deliveryDays === form.deliveryDays;
    if (same) return invite;
    throw new CommittedQuoteConflict(s.id, address);
  }
  const total = BigInt(form.quantity) * BigInt(form.unitCents);
  if (total > MAX_TESTUSD_CENTS) throw new SourcingRefused("the quote total is above the largest amount Surety handles");

  let notes = "";
  const rawNotes = form.notes.trim();
  if (rawNotes.length > 0) {
    const result = await screenMessage(deps.engine, {
      text: rawNotes,
      approvedWallet: address,
      state: chatState(orderOf(s.brief), invite.name, rawNotes),
      sourcingId: s.id,
      secondsRemaining: SCREEN_SECONDS,
    });
    if (result.verdict === "deliver") {
      notes = result.deliveredText ?? "";
    } else {
      await deps.repo.addMessage({
        sourcingId: s.id,
        supplier: address,
        kind: "from_supplier",
        body: rawNotes,
        deliveredBody: null,
        verdict: "quarantine",
        card: result.card,
        screen: { ...screenRecord(result), source: "quote_notes" },
        offer: null,
      });
      if ((await statusOf(deps, s.id, address)) === "out") throw new SupplierOut(s.id, address);
    }
  }
  const quote: SupplierQuote = SupplierQuoteSchema.parse({
    quoteNumber: form.quoteNumber,
    supplierAddress: address,
    quantity: form.quantity,
    unitCents: form.unitCents,
    totalCents: Number(total),
    currency: "USD",
    incoterm: form.incoterm,
    port: form.port,
    notes,
  });
  // The delivery days ride beside the quote: the deal's SupplierQuote and its hash are exactly 4b's.
  return deps.repo.commitQuote(s.id, address, quote, sha256Hex(canonicalJson(quote)), form.deliveryDays);
}

export type ReportItem =
  | { supplier: string; offer: unknown; summary: string; at: string }
  | { supplier: string; offer: unknown; withheld: true; at: string };

export interface LeadView {
  id: string;
  ref: string;
  state: Sourcing["state"];
  brief: SourcingBrief;
  negotiationEndsAt: string;
  secondsLeft: number;
  selectedSupplier: string | null;
  dealId: string | null;
  invites: { address: string; name: string; status: "in" | "out"; cards: { yellow: number; red: number }; quote: SupplierQuote | null; deliveryDays: number | null; dealId: string | null }[];
  // Surety's ranking of the committed quotes for the buyer's priority. Lead and view only.
  ranking: RankedQuote[];
  // Whether to stop waiting and bring a deal to the buyer now, and why. Worked out by code.
  decideNow: DecideNow;
  reports: ReportItem[];
  suggestions: SupplierSuggestion[];
}

export async function leadView(deps: SourcingDeps, sourcingId: string): Promise<LeadView> {
  const s = await mustSourcing(deps, sourcingId);
  const messages = await deps.repo.listMessages(s.id);
  const of = (address: string) => messages.filter((m) => m.supplier === address);
  const invites = (await deps.repo.listInvites(s.id)).map((i) => ({
    address: i.address,
    name: i.name,
    status: supplierStatus(of(i.address)),
    cards: cardsOf(of(i.address)),
    quote: i.quote,
    deliveryDays: i.deliveryDays,
    dealId: i.dealId,
  }));
  // The offer's facts only: its summary reaches the lead through the screened deliveredBody, or not at all.
  const facts = (o: OfferReport | null) =>
    o && { supplier: o.supplier, unitCents: o.unitCents, quantity: o.quantity, deliveryDays: o.deliveryDays };
  const reports: ReportItem[] = messages
    .filter((m) => m.kind === "report")
    .map((m) =>
      m.verdict === "deliver"
        ? { supplier: m.supplier, offer: facts(m.offer), summary: m.deliveredBody ?? "", at: m.createdAt }
        : { supplier: m.supplier, offer: facts(m.offer), withheld: true as const, at: m.createdAt },
    );
  return {
    id: s.id,
    ref: s.ref,
    state: s.state,
    brief: s.brief,
    negotiationEndsAt: s.negotiationEndsAt,
    secondsLeft: secondsLeft(s, nowOf(deps)),
    selectedSupplier: s.selectedSupplier,
    dealId: s.dealId,
    invites,
    decideNow: readyToDecide(s, invites, await deps.repo.getControls(s.id), nowOf(deps)),
    ranking: rankQuotes(
      s.brief,
      invites.flatMap((i) => (i.quote ? [{ supplier: i.address, status: i.status, unitCents: i.quote.unitCents, deliveryDays: i.deliveryDays }] : [])),
    ),
    reports,
    suggestions: await deps.repo.listSuggestions(s.id),
  };
}

export interface NegotiatorView {
  id: string;
  ref: string;
  state: Sourcing["state"];
  goods: { description: string; quantity: number; targetUnitCents: number };
  incoterm: string;
  port: string;
  // What the buyer cares about, so the negotiator knows what to push for. Never the ranking.
  priority: SourcingBrief["priority"];
  latestDeliveryDays: number | null;
  // How hard the buyer wants the push, and anything the buyer said since the negotiation began.
  push: Push;
  // full: the negotiator's messages go out as it writes them. approve: each waits for the buyer.
  autonomy: Autonomy;
  // The buyer asked for what the agents have: ask every supplier for its final committed quote now.
  wrapUp: boolean;
  // Messages waiting for the buyer, one a supplier at most. Never their text: the negotiator wrote it.
  pendingDrafts: { supplier: string; at: string }[];
  buyerNotes: { text: string; at: string }[];
  negotiationEndsAt: string;
  secondsLeft: number;
  invites: { address: string; name: string; status: "in" | "out"; committed: boolean }[];
  // Competing offers to use as leverage, anonymised in what the negotiator says. Nothing in them comes
  // from the maximum.
  offers: Offer[];
}

// The negotiator's view carries the target price only: never the maximum, never committed prices.
export async function negotiatorView(deps: SourcingDeps, sourcingId: string): Promise<NegotiatorView> {
  const s = await mustSourcing(deps, sourcingId);
  const messages = await deps.repo.listMessages(s.id);
  const invites = await deps.repo.listInvites(s.id);
  const controls = await controlsOf(deps, s);
  return {
    id: s.id,
    ref: s.ref,
    state: s.state,
    goods: { description: s.brief.goods.description, quantity: s.brief.goods.quantity, targetUnitCents: s.brief.goods.targetUnitCents },
    incoterm: s.brief.incoterm,
    port: s.brief.port,
    priority: s.brief.priority,
    latestDeliveryDays: s.brief.latestDeliveryDays ?? null,
    push: controls.push,
    autonomy: controls.autonomy,
    wrapUp: controls.wrapUpAt !== null,
    pendingDrafts: (await deps.repo.listDrafts(s.id)).filter((d) => d.state === "pending").map((d) => ({ supplier: d.supplier, at: d.createdAt })),
    buyerNotes: (await deps.repo.listBuyerNotes(s.id)).map((n) => ({ text: n.text, at: n.createdAt })),
    negotiationEndsAt: s.negotiationEndsAt,
    secondsLeft: secondsLeft(s, nowOf(deps)),
    invites: invites.map((i) => ({
      address: i.address,
      name: i.name,
      status: supplierStatus(messages.filter((m) => m.supplier === i.address)),
      committed: i.quote !== null,
    })),
    offers: leverageOffers(messages, invites),
  };
}
