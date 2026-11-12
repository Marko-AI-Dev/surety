// A small QR code encoder, so the supplier seat link can be scanned from a phone without adding a
// dependency or calling an outside service. Byte mode, error correction level M, versions 1 to 9
// (up to 180 bytes, far more than a seat link needs). Pure: text in, a square of dark modules out.

// Level M per version: error correction codewords per block, then [blocks, data codewords per block].
const BLOCKS_M: { ec: number; groups: [number, number][] }[] = [
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  { ec: 22, groups: [[2, 38], [2, 39]] },
  { ec: 22, groups: [[3, 36], [2, 37]] },
];
const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];

export const QR_MAX_BYTES = 180;

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number;
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : (EXP[(LOG[a] as number) + (LOG[b] as number)] as number));

// The error correction codewords for one block of data codewords.
export function reedSolomon(data: number[], count: number): number[] {
  let gen = [1];
  for (let i = 0; i < count; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((g, j) => {
      next[j] = (next[j] as number) ^ g;
      next[j + 1] = (next[j + 1] as number) ^ mul(g, EXP[i] as number);
    });
    gen = next;
  }
  const divisor = gen.slice(1);
  const rem = new Array<number>(count).fill(0);
  for (const d of data) {
    const factor = d ^ (rem.shift() as number);
    rem.push(0);
    divisor.forEach((g, i) => {
      rem[i] = (rem[i] as number) ^ mul(g, factor);
    });
  }
  return rem;
}

const dataCapacity = (version: number) => (BLOCKS_M[version - 1] as (typeof BLOCKS_M)[number]).groups.reduce((n, [blocks, size]) => n + blocks * size, 0);

// The smallest version whose data codewords hold the mode, the length and the bytes.
export function versionFor(byteLength: number): number {
  for (let v = 1; v <= BLOCKS_M.length; v++) if (byteLength + 2 <= dataCapacity(v)) return v;
  throw new RangeError(`the text is ${byteLength} bytes; this QR encoder holds at most ${QR_MAX_BYTES}`);
}

// Mode, length, bytes, terminator and padding, as data codewords.
export function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = dataCapacity(version);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

// Split into blocks, add error correction to each, and interleave: the final codeword sequence.
export function interleave(data: number[], version: number): number[] {
  const spec = BLOCKS_M[version - 1] as (typeof BLOCKS_M)[number];
  const blocks: { data: number[]; ec: number[] }[] = [];
  let at = 0;
  for (const [count, size] of spec.groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(at, at + size);
      at += size;
      blocks.push({ data: block, ec: reedSolomon(block, spec.ec) });
    }
  }
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i] as number);
  for (let i = 0; i < spec.ec; i++) for (const b of blocks) out.push(b.ec[i] as number);
  return out;
}

const MASKS: ((y: number, x: number) => boolean)[] = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (_y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

// The 15 format bits for level M and a mask: BCH(15,5), then the fixed XOR.
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

type Grid = boolean[][];
const grid = (size: number): Grid => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

// The fixed patterns of a version, and which modules they occupy.
function functionPatterns(version: number): { modules: Grid; reserved: Grid } {
  const size = 17 + 4 * version;
  const modules = grid(size);
  const reserved = grid(size);
  const set = (y: number, x: number, dark: boolean) => {
    if (y < 0 || x < 0 || y >= size || x >= size) return;
    (modules[y] as boolean[])[x] = dark;
    (reserved[y] as boolean[])[x] = true;
  };

  for (const [cy, cx] of [
    [3, 3],
    [3, size - 4],
    [size - 4, 3],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dy), Math.abs(dx));
        set(cy + dy, cx + dx, d !== 2 && d !== 4);
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const centres = ALIGNMENT[version - 1] as number[];
  const last = centres.length - 1;
  centres.forEach((cy, a) => {
    centres.forEach((cx, b) => {
      if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cy + dy, cx + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1);
    });
  });
  // Format areas are reserved now and written per mask; the dark module is fixed.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      set(8, i, false);
      set(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false);
    set(size - 1 - i, 8, false);
  }
  set(size - 8, 8, true);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(b, a, dark);
      set(a, b, dark);
    }
  }
  return { modules, reserved };
}

function writeFormat(modules: Grid, mask: number): void {
  const size = modules.length;
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const set = (y: number, x: number, dark: boolean) => {
    (modules[y] as boolean[])[x] = dark;
  };
  for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
  set(7, 8, bit(6));
  set(8, 8, bit(7));
  set(8, 7, bit(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i));
  set(size - 8, 8, true);
}

// The standard's four penalty rules; the mask with the lowest score scans best.
function penalty(m: Grid): number {
  const size = m.length;
  const at = (y: number, x: number) => (m[y] as boolean[])[x] as boolean;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    lines.push(m[i] as boolean[]);
    lines.push(m.map((row) => row[i] as boolean));
  }
  const finder = [true, false, true, true, true, false, true];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((f, k) => line[i + k] === f)) continue;
      const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || line[i - k] === false);
      const lightAfter = [7, 8, 9, 10].every((k) => i + k >= size || line[i + k] === false);
      if (lightBefore || lightAfter) score += 40;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (at(y, x)) dark++;
      if (y + 1 < size && x + 1 < size && at(y, x) === at(y, x + 1) && at(y, x) === at(y + 1, x) && at(y, x) === at(y + 1, x + 1)) score += 3;
    }
  }
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

// The QR code for a text: a square grid, true for a dark module. No quiet zone; the renderer adds it.
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  const codewords = interleave(dataCodewords(bytes, version), version);
  const bits = codewords.flatMap((c) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (c >>> i) & 1));
  const { modules: base, reserved } = functionPatterns(version);
  const size = base.length;

  let best: Grid | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  MASKS.forEach((mask, maskId) => {
    const m = base.map((row) => [...row]);
    let i = 0;
    let up = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) {
        const y = up ? size - 1 - v : v;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if ((reserved[y] as boolean[])[x]) continue;
          const dark = i < bits.length && bits[i] === 1;
          i++;
          (m[y] as boolean[])[x] = dark !== mask(y, x);
        }
      }
      up = !up;
    }
    writeFormat(m, maskId);
    const score = penalty(m);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  });
  return best as unknown as boolean[][];
}

// One SVG path for the dark modules, with the four-module quiet zone the standard asks for.
export function qrPath(matrix: boolean[][], quiet = 4): { d: string; size: number } {
  let d = "";
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      d += `M${x + quiet} ${y + quiet}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  return { d, size: matrix.length + quiet * 2 };
}
