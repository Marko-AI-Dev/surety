// Money is integer cents everywhere. TESTUSD has no value: every amount is shown as a test dollar.

export function usd(cents: number, opts: { decimals?: boolean } = {}): string {
  const neg = cents < 0;
  const c = Math.abs(Math.round(cents));
  const whole = Math.floor(c / 100).toLocaleString("en-US");
  const frac = String(c % 100).padStart(2, "0");
  const body = opts.decimals === false && c % 100 === 0 ? `$${whole}` : `$${whole}.${frac}`;
  return neg ? `-${body}` : body;
}

export const shortAddress = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const shortHash = (h: string) => `${h.slice(0, 8)}…`;

// "18:51:24" in UTC, the clock the evidence was recorded on.
export function utcTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

export const score = (v: number | null | undefined) => (typeof v === "number" ? v.toFixed(2) : "not asked");

// "wallet" from "rule:wallet"; other reason codes are shown as they were recorded.
export const ruleOf = (reasonCodes: string[] | undefined) => reasonCodes?.find((c) => c.startsWith("rule:"))?.slice(5) ?? null;
