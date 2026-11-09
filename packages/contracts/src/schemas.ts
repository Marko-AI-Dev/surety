import { z } from "zod";
import { isCents, isDrops } from "./money";

// Classic XRPL address shape. The signer additionally validates with xrpl.js.
export const Address = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, "invalid XRPL address");
export const Drops = z.string().refine(isDrops, "amount must be a positive integer drop string");
export const Cents = z.string().refine(isCents, "amount must be a positive integer cent string");
export const Hash256 = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters");
export const OfferSequence = z.number().int().min(1);

export const EXACTLY_ONE_AMOUNT = "exactly one of amountDrops or amountTestUsdCents is required";
