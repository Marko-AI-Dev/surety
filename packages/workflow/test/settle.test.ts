import { beforeEach, describe, expect, it } from "vitest";
import { type SignedAuthorization, bindingHash, deliverableHash } from "@surety/contracts";
import {
  type Job,
  type JobsRepo,
  createMemoryRepo,
  deliverJob,
  evaluateJob,
  operationId,
  runExpirySweep,
  settleJob,
} from "../src/index";
import { FakeSigner, signerError } from "./fake-signer";
import { EXACT, GATE_SECRET, WINDOW, demoEngine, lockedGateJob } from "./gate-helpers";

const CLOSE = 800_000_000;
const CANCEL_AFTER = CLOSE + WINDOW;
const CUTOFF = CANCEL_AFTER - 30;
const T0 = new Date("2026-11-09T10:00:00.000Z");

let repo: JobsRepo;
let signer: FakeSigner;
let closeTime: number;
let now: Date;

beforeEach(() => {
  repo = createMemoryRepo();
  now = T0;
  signer = new FakeSigner(CLOSE, { secret: GATE_SECRET, now: () => now });
  closeTime = CLOSE + 10;
});

async function approvedJob(): Promise<Job> {
  const job = await lockedGateJob(repo, signer);
  await deliverJob({ repo }, job.id, EXACT);
  const judged = await evaluateJob({ repo, engine: demoEngine(), ledgerCloseTime: async () => closeTime }, job.id);
  expect(judged.state).toBe("APPROVED");
  return judged;
}

function settle(job: Job) {
  return settleJob({ repo, signer, gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime, now: () => now }, job.id);
}

const finishAuths = () =>
  signer.calls.filter((c) => c.method === "finish").map((c) => (c.req as { authorization: SignedAuthorization }).authorization);

