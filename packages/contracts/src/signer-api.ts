import { z } from "zod";
import { SignedAuthorizationSchema } from "./authorization";
import { Address, Drops, OfferSequence } from "./schemas";

// The signer's entire public surface. There is no endpoint that accepts raw transactions.

export const CreateEscrowRequestSchema = z
  .object({
    opId: z.uuid(),
    jobRef: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/),
    destination: Address,
    amountDrops: Drops,
    cancelAfterSeconds: z.number().int(),
  })
  .strict();
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
}

export interface ErrorBody {
  error: string;
  message: string;
}
