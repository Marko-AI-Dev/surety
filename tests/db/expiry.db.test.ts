import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Job, type JobsRepo, createPgRepo, fundJob, operationId, runExpirySweep } from "@surety/workflow";
import { FakeSigner } from "../../packages/workflow/test/fake-signer";
import { newJob } from "../../packages/workflow/test/repo-contract";
import { connect, databaseUrl, resetTables } from "./db";

const CLOSE = 800_000_000;
const WINDOW = 120;
const T = CLOSE + WINDOW;

let admin: Sql;
let signer: FakeSigner;
const open: JobsRepo[] = [];

function repo(): JobsRepo {
  const r = createPgRepo(databaseUrl());
  open.push(r);
  return r;
}

async function lockedJob(r: JobsRepo): Promise<Job> {
  const job = await r.createJob(newJob({ cancelAfterSeconds: WINDOW }));
  return fundJob({ repo: r, signer, actor: "buyer-agent" }, job.id);
}

beforeAll(() => {
  admin = connect();
});

beforeEach(async () => {
  await resetTables(admin);
  signer = new FakeSigner(CLOSE);
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((r) => r.close()));
});

afterAll(async () => {
  await admin.end();
});

describe("expiry sweep on Postgres", () => {
  it("survives a crash before expiry: a new connection and a new sweep after expiry refund", async () => {
    const first = repo();
    const job = await lockedJob(first);
    expect((await first.getEscrow(job.id))?.cancelAfter).toBe(T);

    const early = await runExpirySweep({ repo: first, signer, ledgerCloseTime: async () => T - 10 });
    expect(early).toEqual({ closeTime: T - 10, refunded: [], pending: [], reconciliation: [] });
    await first.close(); // the worker dies here; nothing it held in memory survives

    const second = repo();
    const report = await runExpirySweep({ repo: second, signer, ledgerCloseTime: async () => T + 1 });

    expect(report.refunded).toEqual([job.id]);
    expect((await second.getJob(job.id))?.state).toBe("REFUNDED");
    const events = await second.listEvents(job.id);
    expect(events.map((e) => [e.fromState, e.toState, e.actor])).toEqual([
      ["DRAFT", "CREATE_PENDING", "buyer-agent"],
      ["CREATE_PENDING", "LOCKED", "buyer-agent"],
      ["LOCKED", "EXPIRED_AWAITING_CANCEL", "expiry-worker"],
      ["EXPIRED_AWAITING_CANCEL", "CANCEL_PENDING", "expiry-worker"],
      ["CANCEL_PENDING", "REFUNDED", "expiry-worker"],
    ]);
    expect(signer.opIds("cancel")).toEqual([operationId(job.id, "cancel")]);
  });

  it("two sweeps racing on separate connections refund each job exactly once with one opId", async () => {
    const setup = repo();
    const jobs = await Promise.all(Array.from({ length: 5 }, () => lockedJob(setup)));
    const a = repo();
    const b = repo();

    const [ra, rb] = await Promise.all([
      runExpirySweep({ repo: a, signer, ledgerCloseTime: async () => T + 1 }),
      runExpirySweep({ repo: b, signer, ledgerCloseTime: async () => T + 1 }),
    ]);

    expect([...ra.refunded, ...rb.refunded].sort()).toEqual(jobs.map((j) => j.id).sort());
    expect([...ra.pending, ...rb.pending, ...ra.reconciliation, ...rb.reconciliation]).toEqual([]);
    for (const job of jobs) {
      const events = await setup.listEvents(job.id);
      expect(events.filter((e) => e.toState === "REFUNDED")).toHaveLength(1);
      expect(events.map((e) => e.toState)).toEqual([
        "CREATE_PENDING",
        "LOCKED",
        "EXPIRED_AWAITING_CANCEL",
        "CANCEL_PENDING",
        "REFUNDED",
      ]);
      expect((await setup.listTransactions(job.id)).filter((t) => t.type === "cancel")).toHaveLength(1);
    }
    expect(signer.opIds("cancel").sort()).toEqual(jobs.map((j) => operationId(j.id, "cancel")).sort());
  });
});
