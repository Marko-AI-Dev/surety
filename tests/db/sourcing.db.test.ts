import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOURCING_STATES, createPgRepo } from "@surety/workflow";
import { brief, describeSourcingRepo, newRef, supplierMessage } from "../../packages/workflow/test/sourcing-repo-contract";
import { SUPPLIER } from "../../scripts/deal-fixtures";
import { connect, databaseUrl, resetTables } from "./db";

let admin: Sql;

beforeAll(() => {
  admin = connect();
});

afterAll(async () => {
  await admin.end();
});

describeSourcingRepo("postgres", async () => {
  await resetTables(admin);
  return createPgRepo(databaseUrl());
});

describe("sourcing schema", () => {
  it("the sourcings.state check accepts exactly SOURCING_STATES", async () => {
    const [row] = await admin`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'sourcings'::regclass and contype = 'c' and conname = 'sourcings_state_check'`;
    const listed = [...String(row?.def).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...SOURCING_STATES].sort());
  });

  it("messages cannot be updated or deleted", async () => {
    await resetTables(admin);
    const repo = createPgRepo(databaseUrl());
    try {
      const s = await repo.createSourcing(newRef(), brief, new Date(Date.now() + 90_000));
      await repo.addInvite(s.id, { address: SUPPLIER, name: "Brightway" });
      await repo.addMessage(supplierMessage(s.id));
      await expect(admin`update sourcing_messages set body = 'x' where sourcing_id = ${s.id}`).rejects.toThrow(/append-only/);
      await expect(admin`delete from sourcing_messages where sourcing_id = ${s.id}`).rejects.toThrow(/append-only/);
    } finally {
      await repo.close();
    }
  });
});

describe("delivery days on committed quotes", () => {
  it("a 4c invite with a quote and no delivery days reads back with deliveryDays null", async () => {
    await resetTables(admin);
    const repo = createPgRepo(databaseUrl());
    try {
      const s = await repo.createSourcing(newRef(), brief, new Date(Date.now() + 90_000));
      await repo.addInvite(s.id, { address: SUPPLIER, name: "Brightway" });
      await admin`update sourcing_suppliers set quote = ${admin.json({ quoteNumber: "Q-1" })}, quote_hash = ${"c".repeat(64)} where sourcing_id = ${s.id}`;
      const [invite] = await repo.listInvites(s.id);
      expect(invite?.quoteHash).toBe("c".repeat(64));
      expect(invite?.deliveryDays).toBeNull();
    } finally {
      await repo.close();
    }
  });

  it("delivery days without a quote, or outside 1 to 365, are refused by the table", async () => {
    await resetTables(admin);
    const repo = createPgRepo(databaseUrl());
    try {
      const s = await repo.createSourcing(newRef(), brief, new Date(Date.now() + 90_000));
      await repo.addInvite(s.id, { address: SUPPLIER, name: "Brightway" });
      await expect(admin`update sourcing_suppliers set delivery_days = 21 where sourcing_id = ${s.id}`).rejects.toThrow();
      await expect(
        admin`update sourcing_suppliers set quote = ${admin.json({ quoteNumber: "Q-1" })}, quote_hash = ${"c".repeat(64)}, delivery_days = 0 where sourcing_id = ${s.id}`,
      ).rejects.toThrow();
    } finally {
      await repo.close();
    }
  });
});

describe("the buyer's priority", () => {
  it("a brief stored before 4d reads back with priority balanced", async () => {
    await resetTables(admin);
    const repo = createPgRepo(databaseUrl());
    try {
      const s = await repo.createSourcing(newRef(), brief, new Date(Date.now() + 90_000));
      await admin`update sourcings set brief = brief - 'priority' - 'latestDeliveryDays' where id = ${s.id}`;
      const [row] = await admin`select brief from sourcings where id = ${s.id}`;
      expect(row?.brief).not.toHaveProperty("priority");
      expect((await repo.getSourcing(s.id))?.brief.priority).toBe("balanced");
    } finally {
      await repo.close();
    }
  });
});
