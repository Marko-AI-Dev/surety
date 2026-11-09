import { z } from "zod";
import { MAX_TESTUSD_CENTS } from "./money";
import { Address } from "./schemas";

// Field schemas shared by deals and sourcing. Money is integer cents (US dollars, settled on the
// ledger as TESTUSD), never floats.
const MAX_CENTS = Number(MAX_TESTUSD_CENTS);
export const centsSchema = z.number().int().min(0).max(MAX_CENTS);
export const nameSchema = z.string().min(1).max(120);
export const portSchema = z.string().min(1).max(64);
export const quantitySchema = z.number().int().min(1).max(1_000_000);
export const partySchema = z.object({ name: nameSchema, address: Address }).strict();
