// TESTUSD: our self-issued test dollar on XRPL Testnet. Counted in integer cents everywhere in
// Surety; converted to the ledger's decimal value only at the edge. BigInt and strings only, no floats.

// "TESTUSD" in ASCII as a 160-bit currency code. Not "tUSD": TUSD is the ticker of TrueUSD.
export const TESTUSD_CURRENCY_HEX = "5445535455534400000000000000000000000000";

export interface IssuedAmount {
  currency: string;
  issuer: string;
  value: string;
}

export function testUsdAmount(issuer: string, cents: string): IssuedAmount {
  const c = BigInt(cents);
  const whole = c / 100n;
  const frac = (c % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return { currency: TESTUSD_CURRENCY_HEX, issuer, value: frac ? `${whole}.${frac}` : `${whole}` };
}

// Plain positive decimals with at most two fraction digits only. Anything else (exponent notation,
// sub-cent precision, zero, negatives) is null, so callers fail closed.
const VALUE_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;

export function tokenValueToCents(value: string): string | null {
  const m = VALUE_PATTERN.exec(value);
  if (!m) return null;
  const cents = BigInt(m[1] as string) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
  return cents > 0n ? cents.toString() : null;
}
