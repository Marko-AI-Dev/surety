import { beforeEach, describe, expect, it } from "vitest";
import { deliverableHash } from "@surety/contracts";
import { type DecisionEngine, POLICY_V1 } from "@surety/gate";
import {
  type Job,
  type InspectionRepo,
  type JobsRepo,
  TransitionError,
  createMemoryRepo,
  deliverJob,
  evaluateJob,
  settleJob,
} from "../src/index";
import { FakeSigner } from "./fake-signer";
import {
  CRITERIA_TEXT,
  EXACT,
  GATE_SECRET,
  INJECTION,
  SOURCE,
  WINDOW,
  WRONG_TOTAL,
  counting,
  demoEngine,
  lockedGateJob,
} from "./gate-helpers";

const CLOSE = 800_000_000;
const CANCEL_AFTER = CLOSE + WINDOW;
const CUTOFF = CANCEL_AFTER - 30;

let repo: JobsRepo & InspectionRepo;
let signer: FakeSigner;
let closeTime: number;

beforeEach(() => {
  repo = createMemoryRepo();
  signer = new FakeSigner(CLOSE);
  closeTime = CLOSE + 10;
});

async function delivered(raw: unknown, overrides = {}): Promise<Job> {
  const job = await lockedGateJob(repo, signer, overrides);
  return deliverJob({ repo }, job.id, raw);
}

function evaluate(job: Job, engine: DecisionEngine, extra: Partial<Parameters<typeof evaluateJob>[0]> = {}) {
  return evaluateJob({ repo, engine, ledgerCloseTime: async () => closeTime, ...extra }, job.id);
}

const lastEvent = async (job: Job) => (await repo.listEvents(job.id)).at(-1);

