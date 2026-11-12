// Browser stand-in for the two Node pieces the bouncer's code rules use: a synchronous SHA-256
// (createHash) and Buffer. Vite aliases "node:crypto" to this file, so packages/gate/src/chat-rules.ts
// runs in the browser unchanged for the supplier seat's practice mode. Only what those rules touch
// is implemented. The HMAC functions exist so @surety/contracts loads; nothing in the browser may
// call them, and they throw if anything does.

class BrowserBuffer extends Uint8Array {
  static fromHex(hex: string): BrowserBuffer {
    const out = new BrowserBuffer(hex.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  // Buffer.from(string, "hex" | "utf8") and Buffer.from(bytes).
  static override from(value: unknown, encoding?: unknown): BrowserBuffer {
    if (typeof value === "string") {
      if (encoding === "hex") return BrowserBuffer.fromHex(value);
      const bytes = new TextEncoder().encode(value);
      const out = new BrowserBuffer(bytes.length);
      out.set(bytes);
      return out;
    }
    const src = value as ArrayLike<number>;
    const out = new BrowserBuffer(src.length);
    out.set(src);
    return out;
  }
  static byteLength(text: string): number {
    return new TextEncoder().encode(text).length;
  }
  equals(other: Uint8Array): boolean {
    if (other.length !== this.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
    return true;
  }
  override toString(encoding?: string): string {
    if (encoding === "hex") return Array.from(this, (b) => b.toString(16).padStart(2, "0")).join("");
    return new TextDecoder().decode(this);
  }
}

const g = globalThis as { Buffer?: unknown };
if (g.Buffer === undefined) g.Buffer = BrowserBuffer;

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLength = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    let a: number = h[0] as number;
    let b: number = h[1] as number;
    let c: number = h[2] as number;
    let d: number = h[3] as number;
    let e: number = h[4] as number;
    let f: number = h[5] as number;
    let gg: number = h[6] as number;
    let hh: number = h[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1: number = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch: number = (e & f) ^ (~e & gg);
      const t1: number = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0: number = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj: number = (a & b) ^ (a & c) ^ (b & c);
      const t2: number = (S0 + maj) >>> 0;
      hh = gg; gg = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] as number) + a) >>> 0; h[1] = ((h[1] as number) + b) >>> 0; h[2] = ((h[2] as number) + c) >>> 0; h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0; h[5] = ((h[5] as number) + f) >>> 0; h[6] = ((h[6] as number) + gg) >>> 0; h[7] = ((h[7] as number) + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i] as number);
  return out;
}

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`the browser shim only has sha256, not ${algorithm}`);
  const parts: Uint8Array[] = [];
  const api = {
    update(data: string | Uint8Array) {
      parts.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
      return api;
    },
    digest(encoding?: string): BrowserBuffer | string {
      const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        total.set(p, at);
        at += p.length;
      }
      const out = BrowserBuffer.from(sha256(total));
      return encoding === "hex" ? out.toString("hex") : out;
    },
  };
  return api;
}

const notInBrowser = (name: string) => (): never => {
  throw new Error(`${name} is signer and gate code; it does not run in the browser`);
};
export const createHmac = notInBrowser("createHmac");
export const timingSafeEqual = notInBrowser("timingSafeEqual");
export const randomBytes = notInBrowser("randomBytes");
export const randomUUID = () => globalThis.crypto.randomUUID();

export default { createHash, createHmac, timingSafeEqual, randomBytes, randomUUID };
