import type { InspectionRepo } from "./inspection-repo";
import { z } from "zod";
import {
  Address,
  type Card,
  ChatTextSchema,
  MAX_TESTUSD_CENTS,
  type OfferReport,
  OfferReportSchema,
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
import { CommittedQuoteConflict, type Invite, type Sourcing, type SourcingMessage, type SourcingRepo, type SupplierSuggestion } from "./sourcing-repo";

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
  if ((await statusOf(deps, s.id, address)) === "out") throw new SupplierOut(s.id, address);

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

// The negotiator's message to one supplier. Surety's own agent, so it isn't screened.
export async function postNegotiatorMessage(deps: SourcingDeps, sourcingId: string, address: string, raw: unknown): Promise<SourcingMessage> {
  const text = ChatTextSchema.parse(raw);
  const s = await mustSourcing(deps, sourcingId);
  mustBeOpen(s, nowOf(deps), { timed: true });
  await mustInvite(deps, s.id, address);
  if ((await statusOf(deps, s.id, address)) === "out") throw new SupplierOut(s.id, address);
  return deps.repo.addMessage({
    sourcingId: s.id,
    supplier: address,
    kind: "to_supplier",
    body: text,
    deliveredBody: text,
    verdict: "deliver",
    card: null,
    screen: null,
    offer: null,
  });
}

export type InboxItem =
  | { supplier: string; kind: "to_supplier" | "from_supplier"; text: string; at: string }
  | { supplier: string; kind: "from_supplier"; withheld: true; card: Card | null; at: string };

// What the negotiator reads: its own messages and every delivered supplier message. A quarantined
// message appears only as withheld, never with its text.
export async function negotiatorInbox(deps: SourcingDeps, sourcingId: string): Promise<InboxItem[]> {
  const s = await mustSourcing(deps, sourcingId);
  const items: InboxItem[] = [];
  for (const m of await deps.repo.listMessages(s.id)) {
    if (m.kind === "report") continue;
    if (m.kind === "to_supplier") items.push({ supplier: m.supplier, kind: "to_supplier", text: m.body, at: m.createdAt });
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
  negotiationEndsAt: string;
  secondsLeft: number;
  invites: { address: string; name: string; status: "in" | "out"; committed: boolean }[];
}

// The negotiator's view carries the target price only: never the maximum, never committed prices.
export async function negotiatorView(deps: SourcingDeps, sourcingId: string): Promise<NegotiatorView> {
  const s = await mustSourcing(deps, sourcingId);
  const messages = await deps.repo.listMessages(s.id);
  return {
    id: s.id,
    ref: s.ref,
    state: s.state,
    goods: { description: s.brief.goods.description, quantity: s.brief.goods.quantity, targetUnitCents: s.brief.goods.targetUnitCents },
    incoterm: s.brief.incoterm,
    port: s.brief.port,
    negotiationEndsAt: s.negotiationEndsAt,
    secondsLeft: secondsLeft(s, nowOf(deps)),
    invites: (await deps.repo.listInvites(s.id)).map((i) => ({
      address: i.address,
      name: i.name,
      status: supplierStatus(messages.filter((m) => m.supplier === i.address)),
      committed: i.quote !== null,
    })),
  };
}
