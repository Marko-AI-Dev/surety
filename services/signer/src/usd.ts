// "$100,000" or "$12,500.50" from integer cents, for refusal messages and the boot line.
export function formatUsd(cents: bigint): string {
  const whole = (cents / 100n).toLocaleString("en-US");
  const frac = cents % 100n;
  return frac === 0n ? `$${whole}` : `$${whole}.${frac.toString().padStart(2, "0")}`;
}