describe("settleJob", () => {
  it("pays an approved job: one finish opId, an authorization bound to the stored hash, consumed after validation", async () => {
    const job = await approvedJob();
    const paid = await settle(job);

    expect(paid.state).toBe("PAID");
    const decision = await repo.latestDecision(job.id);
    const opId = operationId(job.id, "finish", 0);
    expect(signer.opIds("finish")).toEqual([opId]);
    expect(signer.settled).toEqual([{ method: "finish", opId }]);

    const [auth] = finishAuths();
    const escrow = await repo.getEscrow(job.id);
    expect(auth?.payload).toMatchObject({
      network: "testnet",
      owner: escrow?.owner,
      offerSequence: escrow?.offerSequence,
      amountDrops: "1000000",
      destination: job.sellerAddress,
      jobSnapshotHash: job.snapshotHash,
      deliverableHash: deliverableHash(EXACT),
      policyVersion: "policy-v1",
      decisionId: decision?.id,
    });
    expect(auth?.payload.deliverableHash).toBe((await repo.getJob(job.id))?.deliverableHash);
    expect(Date.parse(auth?.payload.expiresAt ?? "")).toBe(T0.getTime() + 60_000);

    expect(await repo.openAuthorization(decision?.id ?? "")).toBeNull(); // consumed
    expect((await repo.listTransactions(job.id)).find((t) => t.type === "finish")).toMatchObject({
      operationId: opId,
      status: "validated",
      result: "tesSUCCESS",
    });
    const events = (await repo.listEvents(job.id)).slice(-2);
    expect(events.map((e) => [e.fromState, e.toState, e.reasonCodes])).toEqual([
      ["APPROVED", "FINISH_PENDING", ["settlement_started"]],
      ["FINISH_PENDING", "PAID", ["validated_tesSUCCESS"]],
    ]);
    expect((events[1]?.detail as { authorizationBindingHash: string }).authorizationBindingHash).toBe(
      bindingHash(auth!.payload),
    );
  });

  it("mints nothing once ledger time reaches the cutoff: the job stays APPROVED for the expiry sweep", async () => {
    const job = await approvedJob();
    closeTime = CUTOFF;
    const after = await settle(job);
    expect(after.state).toBe("APPROVED");
    expect(signer.count("finish")).toBe(0);
    expect(await repo.openAuthorization((await repo.latestDecision(job.id))?.id ?? "")).toBeNull();

    closeTime = CANCEL_AFTER + 1;
    await runExpirySweep({ repo, signer, ledgerCloseTime: async () => closeTime });
    expect((await repo.getJob(job.id))?.state).toBe("REFUNDED");
  });

  it("after a signer ledger_failure, the next pass replays the same opId with the same authorization", async () => {
    const job = await approvedJob();
    const opId = operationId(job.id, "finish", 0);
    signer.script(opId, signerError("ledger_failure"));

    await expect(settle(job)).rejects.toMatchObject({ code: "ledger_failure" });
    expect((await repo.getJob(job.id))?.state).toBe("FINISH_PENDING");

    now = new Date(T0.getTime() + 30_000); // still inside the authorization's life
    expect((await settle(job)).state).toBe("PAID");
    expect(signer.opIds("finish")).toEqual([opId]);
    const [first, second] = finishAuths();
    expect(second).toEqual(first);
    expect(signer.settled).toHaveLength(1);
  });

  it("after the authorization expires unused, mints attempt 1 with a new opId and still finishes exactly once", async () => {
    const job = await approvedJob();
    const op0 = operationId(job.id, "finish", 0);
    const op1 = operationId(job.id, "finish", 1);
    signer.script(op0, signerError("ledger_failure"));
    await expect(settle(job)).rejects.toMatchObject({ code: "ledger_failure" });

    now = new Date(T0.getTime() + 61_000);
    expect((await settle(job)).state).toBe("PAID");

    expect(signer.opIds("finish")).toEqual([op0, op1]);
    expect(signer.settled).toEqual([{ method: "finish", opId: op1 }]);
    const auths = finishAuths();
    expect(auths.at(-1)?.payload.nonce).not.toBe(auths[0]?.payload.nonce);
    const txs = (await repo.listTransactions(job.id)).filter((t) => t.type === "finish");
    expect(txs.map((t) => [t.operationId, t.status, t.result])).toEqual([
      [op0, "failed", "authorization_invalid"],
      [op1, "validated", "tesSUCCESS"],
    ]);
  });

  it("an expired authorization whose finish the signer did submit is replayed, not replaced", async () => {
    const job = await approvedJob();
    const op0 = operationId(job.id, "finish", 0);
    signer.script(op0, signerError("ledger_failure"));
    await expect(settle(job)).rejects.toMatchObject({ code: "ledger_failure" });
    // The signer had in fact submitted it and the finish validated; only the response was lost.
    const [auth0] = finishAuths();
    await signer.finishEscrow({ opId: op0, authorization: auth0! });

    now = new Date(T0.getTime() + 61_000);
    expect((await settle(job)).state).toBe("PAID");
    expect(signer.opIds("finish")).toEqual([op0]);
    expect(signer.settled).toEqual([{ method: "finish", opId: op0 }]);
  });

  it.each(["escrow_not_found", "escrow_mismatch"])("freezes the job for a person on %s", async (code) => {
    const job = await approvedJob();
    signer.script(operationId(job.id, "finish", 0), signerError(code));
    const after = await settle(job);
    expect(after.state).toBe("RECONCILIATION_REQUIRED");
    expect((await repo.listEvents(job.id)).at(-1)?.reasonCodes).toEqual([code]);
  });

  it.each(["op_failed", "finish_window_closed"])(
    "on %s leaves the job FINISH_PENDING for the expiry sweep and never calls finish again",
    async (code) => {
      const job = await approvedJob();
      signer.script(operationId(job.id, "finish", 0), signerError(code));
      expect((await settle(job)).state).toBe("FINISH_PENDING");
      expect((await settle(job)).state).toBe("FINISH_PENDING");
      expect(signer.count("finish")).toBe(1);

      closeTime = CANCEL_AFTER + 1;
      await runExpirySweep({ repo, signer, ledgerCloseTime: async () => closeTime });
      expect((await repo.getJob(job.id))?.state).toBe("REFUNDED");
    },
  );

  it("stays FINISH_PENDING on op_pending, then pays on the next pass with the same opId", async () => {
    const job = await approvedJob();
    const opId = operationId(job.id, "finish", 0);
    signer.script(opId, signerError("op_pending"));
    await expect(settle(job)).rejects.toMatchObject({ code: "op_pending" });
    expect((await repo.getJob(job.id))?.state).toBe("FINISH_PENDING");
    expect((await settle(job)).state).toBe("PAID");
    expect(signer.opIds("finish")).toEqual([opId]);
  });
});

describe("settleJob in TESTUSD", () => {
  it("a TESTUSD job's authorization binds amountTestUsdCents", async () => {
    const locked = await lockedGateJob(repo, signer, { amount: { asset: "TESTUSD", cents: "4800000" } });
    await deliverJob({ repo }, locked.id, EXACT);
    const judged = await evaluateJob({ repo, engine: demoEngine(), ledgerCloseTime: async () => closeTime }, locked.id);
    expect(judged.state).toBe("APPROVED");
    const paid = await settle(judged);
    expect(paid.state).toBe("PAID");
    const [auth] = finishAuths();
    expect(auth?.payload.amountTestUsdCents).toBe("4800000");
    expect(Object.keys(auth?.payload ?? {})).not.toContain("amountDrops");
  });
});
