import { randomUUID } from "node:crypto";
import {
  CommittedQuoteConflict,
  type Invite,
  InviteConflict,
  type Sourcing,
  SourcingConflict,
  type SourcingMessage,
  type SourcingRepo,
  type BuyerNote,
  type SupplierReview,
  type SupplierSuggestion,
} from "./sourcing-repo";

// Same behaviour as the Postgres sourcing store, for unit tests. Every method completes without
// awaiting part-way through, so each is atomic. Callers get copies, never live rows.
export function createMemorySourcingRepo(): SourcingRepo {
  const sourcings = new Map<string, Sourcing>();
  const invites = new Map<string, Invite>();
  const messages: SourcingMessage[] = [];
  const suggestions: SupplierSuggestion[] = [];
  const reviews: SupplierReview[] = [];
  const buyerNotes: BuyerNote[] = [];
  let messageId = 0;
  const copy = structuredClone;
  const key = (sourcingId: string, address: string) => `${sourcingId}/${address}`;
  const now = () => new Date().toISOString();

  function mustInvite(sourcingId: string, address: string): Invite {
    const invite = invites.get(key(sourcingId, address));
    if (!invite) throw new Error(`supplier ${address} is not invited to sourcing ${sourcingId}`);
    return invite;
  }

  return {
    async createSourcing(ref, brief, negotiationEndsAt) {
      if ([...sourcings.values()].some((s) => s.ref === ref)) throw new Error(`sourcing ref ${ref} already exists`);
      const s: Sourcing = {
        id: randomUUID(),
        ref,
        brief: copy(brief),
        state: "OPEN",
        negotiationEndsAt: negotiationEndsAt.toISOString(),
        selectedSupplier: null,
        dealId: null,
        createdAt: now(),
      };
      sourcings.set(s.id, s);
      return copy(s);
    },

    async getSourcing(id) {
      const s = sourcings.get(id);
      return s ? copy(s) : null;
    },

    async listSourcings(limit) {
      return [...sourcings.values()].reverse().slice(0, limit).map((x) => copy(x));
    },

    async addInvite(sourcingId, supplier) {
      if (!sourcings.has(sourcingId)) throw new Error(`sourcing ${sourcingId} not found`);
      const existing = invites.get(key(sourcingId, supplier.address));
      if (existing) return copy(existing);
      const invite: Invite = {
        sourcingId,
        address: supplier.address,
        name: supplier.name,
        invitedAt: now(),
        quote: null,
        quoteHash: null,
        deliveryDays: null,
        dealId: null,
      };
      invites.set(key(sourcingId, supplier.address), invite);
      return copy(invite);
    },

    async listInvites(sourcingId) {
      return [...invites.values()].filter((i) => i.sourcingId === sourcingId).map((x) => copy(x));
    },

    async listInvitesFor(address) {
      return [...invites.values()].filter((i) => i.address === address).reverse().map((x) => copy(x));
    },

    async getInviteByDeal(dealId) {
      const invite = [...invites.values()].find((i) => i.dealId === dealId);
      return invite ? copy(invite) : null;
    },

    async addMessage(m) {
      mustInvite(m.sourcingId, m.supplier);
      const message: SourcingMessage = { ...copy(m), id: String(++messageId), createdAt: now() };
      messages.push(message);
      return copy(message);
    },

    async listMessages(sourcingId, opts = {}) {
      return messages
        .filter((m) => m.sourcingId === sourcingId && (opts.supplier === undefined || m.supplier === opts.supplier))
        .map((x) => copy(x));
    },

    async listQuarantined(limit) {
      return messages
        .filter((m) => m.verdict === "quarantine")
        .reverse()
        .slice(0, limit)
        .map((x) => copy(x));
    },

    async listCards(address, since) {
      const after = since?.getTime() ?? Number.NEGATIVE_INFINITY;
      return messages.filter((m) => m.supplier === address && m.card !== null && Date.parse(m.createdAt) > after).map((x) => copy(x));
    },

    async commitQuote(sourcingId, address, quote, quoteHash, deliveryDays) {
      const invite = mustInvite(sourcingId, address);
      if (invite.quoteHash !== null) {
        if (invite.quoteHash === quoteHash && invite.deliveryDays === deliveryDays) return copy(invite);
        throw new CommittedQuoteConflict(sourcingId, address);
      }
      invite.quote = copy(quote);
      invite.quoteHash = quoteHash;
      invite.deliveryDays = deliveryDays;
      return copy(invite);
    },

    async attachDeal(sourcingId, address, dealId) {
      const invite = mustInvite(sourcingId, address);
      if (invite.dealId !== null) {
        if (invite.dealId === dealId) return copy(invite);
        throw new InviteConflict(sourcingId, address);
      }
      if ([...invites.values()].some((i) => i.dealId === dealId)) throw new Error(`deal ${dealId} is already attached`);
      invite.dealId = dealId;
      return copy(invite);
    },

    async markSelected(sourcingId, address, dealId) {
      const s = sourcings.get(sourcingId);
      if (!s) throw new Error(`sourcing ${sourcingId} not found`);
      if (s.state !== "OPEN") throw new SourcingConflict(sourcingId, s.state);
      s.state = "SELECTED";
      s.selectedSupplier = address;
      s.dealId = dealId;
      return copy(s);
    },

    async releaseSelection(sourcingId, dealId) {
      const s = sourcings.get(sourcingId);
      if (!s) throw new Error(`sourcing ${sourcingId} not found`);
      if (s.state !== "SELECTED" || s.dealId !== dealId) throw new SourcingConflict(sourcingId, s.state);
      s.state = "OPEN";
      s.selectedSupplier = null;
      s.dealId = null;
      return copy(s);
    },

    async addSuggestion(input) {
      const g: SupplierSuggestion = { id: randomUUID(), ...input, createdAt: now() };
      suggestions.push(g);
      return copy(g);
    },

    async listSuggestions(sourcingId) {
      return suggestions.filter((g) => g.sourcingId === sourcingId).map((x) => copy(x));
    },

    async addBuyerNote(sourcingId, text) {
      if (!sourcings.has(sourcingId)) throw new Error(`no sourcing ${sourcingId}`);
      const n: BuyerNote = { id: randomUUID(), sourcingId, text, createdAt: now() };
      buyerNotes.push(n);
      return copy(n);
    },

    async listBuyerNotes(sourcingId) {
      return buyerNotes.filter((n) => n.sourcingId === sourcingId).map((x) => copy(x));
    },

    async addReview(address, note) {
      const r: SupplierReview = { id: randomUUID(), address, note, clearedAt: now() };
      reviews.push(r);
      return copy(r);
    },

    async lastReview(address) {
      const r = reviews.filter((x) => x.address === address).at(-1);
      return r ? copy(r) : null;
    },
  };
}
