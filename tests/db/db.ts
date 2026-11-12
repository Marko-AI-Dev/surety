import postgres, { type Sql } from "postgres";

// Shared helpers for tests/db. These run against the local Supabase stack and wipe its job tables.

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: add it to the root .env and run pnpm db:start");
  return url;
}

export function connect(): Sql {
  return postgres(databaseUrl(), { onnotice: () => {} });
}

// TRUNCATE does not fire the row-level append-only trigger, so tests can start from empty tables.
export async function resetTables(sql: Sql): Promise<void> {
  await sql`truncate inspections, sourcing_messages, supplier_suggestions, supplier_reviews, sourcing_suppliers, sourcings, deal_events, deals, authorizations, decisions, job_events, transactions, escrows, jobs restart identity`;
}
