import { createHash } from "node:crypto";

export type Operation = "create" | "finish" | "cancel";

// Deterministic per job and operation, so a restarted process sends the signer the same opId and
// the signer replays its journaled outcome instead of signing again. A name-based (version 5 style)
// UUID: the first 16 bytes of sha256, with the version and RFC 4122 variant bits set.
export function operationId(jobId: string, op: Operation, attempt = 0): string {
  const bytes = createHash("sha256").update(`surety:${jobId}:${op}:${attempt}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
