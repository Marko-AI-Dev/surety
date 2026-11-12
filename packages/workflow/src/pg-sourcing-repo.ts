import type postgres from "postgres";
import type { Row } from "postgres";
import { SourcingBriefSchema, type SupplierQuote } from "@surety/contracts";
import type { SourcingState } from "./sourcing-states";
import {
  CommittedQuoteConflict,
  type Invite,
  InviteConflict,
  type Sourcing,
  SourcingConflict,
  type SourcingMessage,
  type SourcingRepo,
  type SupplierReview,
  type SupplierSuggestion,
} from "./sourcing-repo";

const iso = (v: unknown) => (v as Date).toISOString();

function toSourcing(r: Row): Sourcing {
  return {
    id: r.id,
    ref: r.ref,
    // Parsed on read, so a brief stored before Phase 4d gains its defaults (priority balanced).
    brief: SourcingBriefSchema.parse(r.brief),
    state: r.state as SourcingState,
    negotiationEndsAt: iso(r.negotiation_ends_at),
    selectedSupplier: r.selected_supplier ?? null,
    dealId: r.deal_id ?? null,
    createdAt: iso(r.created_at),
  };
}

function toInvite(r: Row): Invite {
  return {
    sourcingId: r.sourcing_id,
    address: r.address,
    name: r.name,
    invitedAt: iso(r.invited_at),
    quote: (r.quote as SupplierQuote | null) ?? null,
    quoteHash: r.quote_hash ?? null,
    deliveryDays: r.delivery_days ?? null,
    dealId: r.deal_id ?? null,
  };
}

function toMessage(r: Row): SourcingMessage {
  return {
    id: String(r.id),
    sourcingId: r.sourcing_id,
    supplier: r.supplier,
    kind: r.kind,
    body: r.body,
    deliveredBody: r.delivered_body ?? null,
    verdict: r.verdict,
    card: r.card ?? null,
    screen: r.screen ?? null,
    offer: r.offer ?? null,
    createdAt: iso(r.created_at),
  };
}

function toSuggestion(r: Row): SupplierSuggestion {
  return { id: r.id, sourcingId: r.sourcing_id, name: r.name, address: r.address, reason: r.reason, createdAt: iso(r.created_at) };
}

function toReview(r: Row): SupplierReview {
  return { id: r.id, address: r.address, note: r.note, clearedAt: iso(r.cleared_at) };
}

