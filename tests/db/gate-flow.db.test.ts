import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverableHash } from "@surety/contracts";
import { type Job, type JobsRepo, createPgRepo, deliverJob, operationId, runEngineOnce } from "@surety/workflow";
import { FakeSigner } from "../../packages/workflow/test/fake-signer";
import {
  EXACT,
  GATE_SECRET,
  INJECTION,
  WINDOW,
  WRONG_TOTAL,
  demoEngine,
  lockedGateJob,
} from "../../packages/workflow/test/gate-helpers";
import { connect, databaseUrl, resetTables } from "./db";

const CLOSE = 800_000_000;
const AFTER_EXPIRY = CLOSE + WINDOW + 1;

let admin: Sql;
let repo: JobsRepo;
let signer: FakeSigner;
let closeTime: number;

beforeAll(() => {
  admin = connect();
});

beforeEach(async () => {
  await resetTables(admin);
  repo = createPgRepo(databaseUrl());
  signer = new FakeSigner(CLOSE, { secret: GATE_SECRET, now: () => new Date() });
  closeTime = CLOSE + 10;
});

afterEach(async () => {
  await repo.close();
});

afterAll(async () => {
  await admin.end();
});

function pass() {
  return runEngineOnce({ repo, signer, engine: demoEngine(), gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime });
}

async function deliveredJob(raw: unknown): Promise<Job> {
  const job = await lockedGateJob(repo, signer);
  return deliverJob({ repo }, job.id, raw);
}

describe("gate flow on Postgres", () => {
  it("pays a good deliverable with one finish bound to the stored hash, and never sweeps it", async () => {
    const job = await deliveredJob(EXACT);
    const report = await pass();
    expect(report.paid).toEqual([job.id]);

    const stored = await repo.getJob(job.id);
    expect(stored).toMatchObject({ state: "PAID", deliverable: EXACT, deliverableHash: deliverableHash(EXACT) });
    const decision = await repo.latestDecision(job.id);
    expect(decision).toMatchObject({
      outcome: "APPROVE",
      mode: "fixture",
      satisfaction: 0.95,
      injectionRisk: 0.02,
      policyVersion: "policy-v1",
      deliverableHash: deliverableHash(EXACT),
    });
    expect(signer.opIds("finish")).toEqual([operationId(job.id, "finish", 0)]);
    const [auth] = await admin`select * from authorizations where job_id = ${job.id}`;
    expect(auth?.signed.payload.deliverableHash).toBe(stored?.deliverableHash);
    expect(auth?.consumed_at).not.toBeNull();

    closeTime = AFTER_EXPIRY;
    await pass();
    expect((await repo.getJob(job.id))?.state).toBe("PAID");
    expect(signer.count("cancel")).toBe(0);
  });

  it("rejects a wrong total without the engine and an injected summary with it, then refunds both", async () => {
    const engine = demoEngine();
    const wrong = await deliveredJob(WRONG_TOTAL);
    const injected = await deliveredJob(INJECTION);
    await runEngineOnce({ repo, signer, engine, gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime });

    expect((await repo.getJob(wrong.id))?.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect((await repo.getJob(injected.id))?.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect(engine.inputs.map((i) => i.deliverableHash)).toEqual([deliverableHash(INJECTION)]);
    expect(await repo.latestDecision(wrong.id)).toMatchObject({ outcome: "DECLINE", mode: null });
    expect((await repo.latestDecision(wrong.id))?.reasonCodes).toContain("rule:total");
    expect(await repo.latestDecision(injected.id)).toMatchObject({
      outcome: "DECLINE",
      reasonCodes: ["injection_risk"],
      injectionRisk: 0.98,
    });

    closeTime = AFTER_EXPIRY;
    const report = await pass();
    expect(report.sweep.refunded.sort()).toEqual([wrong.id, injected.id].sort());
    expect(signer.count("finish")).toBe(0);
    const [count] = await admin`select count(*)::int as n from authorizations`;
    expect(count?.n).toBe(0);
  });
});
