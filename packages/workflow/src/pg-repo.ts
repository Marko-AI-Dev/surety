import postgres, { type Row } from "postgres";
import type { Operation } from "./operation-id";
import {
  type EscrowRow,
  type Job,
  type JobEvent,
  type JobsRepo,
  TransitionConflict,
  type TxRecord,
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
    amountDrops: r.amount_drops,
    sourceText: r.source_text,
    criteria: r.criteria,
    snapshotHash: r.snapshot_hash,
    policyVersion: r.policy_version,
    cancelAfterSeconds: r.cancel_after_seconds,
    state: r.state as JobState,
    version: r.version,
  };
}

function toEscrow(r: Row, amountColumn = "amount_drops"): EscrowRow {
  return {
    jobId: r.job_id,
    owner: r.owner,
    offerSequence: r.offer_sequence,
    destination: r.destination,
    amountDrops: r[amountColumn],
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

// The backend connects as postgres (RLS has no policies yet, so only this role can use the tables).
export function createPgRepo(databaseUrl: string): JobsRepo {
  const sql = postgres(databaseUrl, { onnotice: () => {} });
  const json = (value: unknown) => (value === undefined ? null : sql.json(value as Json));

  return {
    async createJob(input) {
      const [row] = await sql`
        insert into jobs (ref, buyer_address, seller_address, amount_drops, source_text, criteria,
                          snapshot_hash, policy_version, cancel_after_seconds)
        values (${input.ref}, ${input.buyerAddress}, ${input.sellerAddress}, ${input.amountDrops},
                ${input.sourceText}, ${json(input.criteria)}, ${snapshotHash(input)}, ${input.policyVersion},
                ${input.cancelAfterSeconds})
        returning *`;
      if (!row) throw new Error("insert into jobs returned no row");
      return toJob(row);
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
      await sql`
        insert into escrows (job_id, network, owner, offer_sequence, destination, amount_drops, condition,
                             cancel_after, create_tx_hash, create_ledger_index)
        values (${row.jobId}, 'testnet', ${row.owner}, ${row.offerSequence}, ${row.destination}, ${row.amountDrops},
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
        select j.*, e.job_id, e.owner, e.offer_sequence, e.destination, e.amount_drops as escrow_amount_drops,
               e.condition, e.cancel_after, e.create_tx_hash, e.create_ledger_index
        from jobs j join escrows e on e.job_id = j.id
        where j.state = any(${[...CANCELLABLE_STATES]}::text[]) and e.cancel_after < ${ledgerCloseTime}
        order by e.cancel_after, j.id`;
      return rows.map((r) => ({ job: toJob(r), escrow: toEscrow(r, "escrow_amount_drops") }));
    },

    async listEvents(jobId) {
      const rows = await sql`select * from job_events where job_id = ${jobId} order by id`;
      return rows.map(toEvent);
    },

    async close() {
      await sql.end();
    },
  };
}
