import postgres, { type Row } from "postgres";
import { type AssetAmount, canonicalJson, sha256Hex } from "@surety/contracts";
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
import type { Operation } from "./operation-id";
import type { InspectionRepo } from "./inspection-repo";
import { createPgInspectionRepo } from "./pg-inspection-repo";
import { createPgSourcingRepo } from "./pg-sourcing-repo";
import type { SourcingRepo } from "./sourcing-repo";
import {
  AuthorizationConflict,
  type AuthorizationRow,
  type Decision,
  DecisionConflict,
  DeliverableConflict,
  type EscrowRow,
  type Job,
  type JobEvent,
  type JobsRepo,
  type NewDecision,
  type NewJob,
  TransitionConflict,
  type TxRecord,
  assertAmount,
  assertHash,
} from "./repo";
import { snapshotHash } from "./snapshot";
import { CANCELLABLE_STATES, type JobState, assertTransition } from "./states";

type Json = postgres.JSONValue;

function toJob(r: Row): Job {
  return {
    id: r.id,
    ref: r.ref,
    network: r.network,
    buyerAddress: r.buyer_address,
    sellerAddress: r.seller_address,
    amount: amountOf(r),
    sourceText: r.source_text,
    criteria: r.criteria,
    snapshotHash: r.snapshot_hash,
    policyVersion: r.policy_version,
    cancelAfterSeconds: r.cancel_after_seconds,
    criteriaText: r.criteria_text ?? null,
    deliverable: r.deliverable ?? null,
    deliverableHash: r.deliverable_hash ?? null,
    state: r.state as JobState,
    version: r.version,
  };
}

// numeric columns arrive as strings; scores and cost are plain numbers in TypeScript.
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toDecision(r: Row): Decision {
  return {
    id: r.id,
    jobId: r.job_id,
    requestId: r.request_id,
    mode: r.mode,
    outcome: r.outcome,
    satisfaction: num(r.satisfaction),
    injectionRisk: num(r.injection_risk),
    provider: r.provider,
    model: r.model,
    latencyMs: r.latency_ms,
    costUsd: num(r.cost_usd),
    reasonCodes: r.reason_codes,
    rules: r.rules,
    policyVersion: r.policy_version,
    deliverableHash: r.deliverable_hash,
    samples: r.samples ?? null,
    decidedAt: (r.decided_at as Date).toISOString(),
  };
}

function toAuthorization(r: Row): AuthorizationRow {
  return {
    id: r.id,
    decisionId: r.decision_id,
    jobId: r.job_id,
    attempt: r.attempt,
    operationId: r.operation_id,
    bindingHash: r.binding_hash,
    signed: r.signed,
    expiresAt: (r.expires_at as Date).toISOString(),
    consumedAt: r.consumed_at ? (r.consumed_at as Date).toISOString() : null,
  };
}

const UNIQUE_VIOLATION = "23505";

// numeric columns arrive as strings. The schema guarantees exactly one amount column is set.
function amountOf(r: Row, prefix = ""): AssetAmount {
  return r[`${prefix}asset`] === "TESTUSD"
    ? { asset: "TESTUSD", cents: String(r[`${prefix}amount_testusd_cents`]) }
    : { asset: "XRP", drops: String(r[`${prefix}amount_drops`]) };
}

// prefix is set when escrow columns are aliased in a join with jobs (which has the same names).
function toEscrow(r: Row, prefix = ""): EscrowRow {
  return {
    jobId: r.job_id,
    owner: r.owner,
    offerSequence: r.offer_sequence,
    destination: r.destination,
    amount: amountOf(r, prefix),
    issuer: r[`${prefix}issuer`] ?? null,
    condition: r.condition,
    cancelAfter: r.cancel_after,
    createTxHash: r.create_tx_hash,
    createLedgerIndex: r.create_ledger_index,
  };
}

function toTx(r: Row): TxRecord {
  return {
    operationId: r.operation_id,
    jobId: r.job_id,
    type: r.type as Operation,
    txHash: r.tx_hash,
    status: r.status,
    result: r.result,
    ledgerIndex: r.ledger_index,
    feeDrops: r.fee_drops,
  };
}

