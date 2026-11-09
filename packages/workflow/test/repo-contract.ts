import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@surety/contracts";
import {
  AuthorizationConflict,
  DecisionConflict,
  DeliverableConflict,
  type EscrowRow,
  type Job,
  type JobState,
  type JobsRepo,
  type NewAuthorization,
  type NewDecision,
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
    amount: { asset: "XRP", drops: "1000000" },
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
    amount: job.amount,
    issuer: null,
    condition: `A0258020${"0".repeat(64)}810120`,
    cancelAfter,
    createTxHash: randomUUID().replaceAll("-", "").toUpperCase().padEnd(64, "0"),
    createLedgerIndex: 1000 + sequences,
    ...overrides,
  };
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const RULES = { passed: true, results: [{ id: "size", status: "pass" }, { id: "schema", status: "pass" }] };

export function newDecision(jobId: string, overrides: Partial<NewDecision> = {}): NewDecision {
  return {
    jobId,
    requestId: randomUUID(),
    mode: "live",
    outcome: "APPROVE",
    satisfaction: 0.95,
    injectionRisk: 0.02,
    provider: "TypeSafe",
    model: "typesafe/jev-1.14-20261014",
    latencyMs: 543,
    costUsd: 0.0000305,
    reasonCodes: ["approved"],
    rules: RULES,
    policyVersion: "policy-v1",
    deliverableHash: HASH_A,
    ...overrides,
  };
}

