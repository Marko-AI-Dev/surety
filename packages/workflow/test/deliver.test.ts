import { beforeEach, describe, expect, it } from "vitest";
import { deliverableHash } from "@surety/contracts";
import { DeliverableConflict, type JobsRepo, TransitionError, createMemoryRepo, deliverJob } from "../src/index";
import { FakeSigner } from "./fake-signer";
import { EXACT, WRONG_TOTAL, lockedGateJob } from "./gate-helpers";
import { newJob, walk } from "./repo-contract";

let repo: JobsRepo;
let signer: FakeSigner;

beforeEach(() => {
  repo = createMemoryRepo();
  signer = new FakeSigner();
});

const toStates = async (jobId: string) => (await repo.listEvents(jobId)).map((e) => [e.fromState, e.toState, e.actor]);

describe("deliverJob", () => {
  it("takes a LOCKED job through IN_PROGRESS to DELIVERED and stores the raw answer and its hash", async () => {
    const job = await lockedGateJob(repo, signer);
    const delivered = await deliverJob({ repo }, job.id, EXACT);

    expect(delivered).toMatchObject({ state: "DELIVERED", deliverable: EXACT, deliverableHash: deliverableHash(EXACT) });
    expect(await repo.getJob(job.id)).toEqual(delivered);
    expect((await toStates(job.id)).slice(2)).toEqual([
      ["LOCKED", "IN_PROGRESS", "seller"],
      ["IN_PROGRESS", "DELIVERED", "seller"],
    ]);
    const last = (await repo.listEvents(job.id)).at(-1);
    expect(last?.detail).toEqual({ deliverableHash: deliverableHash(EXACT) });
  });

  it("takes an IN_PROGRESS job straight to DELIVERED", async () => {
    const job = await walk(repo, await lockedGateJob(repo, signer), ["IN_PROGRESS"]);
    expect((await deliverJob({ repo }, job.id, EXACT)).state).toBe("DELIVERED");
  });

  it("treats the same bytes again as a no-op that returns the job", async () => {
    const job = await lockedGateJob(repo, signer);
    const first = await deliverJob({ repo }, job.id, EXACT);
    const reordered = Object.fromEntries(Object.entries(EXACT).reverse());
    const again = await deliverJob({ repo }, job.id, reordered);
    expect(again).toEqual(first);
    expect(await repo.listEvents(job.id)).toHaveLength(4);
  });

  it("refuses a changed deliverable after delivery and keeps the stored hash", async () => {
    const job = await lockedGateJob(repo, signer);
    await deliverJob({ repo }, job.id, EXACT);
    await expect(deliverJob({ repo }, job.id, WRONG_TOTAL)).rejects.toBeInstanceOf(DeliverableConflict);
    const stored = await repo.getJob(job.id);
    expect(stored?.deliverableHash).toBe(deliverableHash(EXACT));
    expect(stored?.state).toBe("DELIVERED");
  });

  it("refuses delivery to a job that is not funded, storing nothing", async () => {
    const draft = await repo.createJob(newJob());
    await expect(deliverJob({ repo }, draft.id, EXACT)).rejects.toBeInstanceOf(TransitionError);
    expect((await repo.getJob(draft.id))?.deliverableHash).toBeNull();
  });

  it("finishes a delivery that died after storing the answer but before DELIVERED", async () => {
    const job = await lockedGateJob(repo, signer);
    await repo.saveDeliverable(job.id, EXACT, deliverableHash(EXACT)); // the crash happens here
    expect((await deliverJob({ repo }, job.id, EXACT)).state).toBe("DELIVERED");
  });
});
