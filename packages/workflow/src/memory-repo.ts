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
  type NewJob,
  assertAmount,
  assertHash,
} from "./repo";
import { canonicalJson, sha256Hex } from "@surety/contracts";
import {
  type Deal,
  DealConflict,
  type DealEvent,
  type DealEventInput,
  DealTransitionConflict,
  type DealsRepo,
  QuoteConflict,
} from "./deal-repo";
import type { DealState } from "./deal-states";
import {
  type Attestation,
  AttestationConflict,
  INSPECTABLE_JOB_STATES,
  InspectionClosed,
  type InspectionRepo,
  sameAttestation,
} from "./inspection-repo";
import { createMemorySourcingRepo } from "./memory-sourcing-repo";
import type { SourcingRepo } from "./sourcing-repo";
import { snapshotHash } from "./snapshot";
import { CANCELLABLE_STATES, type JobState, assertTransition } from "./states";

const cancellable: ReadonlySet<JobState> = new Set(CANCELLABLE_STATES);

// Same behaviour as the Postgres repo, for unit tests. Each method runs without awaiting
// part-way through, so every operation is atomic. Callers get copies, never live rows.
export function createMemoryRepo(): JobsRepo & DealsRepo & SourcingRepo & InspectionRepo {
  const jobs = new Map<string, Job>();
  const escrows = new Map<string, EscrowRow>();
  const txs = new Map<string, TxRecord>();
  const txRecordedAt = new Map<string, number>();
  const events: JobEvent[] = [];
  const decisions: Decision[] = [];
  const authorizations: AuthorizationRow[] = [];
  const resumes = new Map<string, number>();
  const copy = structuredClone;

  const deals = new Map<string, Deal>();
  const dealEvents: DealEvent[] = [];
  const hashOf = (v: unknown) => sha256Hex(canonicalJson(v));

  // Synchronous on purpose: acceptDeal inserts the job and moves the deal with no await in between.
  function insertJob(input: NewJob): Job {
    assertAmount(input.amount);
    if ([...jobs.values()].some((j) => j.ref === input.ref)) throw new Error(`job ref ${input.ref} already exists`);
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
    return job;
  }

  function dealEvent(deal: Deal, from: DealState | null, event: DealEventInput): void {
    dealEvents.push({
      id: dealEvents.length + 1,
      dealId: deal.id,
      fromState: from,
      toState: deal.state,
      actor: event.actor,
      reasonCodes: [...event.reasonCodes],
      detail: event.detail === undefined ? null : copy(event.detail),
      createdAt: new Date().toISOString(),
    });
  }

  function move(dealId: string, from: DealState, to: DealState, event: DealEventInput, change: (d: Deal) => void = () => {}): Deal {
    const deal = deals.get(dealId);
    if (!deal || deal.state !== from) throw new DealTransitionConflict(dealId, deal?.state ?? "missing", to);
    change(deal);
    deal.state = to;
    deal.version += 1;
    dealEvent(deal, from, event);
    return copy(deal);
  }

  const dealsRepo: DealsRepo = {
    async addDealNote(dealId, event) {
      const deal = deals.get(dealId);
      if (!deal) throw new DealTransitionConflict(dealId, "missing", "QUOTE_RECEIVED");
      dealEvent(deal, deal.state, event);
      return copy(dealEvents[dealEvents.length - 1] as DealEvent);
    },

    async createDeal(intent, state, event) {
      if ([...deals.values()].some((d) => d.ref === intent.poNumber)) throw new DealConflict(intent.poNumber);
      const deal: Deal = {
        id: randomUUID(),
        ref: intent.poNumber,
        intent: copy(intent),
        intentHash: hashOf(intent),
        quote: null,
        quoteHash: null,
        quoteChecks: null,
        decision: null,
        state,
        jobId: null,
        version: 0,
        createdAt: new Date().toISOString(),
      };
      deals.set(deal.id, deal);
      dealEvent(deal, null, event);
      return copy(deal);
    },

    async getDeal(id) {
      const deal = deals.get(id);
      return deal ? copy(deal) : null;
    },

    async getDealByJob(jobId) {
      const deal = [...deals.values()].find((d) => d.jobId === jobId);
      return deal ? copy(deal) : null;
    },

    async listDeals(limit) {
      return [...deals.values()].reverse().slice(0, limit).map((d) => copy(d));
    },

    async listDealEvents(dealId) {
      return dealEvents.filter((e) => e.dealId === dealId).map((e) => copy(e));
    },

    async saveQuote(dealId, quote, quoteHash, checks, event) {
      const deal = deals.get(dealId);
      if (deal?.quoteHash === quoteHash) return copy(deal);
      if (deal && deal.quoteHash !== null) throw new QuoteConflict(dealId);
      return move(dealId, "AWAITING_QUOTE", "QUOTE_RECEIVED", event, (d) => {
        d.quote = copy(quote);
        d.quoteHash = quoteHash;
        d.quoteChecks = copy(checks);
      });
    },

    async declineDeal(dealId, decision, event) {
      return move(dealId, "QUOTE_RECEIVED", "DECLINED", event, (d) => {
        d.decision = copy(decision);
      });
    },

    async acceptDeal(dealId, decision, newJob, event) {
      const existing = deals.get(dealId);
      if (existing?.state === "ACCEPTED" && existing.jobId) {
        const job = jobs.get(existing.jobId);
        if (!job) throw new Error(`deal ${dealId} points at a missing job`);
        return { deal: copy(existing), job: copy(job) };
      }
      if (!existing || existing.state !== "QUOTE_RECEIVED") {
        throw new DealTransitionConflict(dealId, existing?.state ?? "missing", "ACCEPTED");
      }
      const job = insertJob(newJob);
      const deal = move(dealId, "QUOTE_RECEIVED", "ACCEPTED", event, (d) => {
        d.decision = copy(decision);
        d.jobId = job.id;
      });
      return { deal, job: copy(job) };
    },
  };

  const jobsRepo: JobsRepo = {
    async createJob(input) {
      return copy(insertJob(input));
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
      assertAmount(row.amount);
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

  const attestations: Attestation[] = [];
  const inspectable: ReadonlySet<JobState> = new Set(INSPECTABLE_JOB_STATES);
  const inspectionRepo: InspectionRepo = {
    async addAttestation(a) {
      const existing = attestations.find((x) => x.jobId === a.jobId || x.dealId === a.dealId);
      if (existing) {
        if (existing.jobId === a.jobId && existing.dealId === a.dealId && sameAttestation(existing, a)) return copy(existing);
        throw new AttestationConflict(a.jobId);
      }
      const job = jobs.get(a.jobId);
      if (deals.get(a.dealId)?.jobId !== a.jobId || !job || !inspectable.has(job.state)) throw new InspectionClosed(a.jobId);
      const row: Attestation = { ...copy(a), id: randomUUID(), createdAt: new Date().toISOString() };
      attestations.push(row);
      return copy(row);
    },

    async getAttestation(jobId) {
      const row = attestations.find((x) => x.jobId === jobId);
      return row ? copy(row) : null;
    },
  };

  return { ...jobsRepo, ...dealsRepo, ...createMemorySourcingRepo(), ...inspectionRepo };
}
