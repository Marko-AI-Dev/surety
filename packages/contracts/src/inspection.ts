import { z } from "zod";

// The inspector's second key (Phase 4d). A person, never an agent, reads the bill of lading number off
// the shipment and attests it (or refuses). Surety Verify releases a sourcing deal only when that
// reading matches the B/L number in the supplier's documents.

export const INSPECTION_STATES = ["pending", "attested", "refused"] as const;
export type InspectionState = (typeof INSPECTION_STATES)[number];

export const ATTESTATION_OUTCOMES = ["attested", "refused"] as const;
export type AttestationOutcome = (typeof ATTESTATION_OUTCOMES)[number];

export const BL_NUMBER_MAX_CHARS = 120;
export const INSPECTION_NOTE_MAX_CHARS = 280;

export const AttestationFormSchema = z
  .object({
    blNumber: z.string().trim().min(1).max(BL_NUMBER_MAX_CHARS),
    outcome: z.enum(ATTESTATION_OUTCOMES),
    note: z.string().max(INSPECTION_NOTE_MAX_CHARS),
  })
  .strict();
export type AttestationForm = z.infer<typeof AttestationFormSchema>;

// Exactly the shape the web app reads (apps/web/src/data/types.ts, Inspection).
export interface Inspection {
  state: InspectionState;
  inspector?: string | null;
  blNumber?: string | null;
  note?: string | null;
  at?: string | null;
}
