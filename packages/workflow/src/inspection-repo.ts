import type { AttestationOutcome } from "@surety/contracts";
import type { JobState } from "./states";

// The inspector's attestations: one per deal, append-only. A person reads the bill of lading number off
// the shipment and attests it or refuses; Surety Verify compares it with the supplier's documents.

// While the job is in one of these states an attestation can still be recorded. Once the engine has
// started judging (EVALUATING) or the deal has ended, the attestation is closed.
export const INSPECTABLE_JOB_STATES = ["LOCKED", "IN_PROGRESS", "DELIVERED"] as const satisfies readonly JobState[];

export interface Attestation {
  id: string;
  dealId: string;
  jobId: string;
  inspector: string;
  blNumber: string;
  outcome: AttestationOutcome;
  note: string;
  createdAt: string;
}

export type NewAttestation = Omit<Attestation, "id" | "createdAt">;

export class AttestationConflict extends Error {
  constructor(readonly jobId: string) {
    super(`job ${jobId} already has a different attestation`);
    this.name = "AttestationConflict";
  }
}

export class InspectionClosed extends Error {
  constructor(readonly jobId: string) {
    super(`job ${jobId} can no longer take an attestation`);
    this.name = "InspectionClosed";
  }
}

export interface InspectionRepo {
  // Inserts only while the deal owns the job and the job is LOCKED, IN_PROGRESS or DELIVERED, in one
  // atomic step; otherwise InspectionClosed. The same blNumber, outcome and note again return the stored
  // row; anything different throws AttestationConflict. There are no corrections.
  addAttestation(a: NewAttestation): Promise<Attestation>;
  getAttestation(jobId: string): Promise<Attestation | null>;
}

export function sameAttestation(a: Pick<Attestation, "blNumber" | "outcome" | "note">, b: Pick<Attestation, "blNumber" | "outcome" | "note">): boolean {
  return a.blNumber === b.blNumber && a.outcome === b.outcome && a.note === b.note;
}
