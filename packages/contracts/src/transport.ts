import { createHmac, timingSafeEqual } from "node:crypto";
import { sha256Hex } from "./canonical";

// Authenticates every call from the app to the signer over localhost.
export const TS_HEADER = "x-surety-ts";
export const SIG_HEADER = "x-surety-sig";
export const MAX_CLOCK_SKEW_MS = 30_000;

export function signRequest(secret: string, ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", secret).update(`${ts}\n${method}\n${path}\n${sha256Hex(body)}`).digest("hex");
}

export function verifyRequest(
  secret: string,
  ts: string | undefined,
  sig: string | undefined,
  method: string,
  path: string,
  body: string,
  nowMs: number,
): boolean {
  if (!ts || !sig || !/^\d+$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(nowMs - Number(ts)) > MAX_CLOCK_SKEW_MS) return false;
  const expected = Buffer.from(signRequest(secret, ts, method, path, body), "hex");
  return timingSafeEqual(Buffer.from(sig, "hex"), expected);
}
