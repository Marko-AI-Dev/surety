import { beforeEach, describe, expect, it } from "vitest";
import { deliverableHash } from "@surety/contracts";
import { type DecisionEngine } from "@surety/gate";
import { type Job, type JobsRepo, createMemoryRepo, deliverJob, operationId, runEngineOnce } from "../src/index";
import { FakeSigner } from "./fake-signer";
import { EXACT, GATE_SECRET, INJECTION, WINDOW, WRONG_TOTAL, demoEngine, lockedGateJob } from "./gate-helpers";

const CLOSE = 800_000_000;
const AFTER_EXPIRY = CLOSE + WINDOW + 1;

let repo: JobsRepo;
let signer: FakeSigner;
let closeTime: number;

beforeEach(() => {
  repo = createMemoryRepo();
  signer = new FakeSigner(CLOSE, { secret: GATE_SECRET, now: () => new Date() });
  closeTime = CLOSE + 10;
});

function pass(engine: DecisionEngine, log?: (line: string) => void) {
  return runEngineOnce({ repo, signer, engine, gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime, log });
}

async function deliveredJob(raw: unknown): Promise<Job> {
  const job = await lockedGateJob(repo, signer);
  return deliverJob({ repo }, job.id, raw);
}

const states = async (job: Job) => (await repo.listEvents(job.id)).map((e) => e.toState);

describe("runEngineOnce", () => {
  it("pays a good deliverable in one pass: evaluate, then settle", async () => {
    const job = await deliveredJob(EXACT);
    const report = await pass(demoEngine());

    expect(report.evaluated).toEqual([job.id]);
    expect(report.paid).toEqual([job.id]);
    expect(report.pending).toEqual([]);
    expect(await states(job)).toEqual([
      "CREATE_PENDING",
      "LOCKED",
      "IN_PROGRESS",
      "DELIVERED",
      "EVALUATING",
      "APPROVED",
      "FINISH_PENDING",
      "PAID",
    ]);
    expect(signer.opIds("finish")).toEqual([operationId(job.id, "finish", 0)]);
  });

  it("never sweeps a PAID job, even long after expiry", async () => {
    const job = await deliveredJob(EXACT);
    await pass(demoEngine());
    closeTime = AFTER_EXPIRY;
    const report = await pass(demoEngine());
    expect(report.sweep.refunded).toEqual([]);
    expect((await repo.getJob(job.id))?.state).toBe("PAID");
    expect(signer.count("cancel")).toBe(0);
  });

  it("rejects a wrong total with zero engine calls, then refunds it after expiry", async () => {
    const engine = demoEngine();
    const job = await deliveredJob(WRONG_TOTAL);
    await pass(engine);
    expect((await repo.getJob(job.id))?.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect(engine.inputs).toHaveLength(0);

    closeTime = AFTER_EXPIRY;
    const report = await pass(engine);
    expect(report.sweep.refunded).toEqual([job.id]);
    expect((await repo.getJob(job.id))?.state).toBe("REFUNDED");
    expect(signer.count("finish")).toBe(0);
  });

  it("blocks an injected summary (0.03 / 0.98) and refunds it; payee and amount never change", async () => {
    const job = await deliveredJob(INJECTION);
    await pass(demoEngine());
    expect((await repo.getJob(job.id))?.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect(await repo.latestDecision(job.id)).toMatchObject({ outcome: "DECLINE", reasonCodes: ["injection_risk"] });

    closeTime = AFTER_EXPIRY;
    await pass(demoEngine());
    const refunded = await repo.getJob(job.id);
    expect(refunded?.state).toBe("REFUNDED");
    expect(refunded).toMatchObject({ sellerAddress: job.sellerAddress, amountDrops: job.amountDrops, snapshotHash: job.snapshotHash });
    expect(signer.count("finish")).toBe(0);
  });

  it("holds an unavailable evaluation for review and refunds it, with no authorization ever recorded", async () => {
    const offline = demoEngine({ [deliverableHash(EXACT)]: "unavailable" });
    const job = await deliveredJob(EXACT);
    await pass(offline);
    expect((await repo.getJob(job.id))?.state).toBe("REVIEW_REQUIRED");
    const decision = await repo.latestDecision(job.id);
    expect(decision?.outcome).toBe("UNAVAILABLE");

    await pass(offline); // a later pass does not retry or settle it
    closeTime = AFTER_EXPIRY;
    await pass(offline);
    expect((await repo.getJob(job.id))?.state).toBe("REFUNDED");
    expect(await repo.openAuthorization(decision?.id ?? "")).toBeNull();
    expect(signer.count("finish")).toBe(0);
    expect(offline.inputs).toHaveLength(1);
  });

  it("keeps going when one job fails: the other jobs in the pass still settle", async () => {
    const stuck = await deliveredJob(EXACT);
    const fine = await deliveredJob(EXACT);
    signer.script(operationId(stuck.id, "finish", 0), new TypeError("fetch failed"));
    const lines: string[] = [];

    const report = await pass(demoEngine(), (l) => lines.push(l));

    expect(report.paid).toEqual([fine.id]);
    expect(report.pending).toEqual([stuck.id]);
    expect((await repo.getJob(stuck.id))?.state).toBe("FINISH_PENDING");
    expect(lines.some((l) => l.includes(stuck.id) && l.includes("fetch failed"))).toBe(true);

    const next = await pass(demoEngine());
    expect(next.paid).toEqual([stuck.id]);
  });
});
