import type postgres from "postgres";
import type { Row } from "postgres";
import type { AttestationOutcome } from "@surety/contracts";
import {
  type Attestation,
  AttestationConflict,
  INSPECTABLE_JOB_STATES,
  InspectionClosed,
  type InspectionRepo,
  sameAttestation,
} from "./inspection-repo";

function toAttestation(r: Row): Attestation {
  return {
    id: r.id,
    dealId: r.deal_id,
    jobId: r.job_id,
    inspector: r.inspector,
    blNumber: r.bl_number,
    outcome: r.outcome as AttestationOutcome,
    note: r.note,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

export function createPgInspectionRepo(sql: postgres.Sql): InspectionRepo {
  const states = [...INSPECTABLE_JOB_STATES];
  return {
    // One statement: the insert happens only if the deal owns the job and the job is still inspectable.
    // A unique deal_id and job_id make a concurrent second attestation insert nothing.
    async addAttestation(a) {
      const [inserted] = await sql`
        insert into inspections (deal_id, job_id, inspector, bl_number, outcome, note)
        select ${a.dealId}, ${a.jobId}, ${a.inspector}, ${a.blNumber}, ${a.outcome}, ${a.note}
        where exists (
          select 1 from deals d join jobs j on j.id = d.job_id
          where d.id = ${a.dealId} and j.id = ${a.jobId} and j.state in ${sql(states)})
        on conflict do nothing
        returning *`;
      if (inserted) return toAttestation(inserted);
      const [existing] = await sql`select * from inspections where job_id = ${a.jobId} or deal_id = ${a.dealId} limit 1`;
      if (!existing) throw new InspectionClosed(a.jobId);
      const row = toAttestation(existing);
      if (row.jobId === a.jobId && row.dealId === a.dealId && sameAttestation(row, a)) return row;
      throw new AttestationConflict(a.jobId);
    },

    async getAttestation(jobId) {
      const [row] = await sql`select * from inspections where job_id = ${jobId}`;
      return row ? toAttestation(row) : null;
    },
  };
}
