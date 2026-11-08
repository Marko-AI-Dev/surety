import { randomUUID } from "node:crypto";
import {
  AuthorizationConflict,
  type AuthorizationRow,
  type Decision,
  DecisionConflict,
  DeliverableConflict,
  type DueForCancel,
  type EscrowRow,
  type Job,
  type JobEvent,
  type JobsRepo,
  TransitionConflict,
  type TxRecord,
  assertDrops,
  assertHash,
} from "./repo";
import { snapshotHash } from "./snapshot";
import { CANCELLABLE_STATES, type JobState, assertTransition } from "./states";

const cancellable: ReadonlySet<JobState> = new Set(CANCELLABLE_STATES);

// Same behaviour as the Postgres repo, for unit tests. Each method runs without awaiting
// part-way through, so every operation is atomic. Callers get copies, never live rows.
export function createMemoryRepo(): JobsRepo {
  const jobs = new Map<string, Job>();
  const escrows = new Map<string, EscrowRow>();
  const txs = new Map<string, TxRecord>();
  const txRecordedAt = new Map<string, number>();
  const events: JobEvent[] = [];
  const decisions: Decision[] = [];
  const authorizations: AuthorizationRow[] = [];
  const resumes = new Map<string, number>();
  const copy = structuredClone;

  return {
    async createJob(input) {
      assertDrops(input.amountDrops);
      const job: Job = {
        ...copy(input),
        criteriaText: input.criteriaText ?? null,
        deliverable: null,
        deliverableHash: null,
        id: randomUUID(),
        network: "testnet",
        snapshotHash: snapshotHash(input),
        state: "DRAFT",
        version: 0,
      };
      jobs.set(job.id, job);
      return copy(job);
    },

    async getJob(id) {
      const job = jobs.get(id);
      return job ? copy(job) : null;
    },

    async getEscrow(jobId) {
      const row = escrows.get(jobId);
      return row ? copy(row) : null;
    },

    async transition(jobId, from, to, event) {
      assertTransition(from, to);
      const job = jobs.get(jobId);
      if (!job || job.state !== from) throw new TransitionConflict(jobId, from);
      job.state = to;
      job.version += 1;
      events.push({
        id: events.length + 1,
        jobId,
        fromState: from,
        toState: to,
        actor: event.actor,
        reasonCodes: [...event.reasonCodes],
        correlationId: event.correlationId ?? null,
        detail: event.detail === undefined ? null : copy(event.detail),
        createdAt: new Date().toISOString(),
      });
      return copy(job);
    },

    async attachEscrow(row) {
      assertDrops(row.amountDrops);
      if (escrows.has(row.jobId)) throw new Error(`job ${row.jobId} already has an escrow`);
      escrows.set(row.jobId, copy(row));
    },

    async recordPendingTx(t) {
      if (txs.has(t.operationId)) return;
      txRecordedAt.set(t.operationId, Date.now());
      txs.set(t.operationId, {
        operationId: t.operationId,
        jobId: t.jobId,
        type: t.type,
        txHash: null,
        status: "pending",
        result: null,
        ledgerIndex: null,
        feeDrops: null,
      });
    },

    async completeTx(operationId, r) {
      const tx = txs.get(operationId);
      if (!tx) throw new Error(`no transaction recorded for operation ${operationId}`);
      tx.txHash = r.txHash;
      tx.status = r.status;
      tx.result = r.result;
      tx.ledgerIndex = r.ledgerIndex ?? null;
      tx.feeDrops = r.feeDrops ?? null;
    },

    async listTransactions(jobId) {
      return [...txs.values()].filter((t) => t.jobId === jobId).map((t) => copy(t));
    },

    async listDueForCancel(ledgerCloseTime) {
      const due: DueForCancel[] = [];
      for (const job of jobs.values()) {
        const escrow = escrows.get(job.id);
        if (escrow && cancellable.has(job.state) && escrow.cancelAfter < ledgerCloseTime) {
          due.push({ job: copy(job), escrow: copy(escrow) });
        }
      }
      return due.sort((a, b) => a.escrow.cancelAfter - b.escrow.cancelAfter);
    },

    async listFundingToResume(minPendingAgeSeconds) {
      const now = Date.now();
      const stalePendingCreate = (jobId: string) =>
        [...txs.values()].some(
          (t) =>
            t.jobId === jobId &&
            t.type === "create" &&
            t.status === "pending" &&
            now - (txRecordedAt.get(t.operationId) ?? now) >= minPendingAgeSeconds * 1000,
        );
      return [...jobs.values()]
        .filter((j) => j.state === "CREATE_PENDING" && (escrows.has(j.id) || stalePendingCreate(j.id)))
        .map((j) => copy(j));
    },

    async listEvents(jobId) {
      return events.filter((e) => e.jobId === jobId).map((e) => copy(e));
    },

    async listJobsInStates(states) {
      const wanted = new Set(states);
      return [...jobs.values()].filter((j) => wanted.has(j.state)).map((j) => copy(j));
    },

    async saveDeliverable(jobId, raw, hash) {
      assertHash(hash);
      const job = jobs.get(jobId);
      if (!job) throw new Error(`job ${jobId} not found`);
      if (job.deliverableHash === null) {
        job.deliverable = copy(raw);
        job.deliverableHash = hash;
        return "saved";
      }
      if (job.deliverableHash === hash) return "duplicate";
      throw new DeliverableConflict(jobId, job.deliverableHash, hash);
    },

    async recordDecision(d) {
      assertHash(d.deliverableHash);
      if (!jobs.has(d.jobId)) throw new Error(`job ${d.jobId} not found`);
      if (decisions.some((x) => x.requestId === d.requestId)) {
        throw new Error(`decision request ${d.requestId} is already recorded`);
      }
      if (decisions.some((x) => x.jobId === d.jobId && x.deliverableHash === d.deliverableHash)) {
        throw new DecisionConflict(d.jobId, d.deliverableHash);
      }
      const row: Decision = { ...copy(d), id: randomUUID(), decidedAt: new Date().toISOString() };
      decisions.push(row);
      return copy(row);
    },

    async noteEvaluationResume(jobId) {
      if (!jobs.has(jobId)) throw new Error(`job ${jobId} not found`);
      const count = (resumes.get(jobId) ?? 0) + 1;
      resumes.set(jobId, count);
      return count;
    },

    async latestDecision(jobId) {
      const row = decisions.filter((d) => d.jobId === jobId).at(-1);
      return row ? copy(row) : null;
    },

    async recordAuthorization(a) {
      if (!decisions.some((d) => d.id === a.decisionId)) throw new Error(`decision ${a.decisionId} not found`);
      const clash = authorizations.some(
        (x) =>
          (x.decisionId === a.decisionId && x.attempt === a.attempt) ||
          x.operationId === a.operationId ||
          x.bindingHash === a.bindingHash,
      );
      if (clash) throw new AuthorizationConflict(a.decisionId, a.attempt);
      const row: AuthorizationRow = { ...copy(a), id: randomUUID(), consumedAt: null };
      authorizations.push(row);
      return copy(row);
    },

    async openAuthorization(decisionId) {
      const open = authorizations
        .filter((a) => a.decisionId === decisionId && a.consumedAt === null)
        .sort((x, y) => y.attempt - x.attempt);
      return open[0] ? copy(open[0]) : null;
    },

    async consumeAuthorization(id) {
      const row = authorizations.find((a) => a.id === id);
      if (row && row.consumedAt === null) row.consumedAt = new Date().toISOString();
    },

    async close() {},
  };
}
