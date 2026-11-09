import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEAL_STATES, createPgRepo } from "@surety/workflow";
import { describeDealsRepo, newIntent } from "../../packages/workflow/test/deal-repo-contract";
import { connect, databaseUrl, resetTables } from "./db";

let admin: Sql;

beforeAll(() => {
  admin = connect();
});

afterAll(async () => {
  await admin.end();
});

describeDealsRepo("postgres", async () => {
  await resetTables(admin);
  return createPgRepo(databaseUrl());
});

describe("deals schema", () => {
  it("the deals.state check accepts exactly DEAL_STATES", async () => {
    const [row] = await admin`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'deals'::regclass and contype = 'c' and conname = 'deals_state_check'`;
    const listed = [...String(row?.def).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...DEAL_STATES].sort());
  });

  it("deal_events refuses UPDATE and DELETE", async () => {
    await resetTables(admin);
    const repo = createPgRepo(databaseUrl());
    try {
      const deal = await repo.createDeal(newIntent(), "AWAITING_QUOTE", { actor: "policy", reasonCodes: [] });
      await expect(admin`update deal_events set actor = 'x' where deal_id = ${deal.id}`).rejects.toThrow(/append-only/);
      await expect(admin`delete from deal_events where deal_id = ${deal.id}`).rejects.toThrow(/append-only/);
    } finally {
      await repo.close();
    }
  });

  it("an ACCEPTED deal without job_id violates the check", async () => {
    await resetTables(admin);
    const repo = createPgRepo(databaseUrl());
    try {
      const deal = await repo.createDeal(newIntent(), "AWAITING_QUOTE", { actor: "policy", reasonCodes: [] });
      await expect(admin`update deals set state = 'ACCEPTED' where id = ${deal.id}`).rejects.toThrow(/deals_accepted_has_job/);
    } finally {
      await repo.close();
    }
  });
});