function toEvent(r: Row): JobEvent {
  return {
    id: Number(r.id),
    jobId: r.job_id,
    fromState: r.from_state as JobState | null,
    toState: r.to_state as JobState,
    actor: r.actor,
    reasonCodes: r.reason_codes,
    correlationId: r.correlation_id,
    detail: r.detail,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

function toDeal(r: Row): Deal {
  return {
    id: r.id,
    ref: r.ref,
    intent: r.intent,
    intentHash: r.intent_hash,
    quote: r.quote ?? null,
    quoteHash: r.quote_hash ?? null,
    quoteChecks: r.quote_checks ?? null,
    decision: r.decision ?? null,
    state: r.state as DealState,
    jobId: r.job_id ?? null,
    version: r.version,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

function toDealEvent(r: Row): DealEvent {
  return {
    id: Number(r.id),
    dealId: r.deal_id,
    fromState: r.from_state as DealState | null,
    toState: r.to_state as DealState,
    actor: r.actor,
    reasonCodes: r.reason_codes,
    detail: r.detail,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

// The backend connects as postgres (RLS has no policies yet, so only this role can use the tables).
export function createPgRepo(databaseUrl: string): JobsRepo & DealsRepo & SourcingRepo & InspectionRepo {
  const sql = postgres(databaseUrl, { onnotice: () => {} });
  const json = (value: unknown) => (value === undefined ? null : sql.json(value as Json));

  // Shared by createJob and acceptDeal, so a deal's job is written by the same statement inside the
  // deal's transaction.
  async function insertJob(q: postgres.Sql, input: NewJob) {
    assertAmount(input.amount);
    const { asset, drops, cents } = amountColumns(input.amount);
    const [row] = await q`
      insert into jobs (ref, buyer_address, seller_address, asset, amount_drops, amount_testusd_cents, source_text,
                        criteria, snapshot_hash, policy_version, cancel_after_seconds, criteria_text)
      values (${input.ref}, ${input.buyerAddress}, ${input.sellerAddress}, ${asset}, ${drops}, ${cents},
              ${input.sourceText}, ${json(input.criteria)}, ${snapshotHash(input)}, ${input.policyVersion},
              ${input.cancelAfterSeconds}, ${input.criteriaText ?? null})
      returning *`;
    if (!row) throw new Error("insert into jobs returned no row");
    return toJob(row);
  }

  async function addDealEvent(q: postgres.Sql, dealId: string, from: DealState | null, to: DealState, event: DealEventInput) {
    await q`
      insert into deal_events (deal_id, from_state, to_state, actor, reason_codes, detail)
      values (${dealId}, ${from}, ${to}, ${event.actor}, ${event.reasonCodes}::text[], ${json(event.detail)})`;
  }

  const dealsRepo: DealsRepo = {
    async addDealNote(dealId, event) {
      const [row] = await sql`
        insert into deal_events (deal_id, from_state, to_state, actor, reason_codes, detail)
        select id, state, state, ${event.actor}, ${event.reasonCodes}::text[], ${json(event.detail)} from deals where id = ${dealId}
        returning *`;
      if (!row) throw new DealTransitionConflict(dealId, "missing", "QUOTE_RECEIVED");
      return toDealEvent(row);
    },

    async createDeal(intent, state, event) {
      try {
        return await sql.begin(async (tx) => {
          const q = tx as unknown as postgres.Sql;
          const [row] = await q`
            insert into deals (ref, intent, intent_hash, state)
            values (${intent.poNumber}, ${json(intent)}, ${sha256Hex(canonicalJson(intent))}, ${state})
            returning *`;
          if (!row) throw new Error("insert into deals returned no row");
          await addDealEvent(q, row.id, null, state, event);
          return toDeal(row);
        });
      } catch (e) {
        const err = e as { code?: string; constraint_name?: string };
        if (err.code === UNIQUE_VIOLATION && err.constraint_name === "deals_ref_key") throw new DealConflict(intent.poNumber);
        throw e;
      }
    },

    async getDeal(id) {
      const [row] = await sql`select * from deals where id = ${id}`;
      return row ? toDeal(row) : null;
    },

    async getDealByJob(jobId) {
      const [row] = await sql`select * from deals where job_id = ${jobId}`;
      return row ? toDeal(row) : null;
    },

    async listDeals(limit) {
      const rows = await sql`select * from deals order by created_at desc, id desc limit ${limit}`;
      return rows.map(toDeal);
    },

    async listDealEvents(dealId) {
      const rows = await sql`select * from deal_events where deal_id = ${dealId} order by id`;
      return rows.map(toDealEvent);
    },

    async saveQuote(dealId, quote, quoteHash, checks, event) {
      return sql.begin(async (tx) => {
        const q = tx as unknown as postgres.Sql;
        const [current] = await q`select * from deals where id = ${dealId} for update`;
        if (!current) throw new DealTransitionConflict(dealId, "missing", "QUOTE_RECEIVED");
        if (current.quote_hash === quoteHash) return toDeal(current);
        if (current.quote_hash !== null) throw new QuoteConflict(dealId);
        if (current.state !== "AWAITING_QUOTE") throw new DealTransitionConflict(dealId, current.state, "QUOTE_RECEIVED");
        const [row] = await q`
          update deals set quote = ${json(quote)}, quote_hash = ${quoteHash}, quote_checks = ${json(checks)},
                           state = 'QUOTE_RECEIVED', version = version + 1, updated_at = now()
          where id = ${dealId}
          returning *`;
        if (!row) throw new DealTransitionConflict(dealId, "missing", "QUOTE_RECEIVED");
        await addDealEvent(q, dealId, "AWAITING_QUOTE", "QUOTE_RECEIVED", event);
        return toDeal(row);
      });
    },

    async declineDeal(dealId, decision, event) {
      return sql.begin(async (tx) => {
        const q = tx as unknown as postgres.Sql;
        const [row] = await q`
          update deals set decision = ${json(decision)}, state = 'DECLINED', version = version + 1, updated_at = now()
          where id = ${dealId} and state = 'QUOTE_RECEIVED'
          returning *`;
        if (!row) {
          const [current] = await q`select state from deals where id = ${dealId}`;
          throw new DealTransitionConflict(dealId, current?.state ?? "missing", "DECLINED");
        }
        await addDealEvent(q, dealId, "QUOTE_RECEIVED", "DECLINED", event);
        return toDeal(row);
      });
    },

    async acceptDeal(dealId, decision, newJob, event) {
      return sql.begin(async (tx) => {
        const q = tx as unknown as postgres.Sql;
        const [current] = await q`select * from deals where id = ${dealId} for update`;
        if (current?.state === "ACCEPTED" && current.job_id) {
          const [job] = await q`select * from jobs where id = ${current.job_id}`;
          if (!job) throw new Error(`deal ${dealId} points at a missing job`);
          return { deal: toDeal(current), job: toJob(job) };
        }
        if (!current || current.state !== "QUOTE_RECEIVED") {
          throw new DealTransitionConflict(dealId, current?.state ?? "missing", "ACCEPTED");
        }
        const job = await insertJob(q, newJob);
        const [row] = await q`
          update deals set job_id = ${job.id}, decision = ${json(decision)}, state = 'ACCEPTED',
                           version = version + 1, updated_at = now()
          where id = ${dealId}
          returning *`;
        if (!row) throw new DealTransitionConflict(dealId, "missing", "ACCEPTED");
        await addDealEvent(q, dealId, "QUOTE_RECEIVED", "ACCEPTED", event);
        return { deal: toDeal(row), job };
      });
    },
  };

  const jobsRepo: JobsRepo = {
    async createJob(input) {
      return insertJob(sql, input);
    },

    async getJob(id) {
      const [row] = await sql`select * from jobs where id = ${id}`;
      return row ? toJob(row) : null;
    },

    async getEscrow(jobId) {
      const [row] = await sql`select * from escrows where job_id = ${jobId}`;
      return row ? toEscrow(row) : null;
    },

    // The guard: the allowed-transition map first, then an UPDATE that only matches the expected
    // from-state, with the event in the same database transaction. Zero rows means someone else won.
    async transition(jobId, from, to, event) {
      assertTransition(from, to);
      return sql.begin(async (tx) => {
        const [row] = await tx`
          update jobs set state = ${to}, version = version + 1, updated_at = now()
          where id = ${jobId} and state = ${from}
          returning *`;
        if (!row) throw new TransitionConflict(jobId, from);
        await tx`
          insert into job_events (job_id, from_state, to_state, actor, reason_codes, correlation_id, detail)
          values (${jobId}, ${from}, ${to}, ${event.actor}, ${event.reasonCodes}::text[],
                  ${event.correlationId ?? null}, ${json(event.detail)})`;
        return toJob(row);
      });
    },

    async attachEscrow(row) {
      assertAmount(row.amount);
      const { asset, drops, cents } = amountColumns(row.amount);
      await sql`
        insert into escrows (job_id, network, owner, offer_sequence, destination, asset, amount_drops,
                             amount_testusd_cents, issuer, condition, cancel_after, create_tx_hash, create_ledger_index)
        values (${row.jobId}, 'testnet', ${row.owner}, ${row.offerSequence}, ${row.destination}, ${asset}, ${drops},
                ${cents}, ${row.issuer},
                ${row.condition}, ${row.cancelAfter}, ${row.createTxHash}, ${row.createLedgerIndex})`;
    },

    async recordPendingTx(t) {
      await sql`
        insert into transactions (operation_id, job_id, type, status)
        values (${t.operationId}, ${t.jobId}, ${t.type}, 'pending')
        on conflict (operation_id) do nothing`;
    },

    async completeTx(operationId, r) {
      const rows = await sql`
        update transactions
        set tx_hash = ${r.txHash}, status = ${r.status}, result = ${r.result},
            ledger_index = ${r.ledgerIndex ?? null}, fee_drops = ${r.feeDrops ?? null},
            validated_at = case when ${r.status} = 'validated' then now() else null end
        where operation_id = ${operationId}
        returning id`;
      if (rows.length === 0) throw new Error(`no transaction recorded for operation ${operationId}`);
    },

    async listTransactions(jobId) {
      const rows = await sql`select * from transactions where job_id = ${jobId} order by id`;
      return rows.map(toTx);
    },

    async listDueForCancel(ledgerCloseTime) {
      const rows = await sql`
        select j.*, e.job_id, e.owner, e.offer_sequence, e.destination, e.asset as escrow_asset,
               e.amount_drops as escrow_amount_drops, e.amount_testusd_cents as escrow_amount_testusd_cents,
               e.issuer as escrow_issuer, e.condition, e.cancel_after, e.create_tx_hash, e.create_ledger_index
        from jobs j join escrows e on e.job_id = j.id
        where j.state = any(${[...CANCELLABLE_STATES]}::text[]) and e.cancel_after < ${ledgerCloseTime}
        order by e.cancel_after, j.id`;
      return rows.map((r) => ({ job: toJob(r), escrow: toEscrow(r, "escrow_") }));
    },

    async listFundingToResume(minPendingAgeSeconds) {
      const rows = await sql`
        select j.* from jobs j
        where j.state = 'CREATE_PENDING'
          and (exists (select 1 from escrows e where e.job_id = j.id)
               or exists (select 1 from transactions t
                          where t.job_id = j.id and t.type = 'create' and t.status = 'pending'
                            and t.submitted_at <= now() - make_interval(secs => ${minPendingAgeSeconds})))
        order by j.created_at, j.id`;
      return rows.map(toJob);
    },

    async listEvents(jobId) {
      const rows = await sql`select * from job_events where job_id = ${jobId} order by id`;
      return rows.map(toEvent);
    },

    async listJobsInStates(states) {
      if (states.length === 0) return [];
      const rows = await sql`
        select * from jobs where state = any(${[...states]}::text[]) order by created_at, id`;
      return rows.map(toJob);
    },

    // First writer wins: the update only matches a job with no deliverable yet.
    async saveDeliverable(jobId, raw, hash) {
      assertHash(hash);
      const saved = await sql`
        update jobs set deliverable = ${json(raw)}, deliverable_hash = ${hash}, delivered_at = now(), updated_at = now()
        where id = ${jobId} and deliverable_hash is null
        returning id`;
      if (saved.length > 0) return "saved";
      const [row] = await sql`select deliverable_hash from jobs where id = ${jobId}`;
      if (!row) throw new Error(`job ${jobId} not found`);
      if (row.deliverable_hash === hash) return "duplicate";
      throw new DeliverableConflict(jobId, row.deliverable_hash, hash);
    },

    async recordDecision(d) {
      assertHash(d.deliverableHash);
      try {
        return await insertDecision(d);
      } catch (e) {
        const err = e as { code?: string; constraint_name?: string };
        if (err.code === UNIQUE_VIOLATION && err.constraint_name === "decisions_job_id_deliverable_hash_key") {
          throw new DecisionConflict(d.jobId, d.deliverableHash);
        }
        throw e;
      }
    },

    async noteEvaluationResume(jobId) {
      const [row] = await sql`
        update jobs set evaluation_resumes = evaluation_resumes + 1, updated_at = now()
        where id = ${jobId}
        returning evaluation_resumes`;
      if (!row) throw new Error(`job ${jobId} not found`);
      return row.evaluation_resumes as number;
    },

    async latestDecision(jobId) {
      const [row] = await sql`
        select * from decisions where job_id = ${jobId} order by decided_at desc, id desc limit 1`;
      return row ? toDecision(row) : null;
    },

    async recordAuthorization(a) {
      try {
        const [row] = await sql`
          insert into authorizations (decision_id, job_id, attempt, operation_id, binding_hash, signed, expires_at)
          values (${a.decisionId}, ${a.jobId}, ${a.attempt}, ${a.operationId}, ${a.bindingHash}, ${json(a.signed)},
                  ${a.expiresAt})
          returning *`;
        if (!row) throw new Error("insert into authorizations returned no row");
        return toAuthorization(row);
      } catch (e) {
        if ((e as { code?: string }).code === UNIQUE_VIOLATION) throw new AuthorizationConflict(a.decisionId, a.attempt);
        throw e;
      }
    },

    async openAuthorization(decisionId) {
      const [row] = await sql`
        select * from authorizations where decision_id = ${decisionId} and consumed_at is null
        order by attempt desc limit 1`;
      return row ? toAuthorization(row) : null;
    },

    async consumeAuthorization(id) {
      await sql`update authorizations set consumed_at = now() where id = ${id} and consumed_at is null`;
    },

    async close() {
      await sql.end();
    },
  };

  return { ...jobsRepo, ...dealsRepo, ...createPgSourcingRepo(sql), ...createPgInspectionRepo(sql) };

  async function insertDecision(d: NewDecision): Promise<Decision> {
    const [row] = await sql`
      insert into decisions (job_id, request_id, mode, outcome, satisfaction, injection_risk, provider, model,
                             latency_ms, cost_usd, reason_codes, rules, policy_version, deliverable_hash, samples)
      values (${d.jobId}, ${d.requestId}, ${d.mode}, ${d.outcome}, ${d.satisfaction}, ${d.injectionRisk},
              ${d.provider}, ${d.model}, ${d.latencyMs}, ${d.costUsd}, ${d.reasonCodes}::text[], ${json(d.rules)},
              ${d.policyVersion}, ${d.deliverableHash}, ${d.samples === null ? null : json(d.samples)})
      returning *`;
    if (!row) throw new Error("insert into decisions returned no row");
    return toDecision(row);
  }
}

function amountColumns(a: AssetAmount): { asset: string; drops: string | null; cents: string | null } {
  return a.asset === "XRP"
    ? { asset: "XRP", drops: a.drops, cents: null }
    : { asset: "TESTUSD", drops: null, cents: a.cents };
}
