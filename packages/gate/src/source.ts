// The demo job's source invoice, read line by line into the facts the deliverable must reproduce.
// Strict on purpose: anything ambiguous (a missing or repeated header) is unparseable, so the
// source_values rule fails closed instead of guessing.

export interface SourceLine {
  description: string;
  quantity: number;
  unitMinor: number;
  amountMinor: number;
}

export interface ParsedInvoice {
  invoiceId: string;
  supplier: string;
  currency: string;
  lines: SourceLine[];
  totalMinor: number;
}

const MONEY = String.raw`R(\d+\.\d{2})`;
const LINE = new RegExp(String.raw`^(\d+) x (.+?) @ ${MONEY} = ${MONEY}$`);

// "150.00" -> 15000 by splitting on the dot. No float arithmetic touches money.
function minorUnits(text: string): number | null {
  const [whole, cents] = text.split(".");
  if (whole === undefined || cents === undefined) return null;
  const value = BigInt(whole) * 100n + BigInt(cents);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export function parseInvoiceSource(text: string): ParsedInvoice | null {
  const rows = text.split(/\r?\n/).map((r) => r.trim());
  const single = (pattern: RegExp): string | null => {
    const found = rows.flatMap((r) => {
      const m = pattern.exec(r);
      return m?.[1] === undefined ? [] : [m[1].trim()];
    });
    return found.length === 1 ? (found[0] ?? null) : null;
  };

  const invoiceId = single(/^Invoice number: (.+)$/);
  const supplier = single(/^Supplier: (.+)$/);
  const currency = single(/^Currency: ([A-Z]{3})$/);
  const totalText = single(new RegExp(`^Total due: ${MONEY}$`));
  const totalMinor = totalText === null ? null : minorUnits(totalText);
  if (!invoiceId || !supplier || !currency || totalMinor === null) return null;

  const lines: SourceLine[] = [];
  for (const row of rows) {
    const m = LINE.exec(row);
    if (!m) continue;
    const [, qty, description, unit, amount] = m;
    const quantity = Number(qty);
    const unitMinor = unit === undefined ? null : minorUnits(unit);
    const amountMinor = amount === undefined ? null : minorUnits(amount);
    if (!description || !Number.isSafeInteger(quantity) || unitMinor === null || amountMinor === null) return null;
    lines.push({ description: description.trim(), quantity, unitMinor, amountMinor });
  }
  if (lines.length === 0) return null;
  return { invoiceId, supplier, currency, lines, totalMinor };
}
