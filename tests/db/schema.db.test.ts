import type { Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connect, resetTables } from "./db";

let sql: Sql;
let n = 0;

const BUYER = "rBuyerAddressForSchemaTests000001";
const SELLER = "rSellerAddressForSchemaTests00001";

function job(overrides: Record<string, unknown> = {}) {
  n += 1;
  return {
    ref: `schema-job-${n}`,
    buyer_address: BUYER,
    seller_address: SELLER,
    amount_drops: "1000000",
    source_text: "Invoice 42: 3 widgets at 10 EUR",
    criteria: sql.json({ fields: ["total"] }),
    snapshot_hash: "a".repeat(64),
    policy_version: "test-0",
    cancel_after_seconds: 120,
    ...overrides,
  };
}

async function insertJob(overrides: Record<string, unknown> = {}) {
  const [row] = await sql`insert into jobs ${sql(job(overrides))} returning *`;
  if (!row) throw new Error("insert returned no row");
  return row;
}

function escrow(jobId: string, overrides: Record<string, unknown> = {}) {
  return {
    job_id: jobId,
    network: "testnet",
    owner: BUYER,
    offer_sequence: 7,
    destination: SELLER,
    amount_drops: "1000000",
    condition: "A0258020" + "0".repeat(64) + "810120",
    cancel_after: 800_000_120,
    create_tx_hash: `${"C".repeat(60)}${String(n).padStart(4, "0")}`,
    create_ledger_index: 1000,
    ...overrides,
  };
}

async function event(jobId: string) {
  const [row] = await sql`
    insert into job_events (job_id, from_state, to_state, actor, reason_codes)
    values (${jobId}, 'DRAFT', 'CREATE_PENDING', 'test', ${["created"]})
    returning id`;
  if (!row) throw new Error("insert returned no row");
  return row.id as string;
}

beforeAll(() => {
  sql = connect();
});

beforeEach(async () => {
  await resetTables(sql);
});

afterAll(async () => {
  await sql.end();
});

describe("jobs", () => {
  it("accepts a valid job, starting DRAFT at version 0 on testnet with drops as a string", async () => {
    const row = await insertJob();
    expect(row.state).toBe("DRAFT");
    expect(row.version).toBe(0);
    expect(row.network).toBe("testnet");
    expect(row.amount_drops).toBe("1000000");
    expect(row.criteria).toEqual({ fields: ["total"] });
  });

  it("rejects a zero amount", async () => {
    await expect(insertJob({ amount_drops: "0" })).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects any network other than testnet", async () => {
    await expect(insertJob({ network: "mainnet" })).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects an unknown state", async () => {
    await expect(insertJob({ state: "SETTLED" })).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a malformed ref and a cancel window outside 60..86400 seconds", async () => {
    await expect(insertJob({ ref: "has spaces" })).rejects.toMatchObject({ code: "23514" });
    await expect(insertJob({ cancel_after_seconds: 59 })).rejects.toMatchObject({ code: "23514" });
  });
});

describe("escrows", () => {
  it("allows only one escrow per job", async () => {
    const j = await insertJob();
    await sql`insert into escrows ${sql(escrow(j.id))}`;
    await expect(
      sql`insert into escrows ${sql(escrow(j.id, { offer_sequence: 8, create_tx_hash: "D".repeat(64) }))}`,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects the same network, owner and offer sequence twice", async () => {
    const a = await insertJob();
    const b = await insertJob();
    await sql`insert into escrows ${sql(escrow(a.id))}`;
    await expect(
      sql`insert into escrows ${sql(escrow(b.id, { create_tx_hash: "E".repeat(64) }))}`,
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("job_events", () => {
  it("is append-only: UPDATE raises", async () => {
    const j = await insertJob();
    const id = await event(j.id);
    await expect(sql`update job_events set actor = 'tamper' where id = ${id}`).rejects.toThrow(/append-only/);
  });

  it("is append-only: DELETE raises", async () => {
    const j = await insertJob();
    const id = await event(j.id);
    await expect(sql`delete from job_events where id = ${id}`).rejects.toThrow(/append-only/);
  });
});

describe("row level security", () => {
  it("is enabled on every job table", async () => {
    const rows = await sql`
      select relname, relrowsecurity from pg_class
      where relnamespace = 'public'::regnamespace
        and relname in ('jobs', 'escrows', 'transactions', 'job_events')
      order by relname`;
    expect(rows.map((r) => [r.relname, r.relrowsecurity])).toEqual([
      ["escrows", true],
      ["job_events", true],
      ["jobs", true],
      ["transactions", true],
    ]);
  });
});
