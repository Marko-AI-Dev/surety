import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type EscrowRow,
  type Job,
  type JobState,
  type JobsRepo,
  type NewJob,
  TransitionConflict,
  TransitionError,
  operationId,
  snapshotHash,
} from "../src/index";

// One behavioural suite for every JobsRepo implementation: in-memory (pnpm test) and Postgres (pnpm test:db).

let refs = 0;

export function newJob(overrides: Partial<NewJob> = {}): NewJob {
  refs += 1;
  return {
    ref: `contract-${Date.now()}-${refs}`,
    buyerAddress: "rBuyerAddressForContractTests0001",
    sellerAddress: "rSellerAddressForContractTests001",
    amountDrops: "1000000",
    sourceText: "Invoice 42: 3 widgets at 10 EUR",
    criteria: { fields: ["total"], total: "30.00" },
    policyVersion: "test-0",
    cancelAfterSeconds: 120,
    ...overrides,
  };
}

let sequences = 0;

export function escrowFor(job: Job, cancelAfter: number, overrides: Partial<EscrowRow> = {}): EscrowRow {
  sequences += 1;
  return {
    jobId: job.id,
    owner: job.buyerAddress,
    offerSequence: sequences,
    destination: job.sellerAddress,
    amountDrops: job.amountDrops,
    condition: `A0258020${"0".repeat(64)}810120`,
    cancelAfter,
    createTxHash: randomUUID().replaceAll("-", "").toUpperCase().padEnd(64, "0"),
    createLedgerIndex: 1000 + sequences,
    ...overrides,
  };
}

const TO_LOCKED: JobState[] = ["CREATE_PENDING", "LOCKED"];
const LOCKED_TO_PAID: JobState[] = [
  "IN_PROGRESS",
  "DELIVERED",
  "EVALUATING",
  "APPROVED",
  "FINISH_PENDING",
  "PAID",
];
const LOCKED_TO_REFUNDED: JobState[] = ["EXPIRED_AWAITING_CANCEL", "CANCEL_PENDING", "REFUNDED"];

export async function walk(repo: JobsRepo, job: Job, path: JobState[]): Promise<Job> {
  let current = job;
  for (const to of path) {
    current = await repo.transition(current.id, current.state, to, { actor: "test", reasonCodes: ["test_walk"] });
  }
  return current;
}

// A job with an escrow, walked to LOCKED.
export async function lockedJob(repo: JobsRepo, cancelAfter: number, overrides: Partial<NewJob> = {}) {
  const job = await repo.createJob(newJob(overrides));
  await repo.attachEscrow(escrowFor(job, cancelAfter));
  return walk(repo, job, TO_LOCKED);
}

