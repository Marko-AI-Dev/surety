import { randomBytes } from "node:crypto";
import { AuthorizationPayloadSchema, type SignedAuthorization, signAuthorization } from "@surety/contracts";

// The gate's one-use permission for the signer to finish one exact escrow. Short-lived; the signer
// re-checks every bound field against its own records and the validated ledger before signing.
export const AUTHORIZATION_TTL_MS = 60_000;

export interface MintInput {
  owner: string;
  offerSequence: number;
  amountDrops: string;
  destination: string;
  jobSnapshotHash: string;
  deliverableHash: string;
  policyVersion: string;
  decisionId: string;
  gateSecret: string;
  now: Date;
}

export function mintAuthorization(p: MintInput): SignedAuthorization {
  // Parse first: a binding the signer would reject is a gate bug, so it fails loudly here.
  const payload = AuthorizationPayloadSchema.parse({
    network: "testnet",
    owner: p.owner,
    offerSequence: p.offerSequence,
    amountDrops: p.amountDrops,
    destination: p.destination,
    jobSnapshotHash: p.jobSnapshotHash,
    deliverableHash: p.deliverableHash,
    policyVersion: p.policyVersion,
    decisionId: p.decisionId,
    expiresAt: new Date(p.now.getTime() + AUTHORIZATION_TTL_MS).toISOString(),
    nonce: randomBytes(16).toString("hex"),
  });
  return signAuthorization(payload, p.gateSecret);
}