export function newAuthorization(jobId: string, decisionId: string, attempt: number): NewAuthorization {
  return {
    decisionId,
    jobId,
    attempt,
    operationId: operationId(jobId, "finish", attempt),
    bindingHash: sha256Hex(`${decisionId}:${attempt}`),
    signed: { payload: { decisionId, attempt }, sig: "ab".repeat(32) },
    expiresAt: new Date(Date.UTC(2026, 10, 9, 10, 1, attempt)).toISOString(),
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

    it.each(["1.5", "1e6", "0123"])("refuses the drop string %s before writing anything", async (drops) => {
      const ref = `bad-drops-${Date.now()}-${drops.replace(/W/g, "_")}`;
      await expect(repo.createJob(newJob({ ref, amount: { asset: "XRP", drops } }))).rejects.toThrow(/amountDrops/);
      // The ref is still free, so no row was written.
      const ok = await repo.createJob(newJob({ ref }));
      expect(ok.amount).toEqual({ asset: "XRP", drops: "1000000" });
    });

    it.each(["1.5", "1e6", "0123"])("refuses the cent string %s before writing anything", async (cents) => {
      const ref = `bad-cents-${Date.now()}-${cents.replace(/W/g, "_")}`;
      await expect(repo.createJob(newJob({ ref, amount: { asset: "TESTUSD", cents } }))).rejects.toThrow(/amountTestUsdCents/);
      const ok = await repo.createJob(newJob({ ref }));
      expect(ok.ref).toBe(ref);
    });

    it("refuses an escrow whose drop string is not a positive integer, writing nothing", async () => {
      const job = await repo.createJob(newJob());
      await expect(repo.attachEscrow(escrowFor(job, 1_000, { amount: { asset: "XRP", drops: "1.5" } }))).rejects.toThrow(
        /amountDrops/,
      );
      expect(await repo.getEscrow(job.id)).toBeNull();
    });

    it("an XRP job's snapshot hash is unchanged by the asset refactor", async () => {
      const input = newJob({ criteriaText: "check the total" });
      const job = await repo.createJob(input);
      const legacy = sha256Hex(
        canonicalJson({
          ref: input.ref,
          buyerAddress: input.buyerAddress,
          sellerAddress: input.sellerAddress,
          amountDrops: "1000000",
          sourceText: input.sourceText,
          criteria: input.criteria,
          policyVersion: input.policyVersion,
          cancelAfterSeconds: input.cancelAfterSeconds,
          criteriaText: "check the total",
        }),
      );
      expect(job.snapshotHash).toBe(legacy);
    });

    it("creates and reads back a TESTUSD job and escrow with its issuer", async () => {
      const job = await repo.createJob(newJob({ amount: { asset: "TESTUSD", cents: "4800000" } }));
      expect((await repo.getJob(job.id))?.amount).toEqual({ asset: "TESTUSD", cents: "4800000" });
      const issuer = "rIssuerAddressForContractTests001";
      await repo.attachEscrow(escrowFor(job, 1_000, { issuer }));
      expect(await repo.getEscrow(job.id)).toMatchObject({ amount: { asset: "TESTUSD", cents: "4800000" }, issuer });
    });

    it("lists CREATE_PENDING jobs to resume: any with an escrow, or with a pending create at least the given age", async () => {
      const withEscrow = await walk(repo, await repo.createJob(newJob()), ["CREATE_PENDING"]);
      await repo.attachEscrow(escrowFor(withEscrow, 1_000));
      await repo.recordPendingTx({ operationId: operationId(withEscrow.id, "create"), jobId: withEscrow.id, type: "create" });
      const withPending = await walk(repo, await repo.createJob(newJob()), ["CREATE_PENDING"]);
      await repo.recordPendingTx({ operationId: operationId(withPending.id, "create"), jobId: withPending.id, type: "create" });
      const bare = await walk(repo, await repo.createJob(newJob()), ["CREATE_PENDING"]);
      const locked = await lockedJob(repo, 1_000);

      const young = (await repo.listFundingToResume(3_600)).map((j) => j.id);
      expect(young).toContain(withEscrow.id);
      expect(young).not.toContain(withPending.id);

      const listed = await repo.listFundingToResume(0);
      const ids = listed.map((j) => j.id);
      expect(ids.filter((id) => id === withEscrow.id)).toHaveLength(1);
      expect(ids).toContain(withPending.id);
      expect(ids).not.toContain(bare.id);
      expect(ids).not.toContain(locked.id);
      expect(listed.find((j) => j.id === withPending.id)).toEqual(withPending);
    });

    it("stores criteria text when given and freezes it into the snapshot hash; old jobs have none", async () => {
      const input = newJob({ criteriaText: "Extract every field exactly." });
      const withText = await repo.createJob(input);
      expect(withText.criteriaText).toBe("Extract every field exactly.");
      expect(withText.snapshotHash).toBe(snapshotHash(input));
      expect(withText.deliverable).toBeNull();
      expect(withText.deliverableHash).toBeNull();
      const plain = newJob();
      const without = await repo.createJob(plain);
      expect(without.criteriaText).toBeNull();
      expect(without.snapshotHash).toBe(snapshotHash(plain));
      expect(withText.snapshotHash).not.toBe(snapshotHash({ ...newJob(), ref: withText.ref }));
      expect(await repo.getJob(withText.id)).toEqual(withText);
    });

    it("saves a deliverable once: the same hash again is a duplicate, a different hash is a conflict", async () => {
      const job = await repo.createJob(newJob());
      const raw = { invoice_id: "DEMO-001", line_items: [{ description: "USB-C cable", quantity: 2 }] };
      expect(await repo.saveDeliverable(job.id, raw, HASH_A)).toBe("saved");
      expect(await repo.saveDeliverable(job.id, raw, HASH_A)).toBe("duplicate");
      await expect(repo.saveDeliverable(job.id, { changed: true }, HASH_B)).rejects.toBeInstanceOf(DeliverableConflict);
      const stored = await repo.getJob(job.id);
      expect(stored?.deliverableHash).toBe(HASH_A);
      expect(stored?.deliverable).toEqual(raw);
    });

    it("round-trips a decision with its rules JSON, and returns the latest decision for a job", async () => {
      const job = await repo.createJob(newJob());
      expect(await repo.latestDecision(job.id)).toBeNull();
      const declined = await repo.recordDecision(newDecision(job.id, { outcome: "DECLINE", mode: null, provider: null }));
      expect(declined).toMatchObject(newDecision(job.id, { outcome: "DECLINE", mode: null, provider: null, requestId: declined.requestId }));
      const approved = await repo.recordDecision(newDecision(job.id, { deliverableHash: HASH_B }));
      expect(approved.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Number.isNaN(Date.parse(approved.decidedAt))).toBe(false);
      expect(approved).toMatchObject({
        jobId: job.id,
        mode: "live",
        outcome: "APPROVE",
        satisfaction: 0.95,
        injectionRisk: 0.02,
        costUsd: 0.0000305,
        latencyMs: 543,
        reasonCodes: ["approved"],
        rules: RULES,
        policyVersion: "policy-v1",
        deliverableHash: HASH_B,
      });
      expect(await repo.latestDecision(job.id)).toEqual(approved);
    });

    it("keeps one decision per job and deliverable hash: a second is a DecisionConflict and writes nothing", async () => {
      const job = await repo.createJob(newJob());
      const first = await repo.recordDecision(newDecision(job.id, { outcome: "APPROVE" }));
      await expect(repo.recordDecision(newDecision(job.id, { outcome: "DECLINE" }))).rejects.toBeInstanceOf(DecisionConflict);
      expect(await repo.latestDecision(job.id)).toEqual(first);
      const other = await repo.createJob(newJob());
      await expect(repo.recordDecision(newDecision(other.id))).resolves.toMatchObject({ jobId: other.id });
    });

    it("counts evaluation resumes per job", async () => {
      const a = await repo.createJob(newJob());
      const b = await repo.createJob(newJob());
      expect(await repo.noteEvaluationResume(a.id)).toBe(1);
      expect(await repo.noteEvaluationResume(a.id)).toBe(2);
      expect(await repo.noteEvaluationResume(b.id)).toBe(1);
    });

    it("refuses a second decision with the same request id", async () => {
      const job = await repo.createJob(newJob());
      const d = newDecision(job.id);
      await repo.recordDecision(d);
      await expect(repo.recordDecision(d)).rejects.toThrow();
    });

    it("refuses two authorizations for one decision and attempt, or one operation id twice", async () => {
      const job = await repo.createJob(newJob());
      const decision = await repo.recordDecision(newDecision(job.id));
      const first = await repo.recordAuthorization(newAuthorization(job.id, decision.id, 0));
      expect(first).toMatchObject({ ...newAuthorization(job.id, decision.id, 0), consumedAt: null });
      await expect(repo.recordAuthorization({ ...newAuthorization(job.id, decision.id, 0), bindingHash: HASH_B })).rejects.toBeInstanceOf(
        AuthorizationConflict,
      );
      await expect(
        repo.recordAuthorization({ ...newAuthorization(job.id, decision.id, 1), operationId: first.operationId }),
      ).rejects.toBeInstanceOf(AuthorizationConflict);
      expect(await repo.openAuthorization(decision.id)).toEqual(first);
    });

    it("opens the latest unconsumed authorization and ignores consumed ones", async () => {
      const job = await repo.createJob(newJob());
      const decision = await repo.recordDecision(newDecision(job.id));
      expect(await repo.openAuthorization(decision.id)).toBeNull();
      const a0 = await repo.recordAuthorization(newAuthorization(job.id, decision.id, 0));
      const a1 = await repo.recordAuthorization(newAuthorization(job.id, decision.id, 1));
      expect((await repo.openAuthorization(decision.id))?.id).toBe(a1.id);
      await repo.consumeAuthorization(a1.id);
      expect((await repo.openAuthorization(decision.id))?.id).toBe(a0.id);
      await repo.consumeAuthorization(a0.id);
      expect(await repo.openAuthorization(decision.id)).toBeNull();
    });

    it("lists jobs in the given states only", async () => {
      const draft = await repo.createJob(newJob());
      const locked = await lockedJob(repo, 1_000);
      const delivered = await walk(repo, await lockedJob(repo, 1_000), ["IN_PROGRESS", "DELIVERED"]);
      const ids = (await repo.listJobsInStates(["DELIVERED", "LOCKED"])).map((j) => j.id);
      expect(ids).toContain(locked.id);
      expect(ids).toContain(delivered.id);
      expect(ids).not.toContain(draft.id);
      expect(await repo.listJobsInStates([])).toEqual([]);
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