// The sourcing store on Postgres. Shares the job and deal repo's connection.
export function createPgSourcingRepo(sql: postgres.Sql): SourcingRepo {
  const j = (value: unknown) => (value === null || value === undefined ? null : sql.json(value as postgres.JSONValue));
  const inTx = <T>(fn: (q: postgres.Sql) => Promise<T>) => sql.begin((tx) => fn(tx as unknown as postgres.Sql)) as Promise<T>;

  return {
    async createSourcing(ref, brief, negotiationEndsAt) {
      const [row] = await sql`
        insert into sourcings (ref, brief, state, negotiation_ends_at)
        values (${ref}, ${j(brief)}, 'OPEN', ${negotiationEndsAt})
        returning *`;
      if (!row) throw new Error("insert into sourcings returned no row");
      return toSourcing(row);
    },

    async getSourcing(id) {
      const [row] = await sql`select * from sourcings where id = ${id}`;
      return row ? toSourcing(row) : null;
    },

    async listSourcings(limit) {
      const rows = await sql`select * from sourcings order by created_at desc, id desc limit ${limit}`;
      return rows.map(toSourcing);
    },

    async addInvite(sourcingId, supplier) {
      const [row] = await sql`
        insert into sourcing_suppliers (sourcing_id, address, name)
        values (${sourcingId}, ${supplier.address}, ${supplier.name})
        on conflict (sourcing_id, address) do nothing
        returning *`;
      if (row) return toInvite(row);
      const [existing] = await sql`select * from sourcing_suppliers where sourcing_id = ${sourcingId} and address = ${supplier.address}`;
      if (!existing) throw new Error("invite neither inserted nor found");
      return toInvite(existing);
    },

    async listInvites(sourcingId) {
      const rows = await sql`select * from sourcing_suppliers where sourcing_id = ${sourcingId} order by invited_at, address`;
      return rows.map(toInvite);
    },

    async listInvitesFor(address) {
      const rows = await sql`select * from sourcing_suppliers where address = ${address} order by invited_at desc, sourcing_id desc`;
      return rows.map(toInvite);
    },

    async getInviteByDeal(dealId) {
      const [row] = await sql`select * from sourcing_suppliers where deal_id = ${dealId}`;
      return row ? toInvite(row) : null;
    },

    async addMessage(m) {
      const [row] = await sql`
        insert into sourcing_messages (sourcing_id, supplier, kind, body, delivered_body, verdict, card, screen, offer)
        values (${m.sourcingId}, ${m.supplier}, ${m.kind}, ${m.body}, ${m.deliveredBody}, ${m.verdict}, ${m.card},
                ${j(m.screen ?? null)}, ${j(m.offer ?? null)})
        returning *`;
      if (!row) throw new Error("insert into sourcing_messages returned no row");
      return toMessage(row);
    },

    async listMessages(sourcingId, opts = {}) {
      const rows =
        opts.supplier === undefined
          ? await sql`select * from sourcing_messages where sourcing_id = ${sourcingId} order by id`
          : await sql`select * from sourcing_messages where sourcing_id = ${sourcingId} and supplier = ${opts.supplier} order by id`;
      return rows.map(toMessage);
    },

    async listQuarantined(limit) {
      const rows = await sql`select * from sourcing_messages where verdict = 'quarantine' order by id desc limit ${limit}`;
      return rows.map(toMessage);
    },

    async listCards(address, since) {
      const rows =
        since === null
          ? await sql`select * from sourcing_messages where supplier = ${address} and card is not null order by id`
          : await sql`select * from sourcing_messages where supplier = ${address} and card is not null and created_at > ${since} order by id`;
      return rows.map(toMessage);
    },

    async commitQuote(sourcingId, address, quote, quoteHash, deliveryDays) {
      return inTx(async (q) => {
        const [row] = await q`select * from sourcing_suppliers where sourcing_id = ${sourcingId} and address = ${address} for update`;
        if (!row) throw new Error(`supplier ${address} is not invited to sourcing ${sourcingId}`);
        if (row.quote_hash !== null) {
          if (row.quote_hash === quoteHash && row.delivery_days === deliveryDays) return toInvite(row);
          throw new CommittedQuoteConflict(sourcingId, address);
        }
        const [updated] = await q`
          update sourcing_suppliers set quote = ${j(quote)}, quote_hash = ${quoteHash}, delivery_days = ${deliveryDays}
          where sourcing_id = ${sourcingId} and address = ${address}
          returning *`;
        if (!updated) throw new Error("update of sourcing_suppliers returned no row");
        return toInvite(updated);
      });
    },

    async attachDeal(sourcingId, address, dealId) {
      return inTx(async (q) => {
        const [row] = await q`select * from sourcing_suppliers where sourcing_id = ${sourcingId} and address = ${address} for update`;
        if (!row) throw new Error(`supplier ${address} is not invited to sourcing ${sourcingId}`);
        if (row.deal_id !== null) {
          if (row.deal_id === dealId) return toInvite(row);
          throw new InviteConflict(sourcingId, address);
        }
        const [updated] = await q`
          update sourcing_suppliers set deal_id = ${dealId}
          where sourcing_id = ${sourcingId} and address = ${address}
          returning *`;
        if (!updated) throw new Error("update of sourcing_suppliers returned no row");
        return toInvite(updated);
      });
    },

    async markSelected(sourcingId, address, dealId) {
      const [row] = await sql`
        update sourcings set state = 'SELECTED', selected_supplier = ${address}, deal_id = ${dealId}
        where id = ${sourcingId} and state = 'OPEN'
        returning *`;
      if (row) return toSourcing(row);
      const [current] = await sql`select state from sourcings where id = ${sourcingId}`;
      if (!current) throw new Error(`sourcing ${sourcingId} not found`);
      throw new SourcingConflict(sourcingId, current.state as string);
    },

    async releaseSelection(sourcingId, dealId) {
      const [row] = await sql`
        update sourcings set state = 'OPEN', selected_supplier = null, deal_id = null
        where id = ${sourcingId} and state = 'SELECTED' and deal_id = ${dealId}
        returning *`;
      if (row) return toSourcing(row);
      const [current] = await sql`select state from sourcings where id = ${sourcingId}`;
      if (!current) throw new Error(`sourcing ${sourcingId} not found`);
      throw new SourcingConflict(sourcingId, current.state as string);
    },

    async addSuggestion(s) {
      const [row] = await sql`
        insert into supplier_suggestions (sourcing_id, name, address, reason)
        values (${s.sourcingId}, ${s.name}, ${s.address}, ${s.reason})
        returning *`;
      if (!row) throw new Error("insert into supplier_suggestions returned no row");
      return toSuggestion(row);
    },

    async listSuggestions(sourcingId) {
      const rows = await sql`select * from supplier_suggestions where sourcing_id = ${sourcingId} order by created_at, id`;
      return rows.map(toSuggestion);
    },

    async addReview(address, note) {
      const [row] = await sql`insert into supplier_reviews (address, note) values (${address}, ${note}) returning *`;
      if (!row) throw new Error("insert into supplier_reviews returned no row");
      return toReview(row);
    },

    async lastReview(address) {
      const [row] = await sql`select * from supplier_reviews where address = ${address} order by cleared_at desc, id desc limit 1`;
      return row ? toReview(row) : null;
    },
  };
}
