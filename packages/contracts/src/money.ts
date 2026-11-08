// XRP amounts are integer drop strings. Never floats.
const DROPS_PATTERN = /^[1-9][0-9]*$/;

// Total XRP supply is 100 billion XRP = 1e17 drops.
export const MAX_DROPS = 100_000_000_000_000_000n;

export function isDrops(value: string): boolean {
  return typeof value === "string" && DROPS_PATTERN.test(value) && BigInt(value) <= MAX_DROPS;
}
