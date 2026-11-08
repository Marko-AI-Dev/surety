import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { JOB_STATES, createPgRepo } from "@surety/workflow";
import { describeRepo } from "../../packages/workflow/test/repo-contract";
import { connect, databaseUrl, resetTables } from "./db";

let admin: Sql;

beforeAll(() => {
  admin = connect();
});

afterAll(async () => {
  await admin.end();
});

describeRepo("postgres", async () => {
  await resetTables(admin);
  return createPgRepo(databaseUrl());
});

describe("schema and state machine agree", () => {
  it("the jobs.state check accepts exactly JOB_STATES", async () => {
    const [row] = await admin`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%state%'`;
    const listed = [...String(row?.def).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...JOB_STATES].sort());
  });
});
