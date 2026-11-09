import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "./canonical";
import { hasExactlyOneAmount } from "./money";
import { Address, Cents, Drops, EXACTLY_ONE_AMOUNT, Hash256, OfferSequence } from "./schemas";

// A short-lived, one-use permission from the gate to the signer to finish one exact escrow.
export const MAX_AUTHORIZATION_LIFETIME_MS = 120_000;

export const AuthorizationPayloadSchema = z
  .object({
    network: z.literal("testnet"),
    owner: Address,
    offerSequence: OfferSequence,
    // Exactly one amount field: drops for XRP, cents for TESTUSD.
    amountDrops: Drops.optional(),
    amountTestUsdCents: Cents.optional(),
    destination: Address,
    jobSnapshotHash: Hash256,
    deliverableHash: Hash256,
    policyVersion: z.string().min(1).max(32),
    decisionId: z.string().min(1).max(64),
    expiresAt: z.iso.datetime(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict()
  .refine(hasExactlyOneAmount, EXACTLY_ONE_AMOUNT);

export type AuthorizationPayload = z.infer<typeof AuthorizationPayloadSchema>;

export const SignedAuthorizationSchema = z
  .object({
    payload: AuthorizationPayloadSchema,
    sig: z.string().regex(/^[0-9a-f]+$/),
  })
  .strict();

export type SignedAuthorization = z.infer<typeof SignedAuthorizationSchema>;

export type VerifyResult =
  | { ok: true; payload: AuthorizationPayload; bindingHash: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "too_long_lived" };

export function bindingHash(payload: AuthorizationPayload): string {
  return sha256Hex(canonicalJson(payload));
}

function mac(payload: AuthorizationPayload, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(payload)).digest("hex");
}

export function signAuthorization(payload: AuthorizationPayload, secret: string): SignedAuthorization {
  return { payload, sig: mac(payload, secret) };
}

export function verifyAuthorization(candidate: unknown, secret: string, now: Date): VerifyResult {
  const parsed = SignedAuthorizationSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const { payload, sig } = parsed.data;

  const expected = Buffer.from(mac(payload, secret), "hex");
  const given = Buffer.from(sig, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  const expiresAt = Date.parse(payload.expiresAt);
  if (expiresAt <= now.getTime()) return { ok: false, reason: "expired" };
  if (expiresAt > now.getTime() + MAX_AUTHORIZATION_LIFETIME_MS) {
    return { ok: false, reason: "too_long_lived" };
  }
  return { ok: true, payload, bindingHash: bindingHash(payload) };
}
