import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connect, resetTables } from "./db";

let sql: Sql;
let jobId: string;

beforeAll(() => {
  sql = connect();
});

beforeEach(async () => {
  await resetTables(sql);
  const [row] = await sql`
    insert into jobs (ref, buyer_address, seller_address, amount_drops, source_text, criteria, snapshot_hash,
                      policy_version, cancel_after_seconds)
    values (${`gate-schema-${Date.now()}`}, 'rBuyer', 'rSeller', 1000000, 'src', '{}', ${"c".repeat(64)}, 'policy-v1', 120)
    returning id`;
  jobId = row?.id;
});

afterAll(async () => {
  await sql.end();
});

function insertDecision(overrides: { mode?: string | null; outcome?: string; deliverableHash?: string } = {}) {
  const { mode = "live", outcome = "APPROVE", deliverableHash = "a".repeat(64) } = overrides;
  return sql`
    insert into decisions (job_id, request_id, mode, outcome, rules, policy_version, deliverable_hash)
    values (${jobId}, ${randomUUID()}, ${mode}, ${outcome}, '{"passed":true}', 'policy-v1', ${deliverableHash})
    returning id`;
}

describe("gate schema", () => {
  it("accepts every outcome and both modes, and a null mode when no engine was called", async () => {
    for (const outcome of ["APPROVE", "DECLINE", "ESCALATE", "UNAVAILABLE"]) {
      await insertDecision({ outcome });
    }
    await insertDecision({ mode: "fixture" });
    await insertDecision({ mode: null, outcome: "DECLINE" });
    const [row] = await sql`select count(*)::int as n from decisions`;
    expect(row?.n).toBe(6);
  });

  it("rejects an unknown outcome", async () => {
    await expect(insertDecision({ outcome: "PAY" })).rejects.toThrow(/outcome/);
  });

  it("rejects an unknown mode", async () => {
    await expect(insertDecision({ mode: "simulated" })).rejects.toThrow(/mode/);
  });

  it("rejects a decision or a job deliverable hash that is not 64 lowercase hex", async () => {
    await expect(insertDecision({ deliverableHash: "XYZ" })).rejects.toThrow(/deliverable_hash/);
    await expect(sql`update jobs set deliverable_hash = ${"A".repeat(64)} where id = ${jobId}`).rejects.toThrow(
      /deliverable_hash/,
    );
  });

  it("rejects an authorization for a decision that does not exist", async () => {
    await expect(sql`
      insert into authorizations (decision_id, job_id, attempt, operation_id, binding_hash, signed, expires_at)
      values (${randomUUID()}, ${jobId}, 0, ${randomUUID()}, ${"d".repeat(64)}, '{}', now())`).rejects.toThrow(
      /foreign key/,
    );
  });

  it("has row level security enabled on decisions and authorizations", async () => {
    const rows = await sql`
      select relname, relrowsecurity from pg_class where relname in ('decisions', 'authorizations') order by relname`;
    expect(rows.map((r) => [r.relname, r.relrowsecurity])).toEqual([
      ["authorizations", true],
      ["decisions", true],
    ]);
  });
});
