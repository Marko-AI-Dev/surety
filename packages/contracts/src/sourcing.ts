import { z } from "zod";
import { INCOTERMS } from "./deal";
import { centsSchema, nameSchema, partySchema, portSchema, quantitySchema } from "./deal-fields";
import { Address } from "./schemas";

// Sourcing: the buyer's brief to its agent team, the screened chat with suppliers, the supplier's
// binding quote form, the negotiator's offer reports and the supplier's settlement form. Chat is
// never binding; only the quote form commits a supplier. Every object rejects unknown keys.

const unitPrice = centsSchema.min(1);
const text = z.string().min(1).max(120);

// The maximum stays in Surety's code and the lead's view; the negotiator is only ever given the target.
export const SourcingBriefSchema = z
  .object({
    buyer: partySchema,
    goods: z
      .object({ description: nameSchema, quantity: quantitySchema, targetUnitCents: unitPrice, maxUnitCents: unitPrice })
      .strict()
      .refine((g) => g.targetUnitCents <= g.maxUnitCents, { message: "the target price must not exceed the maximum" }),
    incoterm: z.enum(INCOTERMS),
    port: portSchema,
    // The deal's refund deadline once a quote is accepted, as in DealIntent.
    deadlineSeconds: z.number().int().min(60).max(86_400),
    // How long suppliers and the negotiator may chat. Server clock: it moves no money.
    negotiationSeconds: z.number().int().min(30).max(3_600),
  })
  .strict();

export type SourcingBrief = z.infer<typeof SourcingBriefSchema>;

export const MESSAGE_MAX_CHARS = 1000;
export const ChatTextSchema = z.string().trim().min(1).max(MESSAGE_MAX_CHARS);

// The supplier's binding quote. No wallet (it comes from the invite) and no total (code computes it).
export const QuoteFormSchema = z
  .object({
    quoteNumber: z.string().regex(/^[A-Z0-9-]{1,32}$/),
    quantity: quantitySchema,
    unitCents: unitPrice,
    incoterm: z.enum(INCOTERMS),
    port: portSchema,
    // Days from acceptance to delivery at the port. Kept beside the deal's quote, not inside it.
    deliveryDays: z.number().int().min(1).max(365),
    notes: z.string().max(280),
  })
  .strict();

export type QuoteForm = z.infer<typeof QuoteFormSchema>;

// What the negotiator reports up to the lead: facts, plus a short summary that is screened too.
export const OfferReportSchema = z
  .object({
    supplier: Address,
    unitCents: unitPrice,
    quantity: quantitySchema,
    deliveryDays: z.number().int().min(1).max(365),
    summary: z.string().max(500),
  })
  .strict();

export type OfferReport = z.infer<typeof OfferReportSchema>;

// The supplier's settlement form. Everything else on the invoice and bill of lading comes from the
// deal. `edits` exists for the Attack lab: the rules must catch every one of them.
export const SettlementFormSchema = z
  .object({
    invoiceNumber: text,
    blNumber: text,
    vessel: text,
    portOfLoading: portSchema,
    remarks: z.object({ invoice: z.string().max(280), billOfLading: z.string().max(280) }).strict(),
    edits: z
      .object({
        payTo: Address.optional(),
        invoiceQuantity: quantitySchema.optional(),
        blQuantity: quantitySchema.optional(),
        unitCents: centsSchema.optional(),
        totalCents: centsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SettlementForm = z.infer<typeof SettlementFormSchema>;

export const LeadDecisionSchema = z
  .object({ outcome: z.enum(["accept", "decline"]), reason: z.string().min(1).max(500) })
  .strict();

export type LeadDecision = z.infer<typeof LeadDecisionSchema>;

export type Card = "yellow" | "red";
