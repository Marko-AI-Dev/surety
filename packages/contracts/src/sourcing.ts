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
// What the buyer cares about most when the lead picks a committed quote (Phase 4d).
export const PRIORITIES = ["price", "speed", "balanced"] as const;
export type Priority = (typeof PRIORITIES)[number];

// How hard the buyer wants the negotiator to push. Absent in older briefs, which read back as firm.
export const PUSH_LEVELS = ["gentle", "firm"] as const;
export type Push = (typeof PUSH_LEVELS)[number];

// Who sends the negotiator's messages: the negotiator on its own, or only after the buyer has read,
// edited and approved each one. Absent in older briefs, which read back as full.
export const AUTONOMY_LEVELS = ["full", "approve"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

// The longest a buyer may give a negotiation: thirty days.
export const NEGOTIATION_MAX_SECONDS = 30 * 86_400;

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
    // The buyer's decide-by time: the latest the negotiation may run. It is a backstop, not the
    // protocol: the negotiation ends earlier when a committed quote meets the brief or the buyer asks.
    // Server clock: it moves no money.
    negotiationSeconds: z.number().int().min(30).max(NEGOTIATION_MAX_SECONDS),
    // Absent in 4c briefs, which read back as balanced.
    priority: z.enum(PRIORITIES).default("balanced"),
    // The latest delivery the buyer accepts, in days from acceptance. Optional.
    latestDeliveryDays: z.number().int().min(1).max(365).optional(),
    push: z.enum(PUSH_LEVELS).optional(),
    autonomy: z.enum(AUTONOMY_LEVELS).optional(),
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

// The buyer's final word on the deal the lead recommends. Only an approve can lock a payment.
export const BuyerDecisionSchema = z.object({ outcome: z.enum(["approve", "decline"]), reason: z.string().trim().max(500).optional() }).strict();
export type BuyerDecision = z.infer<typeof BuyerDecisionSchema>;

// A note from the buyer to its own negotiator while the negotiation runs.
export const BUYER_NOTE_MAX_CHARS = 500;
export const BuyerNoteSchema = z.object({ text: z.string().trim().min(1).max(BUYER_NOTE_MAX_CHARS) }).strict();

export type Card = "yellow" | "red";

// What the buyer may change while a negotiation runs. At least one of the two.
export const BuyerControlsSchema = z
  .object({ autonomy: z.enum(AUTONOMY_LEVELS).optional(), push: z.enum(PUSH_LEVELS).optional() })
  .strict()
  .refine((c) => c.autonomy !== undefined || c.push !== undefined, { message: "nothing to change" });

// The buyer's answer to a message the negotiator drafted: send it (as written, or with the buyer's
// own wording) or throw it away.
export const DraftDecisionSchema = z.object({ action: z.enum(["send", "discard"]), text: ChatTextSchema.optional() }).strict();
export type DraftDecision = z.infer<typeof DraftDecisionSchema>;

// A message the buyer writes to a supplier themself.
export const BuyerMessageSchema = z.object({ supplier: Address, text: ChatTextSchema }).strict();

// What the buyer says to its own agent in the chat.
export const BUYER_CHAT_MAX_CHARS = 500;
export const BuyerChatSchema = z.object({ text: z.string().trim().min(1).max(BUYER_CHAT_MAX_CHARS) }).strict();
