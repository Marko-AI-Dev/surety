import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AttestationConflict, createPgRepo } from "@surety/workflow";
import { DELIVERED, attestation, dealWithJob, describeInspectionRepo } from "../../packages/workflow/test/inspection-repo-contract";
import { connect, databaseUrl, resetTables } from "./db";

let admin: Sql;

beforeAll(() => {
  admin = connect();
});

afterAll(async () => {
  await admin.end();
});

describeInspectionRepo("postgres", async () => {
  await resetTables(admin);
  return createPgRepo(databaseUrl());
});

describe("inspections schema", () => {
  it("attestations cannot be updated or deleted", async () => {
    await resetTables(admin);
    const repo = createPgRepo(databaseUrl());
    try {
      const { dealId, job } = await dealWithJob(repo, DELIVERED);
      await repo.addAttestation(attestation(dealId, job.id));
      await expect(admin`update inspections set outcome = 'refused' where job_id = ${job.id}`).rejects.toThrow(/append-only/);
      await expect(admin`delete from inspections where job_id = ${job.id}`).rejects.toThrow(/append-only/);
    } finally {
      await repo.close();
    }
  });

  it("two different attestations inserted concurrently leave exactly one row", async () => {
    await resetTables(admin);
    const a = createPgRepo(databaseUrl());
    const b = createPgRepo(databaseUrl());
    try {
      const { dealId, job } = await dealWithJob(a, DELIVERED);
      const results = await Promise.allSettled([
        a.addAttestation(attestation(dealId, job.id)),
        b.addAttestation(attestation(dealId, job.id, { outcome: "refused", note: "Seal broken" })),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AttestationConflict);
      const [row] = await admin`select count(*)::int as n from inspections where job_id = ${job.id}`;
      expect(row?.n).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
