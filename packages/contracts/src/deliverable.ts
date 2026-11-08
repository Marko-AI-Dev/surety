import { z } from "zod";
import { canonicalJson, sha256Hex } from "./canonical";

// The seller's answer for the demo job: an invoice extraction. Money is integer minor units (cents),
// never floats. Unknown keys are rejected. summary is the one free-text field code cannot verify;
// Jev judges it.
export const DELIVERABLE_MAX_BYTES = 8192;

const LineItemSchema = z
  .object({
    description: z.string().min(1).max(120),
    quantity: z.number().int().min(1).max(10_000),
    unit_minor: z.number().int().min(0),
    amount_minor: z.number().int().min(0),
  })
  .strict();

export const InvoiceDeliverableSchema = z
  .object({
    invoice_id: z.string().min(1).max(64),
    vendor: z.string().min(1).max(120),
    currency: z.string().regex(/^[A-Z]{3}$/),
    total_minor: z.number().int().min(0),
    line_items: z.array(LineItemSchema).min(1).max(50),
    summary: z.string().max(280),
  })
  .strict();

export type InvoiceDeliverable = z.infer<typeof InvoiceDeliverableSchema>;

// Identity of a delivered answer, whatever its shape: the verdict and any authorization bind to it.
export function deliverableHash(raw: unknown): string {
  return sha256Hex(canonicalJson(raw));
}
