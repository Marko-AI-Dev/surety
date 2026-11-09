import { z } from "zod";
import { MAX_TESTUSD_CENTS } from "./money";
import { Address } from "./schemas";

// A deal is an import purchase paid through escrow: the buyer's intent, the supplier's quote and,
// after the lock, the supplier's commercial invoice and bill of lading. Money is integer cents
// (US dollars, settled on the ledger as TESTUSD), never floats. Every object rejects unknown keys.

export const INCOTERMS = ["EXW", "FOB", "CFR", "CIF", "DAP", "DDP"] as const;
export type Incoterm = (typeof INCOTERMS)[number];

const MAX_CENTS = Number(MAX_TESTUSD_CENTS);
const cents = z.number().int().min(0).max(MAX_CENTS);
const name = z.string().min(1).max(120);
const port = z.string().min(1).max(64);
const quantity = z.number().int().min(1).max(1_000_000);
const party = z.object({ name, address: Address }).strict();

export const DealIntentSchema = z
  .object({
    poNumber: z.string().regex(/^PO-[A-Z0-9-]{1,28}$/),
    buyer: party,
    supplier: party,
    goods: z.object({ description: name, quantity, maxUnitCents: cents.min(1) }).strict(),
    incoterm: z.enum(INCOTERMS),
    port,
    // The refund deadline: how long the lock waits for matching documents. The ledger allows a
    // refund only after it passes.
    deadlineSeconds: z.number().int().min(60).max(86_400),
  })
  .strict();

export type DealIntent = z.infer<typeof DealIntentSchema>;

export const SupplierQuoteSchema = z
  .object({
    quoteNumber: z.string().regex(/^[A-Z0-9-]{1,32}$/),
    supplierAddress: Address,
    quantity,
    unitCents: cents,
    totalCents: cents,
    currency: z.literal("USD"),
    incoterm: z.enum(INCOTERMS),
    port,
    // Free text the deal agent reads; code never acts on it.
    notes: z.string().max(280),
  })
  .strict();

export type SupplierQuote = z.infer<typeof SupplierQuoteSchema>;

// What the supplier submits after the lock: two documents as text, in the template the parser reads.
export const DOCUMENT_MAX_CHARS = 4096;
export const TradeDocumentsSchema = z
  .object({
    commercialInvoice: z.string().min(1).max(DOCUMENT_MAX_CHARS),
    billOfLading: z.string().min(1).max(DOCUMENT_MAX_CHARS),
  })
  .strict();

export type TradeDocuments = z.infer<typeof TradeDocumentsSchema>;

const text = z.string().min(1).max(120);

// The facts read out of the documents, by the parser and by the document reader.
export const TradeFieldsSchema = z
  .object({
    invoice: z
      .object({
        invoiceNumber: text,
        poNumber: text,
        seller: text,
        buyer: text,
        payTo: Address,
        currency: z.string().regex(/^[A-Z]{3}$/),
        incoterm: text,
        port,
        lines: z
          .array(z.object({ description: text, quantity, unitCents: cents, amountCents: cents }).strict())
          .min(1)
          .max(20),
        totalCents: cents,
      })
      .strict(),
    billOfLading: z
      .object({
        blNumber: text,
        shipper: text,
        consignee: text,
        portOfLoading: port,
        portOfDischarge: port,
        vessel: text,
        goodsDescription: text,
        goodsQuantity: quantity,
      })
      .strict(),
  })
  .strict();

export type TradeFields = z.infer<typeof TradeFieldsSchema>;

// The most the intent allows: quantity times the maximum unit price.
export function budgetCents(intent: DealIntent): bigint {
  return BigInt(intent.goods.quantity) * BigInt(intent.goods.maxUnitCents);
}
