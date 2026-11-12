import { beforeEach, describe, expect, it } from "vitest";
import { deliverableHash } from "@surety/contracts";
import { type DecisionEngine } from "@surety/gate";
import { type Job, type InspectionRepo, type JobsRepo, createMemoryRepo, deliverJob, operationId, runEngineOnce } from "../src/index";
import { FakeSigner } from "./fake-signer";
import { EXACT, GATE_SECRET, INJECTION, WINDOW, WRONG_TOTAL, demoEngine, lockedGateJob } from "./gate-helpers";

const CLOSE = 800_000_000;
const AFTER_EXPIRY = CLOSE + WINDOW + 1;

let repo: JobsRepo & InspectionRepo;
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
    expect(refunded).toMatchObject({ sellerAddress: job.sellerAddress, amount: job.amount, snapshotHash: job.snapshotHash });
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

  it("resumes a job whose worker died right after claiming it for evaluation: re-judged once, paid once", async () => {
    const job = await deliveredJob(EXACT);
    const engine = demoEngine();
    let decisions = 0;
    let crash = true;
    // The claim commits, then the process dies before anything else happens.
    const crashing: JobsRepo & InspectionRepo = {
      ...repo,
      async transition(jobId, from, to, event) {
        const moved = await repo.transition(jobId, from, to, event);
        if (crash && to === "EVALUATING") {
          crash = false;
          throw new Error("worker crashed after the claim");
        }
        return moved;
      },
      async recordDecision(d) {
        decisions += 1;
        return repo.recordDecision(d);
      },
    };
    const run = () =>
      runEngineOnce({ repo: crashing, signer, engine, gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime });

    const first = await run();
    expect(first.pending).toEqual([job.id]);
    expect((await repo.getJob(job.id))?.state).toBe("EVALUATING");
    expect(await repo.latestDecision(job.id)).toBeNull();

    const second = await run();
    expect(second.evaluated).toEqual([job.id]);
    expect(second.paid).toEqual([job.id]);
    expect(decisions).toBe(1);
    expect(engine.inputs).toHaveLength(1);
    expect(signer.settled).toEqual([{ method: "finish", opId: operationId(job.id, "finish", 0) }]);
  });

  it("resumes a job whose worker died after recording the decision: applies it without asking the engine again", async () => {
    const job = await deliveredJob(EXACT);
    const engine = demoEngine();
    let decisions = 0;
    let crash = true;
    const crashing: JobsRepo & InspectionRepo = {
      ...repo,
      async recordDecision(d) {
        decisions += 1;
        const row = await repo.recordDecision(d);
        if (crash) {
          crash = false;
          throw new Error("worker crashed after recording the decision");
        }
        return row;
      },
    };
    const run = () =>
      runEngineOnce({ repo: crashing, signer, engine, gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime });

    await run();
    expect((await repo.getJob(job.id))?.state).toBe("EVALUATING");

    const second = await run();
    expect(second.paid).toEqual([job.id]);
    expect(decisions).toBe(1);
    expect(engine.inputs).toHaveLength(1);
    expect(signer.settled).toHaveLength(1);
    expect((await repo.listEvents(job.id)).find((e) => e.toState === "APPROVED")?.reasonCodes).toEqual(["approved"]);
  });

  it("stops re-judging a job whose evaluation fails every time: REVIEW_REQUIRED after 3 resumes, at most 3 engine calls", async () => {
    const job = await deliveredJob(EXACT);
    const engine = demoEngine();
    // The verdict can never be stored (after the Jev call), so every attempt dies the same way.
    const poisoned: JobsRepo & InspectionRepo = {
      ...repo,
      async recordDecision() {
        throw new Error("decision store rejects this job");
      },
    };
    const run = () =>
      runEngineOnce({ repo: poisoned, signer, engine, gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime });

    for (let pass = 0; pass < 6; pass++) await run();

    expect((await repo.getJob(job.id))?.state).toBe("REVIEW_REQUIRED");
    expect(engine.inputs.length).toBeLessThanOrEqual(3);
    const last = (await repo.listEvents(job.id)).at(-1);
    expect(last).toMatchObject({ fromState: "EVALUATING", toState: "REVIEW_REQUIRED", reasonCodes: ["evaluation_resume_exhausted"] });
    expect(last?.detail).toMatchObject({ resumes: 3 });

    closeTime = AFTER_EXPIRY;
    await run();
    expect((await repo.getJob(job.id))?.state).toBe("REFUNDED");
  });

  it("refunds expired escrows before it judges anything in the same pass", async () => {
    const expiring = await deliveredJob(WRONG_TOTAL);
    await pass(demoEngine()); // rejected, waits for expiry
    signer.closeTime = CLOSE + 200; // the next escrow expires later
    const fresh = await deliveredJob(EXACT);
    closeTime = CLOSE + WINDOW + 1; // past the first escrow, well before the second one's cutoff
    const lines: string[] = [];

    await pass(demoEngine(), (l) => lines.push(l));

    const refundedAt = lines.findIndex((l) => l.startsWith("refunded") && l.includes(expiring.id));
    const evaluatedAt = lines.findIndex((l) => l.startsWith("evaluated") && l.includes(fresh.id));
    expect(refundedAt).toBeGreaterThanOrEqual(0);
    expect(evaluatedAt).toBeGreaterThan(refundedAt);
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
