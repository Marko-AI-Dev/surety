import type { SupplierLine } from "@surety/gate";
import { tokenValueToCents } from "@surety/xrpl-settlement";

// A supplier's TESTUSD trust line in cents, for the Policy step when a deal opens. Read-only.
export interface RawTrustLine {
  balance: string;
  limit: string;
  frozenByIssuer: boolean;
}

// The ledger writes a zero balance as "0", which the strict cents parser refuses.
const lineCents = (value: string): bigint | null => {
  if (value === "0") return 0n;
  const cents = tokenValueToCents(value);
  return cents === null ? null : BigInt(cents);
};

export function createSupplierLine(read: (address: string) => Promise<RawTrustLine | null>): (address: string) => Promise<SupplierLine | null> {
  return async (address) => {
    const line = await read(address);
    if (!line) return null;
    const balanceCents = lineCents(line.balance);
    const limitCents = lineCents(line.limit);
    if (balanceCents === null || limitCents === null) return null;
    return { balanceCents, limitCents, frozenByIssuer: line.frozenByIssuer };
  };
}
