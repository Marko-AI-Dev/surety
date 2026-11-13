import type { Card, OfferReport, SourcingBrief, SupplierQuote } from "@surety/contracts";
import { QuoteConflict } from "./deal-repo";
import type { SourcingState } from "./sourcing-states";

// The sourcing store: the brief, the invited suppliers with their committed quotes, every chat
// message with its bouncer result (append-only), supplier suggestions and the operator's reviews.

export interface Sourcing {
  id: string;
  ref: string;
  brief: SourcingBrief;
  state: SourcingState;
  negotiationEndsAt: string;
  selectedSupplier: string | null;
  dealId: string | null;
  createdAt: string;
}

export interface Invite {
  sourcingId: string;
  address: string;
  name: string;
  invitedAt: string;
  quote: SupplierQuote | null;
  quoteHash: string | null;
  // The committed quote's delivery days (Phase 4d), stored beside it; null before a commit and for 4c rows.
  deliveryDays: number | null;
  dealId: string | null;
}

export type MessageKind = "to_supplier" | "from_supplier" | "report";

export interface NewSourcingMessage {
  sourcingId: string;
  // The supplier the message is from, to, or (for a report) about. Must be invited.
  supplier: string;
  kind: MessageKind;
  body: string;
  // What the agents may read: null when the message is quarantined.
  deliveredBody: string | null;
  verdict: "deliver" | "quarantine";
  card: Card | null;
  screen: unknown;
  offer: OfferReport | null;
}

export interface SourcingMessage extends NewSourcingMessage {
  id: string;
  createdAt: string;
}

export interface SupplierSuggestion {
  id: string;
  sourcingId: string;
  name: string;
  address: string;
  reason: string;
  createdAt: string;
}

// Something the buyer told its negotiator during the negotiation.
export interface BuyerNote {
  id: string;
  sourcingId: string;
  text: string;
  createdAt: string;
}

export interface SupplierReview {
  id: string;
  address: string;
  note: string;
  clearedAt: string;
}

export interface SourcingRepo {
  createSourcing(ref: string, brief: SourcingBrief, negotiationEndsAt: Date): Promise<Sourcing>;
  getSourcing(id: string): Promise<Sourcing | null>;
  // Newest first.
  listSourcings(limit: number): Promise<Sourcing[]>;
  // The same address again returns the existing invite unchanged.
  addInvite(sourcingId: string, supplier: { address: string; name: string }): Promise<Invite>;
  listInvites(sourcingId: string): Promise<Invite[]>;
  // Every invite for this supplier across sourcings, newest first.
  listInvitesFor(address: string): Promise<Invite[]>;
  getInviteByDeal(dealId: string): Promise<Invite | null>;
  // Refused when the supplier is not invited to the sourcing.
  addMessage(m: NewSourcingMessage): Promise<SourcingMessage>;
  // Oldest first.
  listMessages(sourcingId: string, opts?: { supplier?: string }): Promise<SourcingMessage[]>;
  // Held messages across sourcings, newest first.
  listQuarantined(limit: number): Promise<SourcingMessage[]>;
  // Messages carrying a card for this supplier across sourcings, after `since` when given; oldest first.
  listCards(address: string, since: Date | null): Promise<SourcingMessage[]>;
  // Same hash and days: the invite unchanged. Anything else: CommittedQuoteConflict (a QuoteConflict).
  commitQuote(sourcingId: string, address: string, quote: SupplierQuote, quoteHash: string, deliveryDays: number): Promise<Invite>;
  // Once per invite: the same deal again returns it unchanged, another deal is an InviteConflict.
  attachDeal(sourcingId: string, address: string, dealId: string): Promise<Invite>;
  // OPEN to SELECTED once; otherwise SourcingConflict. The lead's decision claims the sourcing with
  // this before any payment locks, so two decisions can never lock two payments.
  markSelected(sourcingId: string, address: string, dealId: string): Promise<Sourcing>;
  // SELECTED back to OPEN, only for the deal that holds it (a declined or overruled decision);
  // otherwise SourcingConflict.
  releaseSelection(sourcingId: string, dealId: string): Promise<Sourcing>;
  addSuggestion(s: { sourcingId: string; name: string; address: string; reason: string }): Promise<SupplierSuggestion>;
  listSuggestions(sourcingId: string): Promise<SupplierSuggestion[]>;
  addBuyerNote(sourcingId: string, text: string): Promise<BuyerNote>;
  // Oldest first.
  listBuyerNotes(sourcingId: string): Promise<BuyerNote[]>;
  addReview(address: string, note: string): Promise<SupplierReview>;
  lastReview(address: string): Promise<SupplierReview | null>;
}

// The sourcing is not in the state the move needs.
export class SourcingConflict extends Error {
  constructor(
    readonly sourcingId: string,
    readonly state: string,
  ) {
    super(`sourcing ${sourcingId} is ${state}`);
    this.name = "SourcingConflict";
  }
}

// The invite already has a different deal.
export class InviteConflict extends Error {
  constructor(
    readonly sourcingId: string,
    readonly address: string,
  ) {
    super(`supplier ${address} in sourcing ${sourcingId} already has a deal`);
    this.name = "InviteConflict";
  }
}

// A supplier's committed quote is never replaced.
export class CommittedQuoteConflict extends QuoteConflict {
  constructor(
    readonly sourcingId: string,
    readonly address: string,
  ) {
    super(sourcingId);
    this.message = `supplier ${address} already committed a different quote in sourcing ${sourcingId}`;
    this.name = "CommittedQuoteConflict";
  }
}