export function describeRepo(name: string, make: () => Promise<JobsRepo>): void {
  describe(`JobsRepo contract: ${name}`, () => {
    let repo: JobsRepo;

    beforeEach(async () => {
      repo = await make();
    });

    afterEach(async () => {
      await repo.close();
    });

    it("creates a DRAFT job at version 0 with the canonical snapshot hash", async () => {
      const input = newJob();
      const job = await repo.createJob(input);
      expect(job).toMatchObject({ ...input, network: "testnet", state: "DRAFT", version: 0 });
      expect(job.snapshotHash).toBe(snapshotHash(input));
      expect(job.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(await repo.getJob(job.id)).toEqual(job);
    });

    it("returns null for a job or escrow that does not exist", async () => {
      expect(await repo.getJob(randomUUID())).toBeNull();
      expect(await repo.getEscrow(randomUUID())).toBeNull();
    });

    it("applies a valid transition: bumps the version and appends exactly one event", async () => {
      const job = await repo.createJob(newJob());
      const moved = await repo.transition(job.id, "DRAFT", "CREATE_PENDING", {
        actor: "buyer-api",
        reasonCodes: ["fund_requested"],
        correlationId: "corr-1",
        detail: { note: "first" },
      });
      expect(moved).toMatchObject({ id: job.id, state: "CREATE_PENDING", version: 1 });
      expect(await repo.getJob(job.id)).toEqual(moved);
      const events = await repo.listEvents(job.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        jobId: job.id,
        fromState: "DRAFT",
        toState: "CREATE_PENDING",
        actor: "buyer-api",
        reasonCodes: ["fund_requested"],
        correlationId: "corr-1",
        detail: { note: "first" },
      });
      expect(Number.isNaN(Date.parse(events[0]?.createdAt ?? ""))).toBe(false);
    });

    it("refuses a disallowed transition with TransitionError and writes nothing", async () => {
      const job = await repo.createJob(newJob());
      await expect(
        repo.transition(job.id, "DRAFT", "LOCKED", { actor: "test", reasonCodes: [] }),
      ).rejects.toBeInstanceOf(TransitionError);
      expect(await repo.getJob(job.id)).toMatchObject({ state: "DRAFT", version: 0 });
      expect(await repo.listEvents(job.id)).toEqual([]);
    });

    it("refuses a stale from-state with TransitionConflict and writes nothing", async () => {
      const job = await repo.createJob(newJob());
      await repo.transition(job.id, "DRAFT", "CREATE_PENDING", { actor: "a", reasonCodes: [] });
      await expect(
        repo.transition(job.id, "DRAFT", "CREATE_PENDING", { actor: "b", reasonCodes: [] }),
      ).rejects.toBeInstanceOf(TransitionConflict);
      expect(await repo.getJob(job.id)).toMatchObject({ state: "CREATE_PENDING", version: 1 });
      expect(await repo.listEvents(job.id)).toHaveLength(1);
    });

    it("stores and returns an escrow", async () => {
      const job = await repo.createJob(newJob());
      const row = escrowFor(job, 800_000_120);
      await repo.attachEscrow(row);
      expect(await repo.getEscrow(job.id)).toEqual(row);
    });

    it("lists cancellable jobs whose escrow cancel_after is strictly before ledger time", async () => {
      const due = await lockedJob(repo, 1_000);
      const notYet = await lockedJob(repo, 2_000);
      const exactlyNow = await lockedJob(repo, 1_500);
      const paid = await walk(repo, await lockedJob(repo, 500), LOCKED_TO_PAID);
      const refunded = await walk(repo, await lockedJob(repo, 500), LOCKED_TO_REFUNDED);

      const listed = await repo.listDueForCancel(1_500);
      const ids = listed.map((d) => d.job.id);
      expect(ids).toContain(due.id);
      expect(ids).not.toContain(notYet.id);
      expect(ids).not.toContain(exactlyNow.id);
      expect(ids).not.toContain(paid.id);
      expect(ids).not.toContain(refunded.id);
      const entry = listed.find((d) => d.job.id === due.id);
      expect(entry?.job).toEqual(due);
      expect(entry?.escrow).toEqual(await repo.getEscrow(due.id));
    });

    it("records a pending transaction once per operation id", async () => {
      const job = await repo.createJob(newJob());
      const opId = operationId(job.id, "create");
      await repo.recordPendingTx({ operationId: opId, jobId: job.id, type: "create" });
      await repo.recordPendingTx({ operationId: opId, jobId: job.id, type: "create" });
      const txs = await repo.listTransactions(job.id);
      expect(txs).toHaveLength(1);
      expect(txs[0]).toMatchObject({ operationId: opId, jobId: job.id, type: "create", status: "pending", txHash: null });
    });

    it("completes a transaction with its validated outcome, and a replayed pending record does not reset it", async () => {
      const job = await repo.createJob(newJob());
      const opId = operationId(job.id, "cancel");
      await repo.recordPendingTx({ operationId: opId, jobId: job.id, type: "cancel" });
      await repo.completeTx(opId, {
        txHash: "AB".repeat(32),
        status: "validated",
        result: "tesSUCCESS",
        ledgerIndex: 1234,
        feeDrops: "12",
      });
      await repo.recordPendingTx({ operationId: opId, jobId: job.id, type: "cancel" });
      expect(await repo.listTransactions(job.id)).toEqual([
        {
          operationId: opId,
          jobId: job.id,
          type: "cancel",
          txHash: "AB".repeat(32),
          status: "validated",
          result: "tesSUCCESS",
          ledgerIndex: 1234,
          feeDrops: "12",
        },
      ]);
    });

    it("records a refusal that never reached the ledger as failed with no hash", async () => {
      const job = await repo.createJob(newJob());
      const opId = operationId(job.id, "create");
      await repo.recordPendingTx({ operationId: opId, jobId: job.id, type: "create" });
      await repo.completeTx(opId, { txHash: null, status: "failed", result: "amount_over_cap" });
      expect(await repo.listTransactions(job.id)).toEqual([
        {
          operationId: opId,
          jobId: job.id,
          type: "create",
          txHash: null,
          status: "failed",
          result: "amount_over_cap",
          ledgerIndex: null,
          feeDrops: null,
        },
      ]);
    });
  });
}