describe("evaluateJob", () => {
  it("approves the exact deliverable and records a fixture decision bound to its hash and policy", async () => {
    const engine = demoEngine();
    const job = await delivered(EXACT);
    const after = await evaluate(job, engine);

    expect(after.state).toBe("APPROVED");
    expect(engine.inputs).toHaveLength(1);
    const decision = await repo.latestDecision(job.id);
    expect(decision).toMatchObject({
      jobId: job.id,
      mode: "fixture",
      outcome: "APPROVE",
      satisfaction: 0.95,
      injectionRisk: 0.02,
      provider: "fixture",
      reasonCodes: ["approved"],
      policyVersion: "policy-v1",
      deliverableHash: deliverableHash(EXACT),
      requestId: engine.inputs[0]?.requestId,
    });
    expect((decision?.rules as { passed: boolean }).passed).toBe(true);
    const events = (await repo.listEvents(job.id)).slice(-2);
    expect(events.map((e) => [e.fromState, e.toState, e.actor])).toEqual([
      ["DELIVERED", "EVALUATING", "gate"],
      ["EVALUATING", "APPROVED", "gate"],
    ]);
    expect(events[1]?.reasonCodes).toEqual(["approved"]);
    expect(events[1]?.correlationId).toBe(decision?.id);
  });

  it("gives the engine the frozen criteria, source and job hash, the parsed deliverable, and the time left before the cutoff", async () => {
    const engine = demoEngine();
    const job = await delivered(EXACT);
    await evaluate(job, engine);
    expect(engine.inputs[0]).toMatchObject({
      questionSet: "invoice",
      state: { task_criteria: CRITERIA_TEXT, source_invoice: SOURCE, deliverable: EXACT },
      deliverableHash: deliverableHash(EXACT),
      jobSnapshotHash: job.snapshotHash,
      policyVersion: "policy-v1",
      secondsRemaining: CUTOFF - closeTime,
    });
  });

  it("declines a wrong total on the rules alone: zero engine calls, the failed rule recorded, no mode", async () => {
    const engine = demoEngine();
    const job = await delivered(WRONG_TOTAL);
    const after = await evaluate(job, engine);

    expect(after.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect(engine.inputs).toHaveLength(0);
    const decision = await repo.latestDecision(job.id);
    expect(decision).toMatchObject({
      outcome: "DECLINE",
      mode: null,
      provider: null,
      model: null,
      satisfaction: null,
      injectionRisk: null,
      costUsd: null,
      policyVersion: "policy-v1",
    });
    expect(decision?.reasonCodes).toContain("rule:total");
    expect((await lastEvent(job))?.reasonCodes).toContain("rule:total");
  });

  it("declines an injected summary that passed every rule", async () => {
    const engine = demoEngine();
    const after = await evaluate(await delivered(INJECTION), engine);
    expect(after.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect(engine.inputs).toHaveLength(1);
    expect(await repo.latestDecision(after.id)).toMatchObject({ outcome: "DECLINE", reasonCodes: ["injection_risk"] });
  });

  it("sends an unavailable evaluation to REVIEW_REQUIRED with the engine's reasons", async () => {
    const offline = demoEngine({ [deliverableHash(EXACT)]: "unavailable" });
    const after = await evaluate(await delivered(EXACT), offline);
    expect(after.state).toBe("REVIEW_REQUIRED");
    expect(await repo.latestDecision(after.id)).toMatchObject({
      outcome: "UNAVAILABLE",
      mode: "fixture",
      reasonCodes: ["fixture_unavailable"],
    });
  });

  it("sends an uncertain score to REVIEW_REQUIRED", async () => {
    const unsure = demoEngine({ [deliverableHash(EXACT)]: { satisfaction: 0.6, injectionRisk: 0.2 } });
    const after = await evaluate(await delivered(EXACT), unsure);
    expect(after.state).toBe("REVIEW_REQUIRED");
    expect(await repo.latestDecision(after.id)).toMatchObject({ outcome: "ESCALATE", reasonCodes: ["uncertain"] });
  });

  it("treats an engine that throws as unavailable, never as approval", async () => {
    const broken = counting({
      mode: "live",
      evaluate: async () => {
        throw new Error("socket hang up");
      },
    });
    const after = await evaluate(await delivered(EXACT), broken);
    expect(after.state).toBe("REVIEW_REQUIRED");
    expect(await repo.latestDecision(after.id)).toMatchObject({ outcome: "UNAVAILABLE", mode: "live", reasonCodes: ["engine_error"] });
  });

  it("does not ask the engine once ledger time reaches CancelAfter minus 30: REVIEW_REQUIRED, decision_window_closed", async () => {
    const engine = demoEngine();
    const job = await delivered(EXACT);
    closeTime = CUTOFF;
    const after = await evaluate(job, engine);
    expect(after.state).toBe("REVIEW_REQUIRED");
    expect(engine.inputs).toHaveLength(0);
    expect((await lastEvent(job))?.reasonCodes).toEqual(["decision_window_closed"]);
    expect(await repo.latestDecision(job.id)).toBeNull();
  });

  it("still evaluates one second before the cutoff", async () => {
    closeTime = CUTOFF - 1;
    const after = await evaluate(await delivered(EXACT), demoEngine());
    expect(after.state).toBe("APPROVED");
  });

  it("fails the currency rule closed when the job's criteria permit no currency", async () => {
    const engine = demoEngine();
    const after = await evaluate(await delivered(EXACT, { criteria: { schema: "invoice-deliverable-v1" } }), engine);
    expect(after.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect(engine.inputs).toHaveLength(0);
    expect((await repo.latestDecision(after.id))?.reasonCodes).toEqual(["rule:currency"]);
  });

  it("refuses to judge under a policy version it does not know: REVIEW_REQUIRED, no engine call", async () => {
    const engine = demoEngine();
    const after = await evaluate(await delivered(EXACT, { policyVersion: "policy-v0" }), engine);
    expect(after.state).toBe("REVIEW_REQUIRED");
    expect(engine.inputs).toHaveLength(0);
    expect((await lastEvent(after))?.reasonCodes).toEqual(["unknown_policy"]);
  });

  it("uses an explicitly given policy and records its version", async () => {
    const strict = { ...POLICY_V1, version: "policy-test-strict", approveMinSatisfaction: 0.99 };
    const after = await evaluate(await delivered(EXACT), demoEngine(), { policy: strict });
    expect(after.state).toBe("REVIEW_REQUIRED");
    expect(await repo.latestDecision(after.id)).toMatchObject({ outcome: "ESCALATE", policyVersion: "policy-test-strict" });
  });

  it("leaves the job DELIVERED when ledger time cannot be read, so nothing is claimed", async () => {
    const job = await delivered(EXACT);
    await expect(
      evaluateJob({ repo, engine: demoEngine(), ledgerCloseTime: async () => Promise.reject(new Error("ws down")) }, job.id),
    ).rejects.toThrow(/ws down/);
    expect((await repo.getJob(job.id))?.state).toBe("DELIVERED");
  });

  describe("two evaluators racing on one job", () => {
    // Counts decision rows actually written, so a losing writer is not counted.
    function recording(): { repo: JobsRepo & InspectionRepo; rows: () => number } {
      let rows = 0;
      return {
        repo: {
          ...repo,
          async recordDecision(d) {
            const row = await repo.recordDecision(d);
            rows += 1;
            return row;
          },
        },
        rows: () => rows,
      };
    }

    async function settleOnce(job: Job) {
      return settleJob({ repo, signer, gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime }, job.id);
    }

    it("on a DELIVERED job: both calls return, one decision row, one settlement", async () => {
      const job = await delivered(EXACT);
      const shared = recording();
      const run = () => evaluateJob({ repo: shared.repo, engine: demoEngine(), ledgerCloseTime: async () => closeTime }, job.id);

      await Promise.all([run(), run()]);

      expect(shared.rows()).toBe(1);
      expect((await repo.getJob(job.id))?.state).toBe("APPROVED");
      expect((await settleOnce(job)).state).toBe("PAID");
      expect(signer.settled).toHaveLength(1);
    });

    it("on an EVALUATING job left by a dead worker: the second writer re-reads the winner instead of failing", async () => {
      const job = await delivered(EXACT);
      await repo.transition(job.id, "DELIVERED", "EVALUATING", { actor: "gate", reasonCodes: ["evaluation_started"] });
      const shared = recording();
      const engine = demoEngine();
      const run = () => evaluateJob({ repo: shared.repo, engine, ledgerCloseTime: async () => closeTime }, job.id);

      const results = await Promise.all([run(), run()]);

      expect(engine.inputs).toHaveLength(2); // no lease: both may ask, only one verdict is kept
      expect(shared.rows()).toBe(1);
      expect(results.map((r) => r.id)).toEqual([job.id, job.id]);
      expect((await repo.getJob(job.id))?.state).toBe("APPROVED");
      expect((await repo.listEvents(job.id)).filter((e) => e.toState === "APPROVED")).toHaveLength(1);
      expect((await settleOnce(job)).state).toBe("PAID");
      expect(signer.settled).toHaveLength(1);
    });
  });

  it("refuses a job that is not DELIVERED", async () => {
    const job = await lockedGateJob(repo, signer);
    await expect(evaluate(job, demoEngine())).rejects.toBeInstanceOf(TransitionError);
  });
});
