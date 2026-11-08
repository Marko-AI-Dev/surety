import { randomUUID } from "node:crypto";
import {
  type DueForCancel,
  type EscrowRow,
  type Job,
  type JobEvent,
  type JobsRepo,
  TransitionConflict,
  type TxRecord,
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
  const events: JobEvent[] = [];
  const copy = structuredClone;

  return {
    async createJob(input) {
      const job: Job = {
        ...copy(input),
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
      if (escrows.has(row.jobId)) throw new Error(`job ${row.jobId} already has an escrow`);
      escrows.set(row.jobId, copy(row));
    },

    async recordPendingTx(t) {
      if (txs.has(t.operationId)) return;
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

    async listEvents(jobId) {
      return events.filter((e) => e.jobId === jobId).map((e) => copy(e));
    },

    async close() {},
  };
}
