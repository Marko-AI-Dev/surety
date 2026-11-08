import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for fulfillments at rest. The key lives only in the signer's environment.
export interface Sealed {
  iv: string;
  ct: string;
  tag: string;
}

export function seal(key: Buffer, plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), ct: ct.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}

export function open(key: Buffer, sealed: Sealed): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "hex"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "hex")), decipher.final()]).toString("utf8");
}
