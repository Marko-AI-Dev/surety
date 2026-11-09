// XRP amounts are integer drop strings. Never floats.
const DROPS_PATTERN = /^[1-9][0-9]*$/;

// Total XRP supply is 100 billion XRP = 1e17 drops.
export const MAX_DROPS = 100_000_000_000_000_000n;

export function isDrops(value: string): boolean {
  return typeof value === "string" && DROPS_PATTERN.test(value) && BigInt(value) <= MAX_DROPS;
}

// TESTUSD, our self-issued test dollar, is counted in integer cents: $48,000 is "4800000".
export const MAX_TESTUSD_CENTS = 100_000_000_000n;

export function isCents(value: string): boolean {
  return typeof value === "string" && DROPS_PATTERN.test(value) && BigInt(value) <= MAX_TESTUSD_CENTS;
}

export type AssetAmount = { asset: "XRP"; drops: string } | { asset: "TESTUSD"; cents: string };
export type WireAmount = { amountDrops: string } | { amountTestUsdCents: string };

// Exactly one wire field, never an undefined-valued key (canonicalJson refuses undefined).
export function wireAmount(a: AssetAmount): WireAmount {
  return a.asset === "XRP" ? { amountDrops: a.drops } : { amountTestUsdCents: a.cents };
}

export function hasExactlyOneAmount(w: { amountDrops?: string; amountTestUsdCents?: string }): boolean {
  return (w.amountDrops === undefined) !== (w.amountTestUsdCents === undefined);
}

export function assetAmountOf(w: { amountDrops?: string; amountTestUsdCents?: string }): AssetAmount {
  if (!hasExactlyOneAmount(w)) throw new RangeError("exactly one of amountDrops or amountTestUsdCents is required");
  if (w.amountDrops !== undefined) {
    if (!isDrops(w.amountDrops)) throw new RangeError("amountDrops must be a positive integer drop string");
    return { asset: "XRP", drops: w.amountDrops };
  }
  const cents = w.amountTestUsdCents as string;
  if (!isCents(cents)) throw new RangeError("amountTestUsdCents must be a positive integer cent string");
  return { asset: "TESTUSD", cents };
}
