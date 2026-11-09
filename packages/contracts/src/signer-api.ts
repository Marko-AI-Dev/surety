import { z } from "zod";
import { SignedAuthorizationSchema } from "./authorization";
import { hasExactlyOneAmount } from "./money";
import { Address, Cents, Drops, EXACTLY_ONE_AMOUNT, OfferSequence } from "./schemas";

// The signer's entire public surface. There is no endpoint that accepts raw transactions.

export const CreateEscrowRequestSchema = z
  .object({
    opId: z.uuid(),
    jobRef: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/),
    destination: Address,
    // Exactly one amount field: drops for XRP, cents for TESTUSD.
    amountDrops: Drops.optional(),
    amountTestUsdCents: Cents.optional(),
    cancelAfterSeconds: z.number().int(),
  })
  .strict()
  .refine(hasExactlyOneAmount, EXACTLY_ONE_AMOUNT);
export type CreateEscrowRequest = z.infer<typeof CreateEscrowRequestSchema>;

export const FinishEscrowRequestSchema = z
  .object({
    opId: z.uuid(),
    authorization: SignedAuthorizationSchema,
  })
  .strict();
export type FinishEscrowRequest = z.infer<typeof FinishEscrowRequestSchema>;

export const CancelEscrowRequestSchema = z
  .object({
    opId: z.uuid(),
    owner: Address,
    offerSequence: OfferSequence,
  })
  .strict();
export type CancelEscrowRequest = z.infer<typeof CancelEscrowRequestSchema>;

export interface CreateEscrowResponse {
  opId: string;
  txHash: string;
  owner: string;
  offerSequence: number;
  condition: string;
  cancelAfter: number;
  ledgerIndex: number;
  result: string;
  // Present only for TESTUSD locks.
  issuer?: string;
}

export interface SettleResponse {
  opId: string;
  txHash: string;
  ledgerIndex: number;
  result: string;
  feeDrops: string;
}

export interface HealthResponse {
  network: "testnet";
  buyer: string;
  service: string;
  // Present only when the signer is configured for TESTUSD. Never holds a secret.
  testUsd?: {
    issuer: string;
    currencyHex: string;
    approvedSuppliers: string[];
    limits: { perDealCents: string; dailyCents: string; openDeals: number };
  };
}

export interface ErrorBody {
  error: string;
  message: string;
}
