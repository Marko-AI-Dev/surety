import { createHash, randomBytes } from "node:crypto";

// PREIMAGE-SHA-256 crypto-condition encoding used by XRPL escrow
// (draft-thomas-crypto-conditions-02, rippled PreimageSha256.h).
// Lengths above 125 bytes would need multi-byte DER lengths, which we never use.
const MAX_PREIMAGE_BYTES = 125;

export interface PreimageCondition {
  condition: string;
  fulfillment: string;
}

export function preimageCondition(preimage: Uint8Array): PreimageCondition {
  const length = preimage.length;
  if (length > MAX_PREIMAGE_BYTES) {
    throw new RangeError(`preimage must be at most ${MAX_PREIMAGE_BYTES} bytes, got ${length}`);
  }
  const p = Buffer.from(preimage);
  const fulfillment = Buffer.concat([Buffer.from([0xa0, length + 2, 0x80, length]), p]);
  const condition = Buffer.concat([
    Buffer.from([0xa0, 0x25, 0x80, 0x20]),
    createHash("sha256").update(p).digest(),
    Buffer.from([0x81, 0x01, length]),
  ]);
  return {
    condition: condition.toString("hex").toUpperCase(),
    fulfillment: fulfillment.toString("hex").toUpperCase(),
  };
}

export function newPreimage(): Buffer {
  return randomBytes(32);
}
