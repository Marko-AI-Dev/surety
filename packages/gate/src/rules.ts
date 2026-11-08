import { DELIVERABLE_MAX_BYTES, type InvoiceDeliverable, InvoiceDeliverableSchema } from "@surety/contracts";
import { parseInvoiceSource } from "./source";

// Deterministic acceptance: facts code can check. These run before Jev, and a failure here is final:
// no model can turn it into a pass.
export const RULE_IDS = ["size", "schema", "currency", "line_arithmetic", "total", "source_values"] as const;
export type RuleId = (typeof RULE_IDS)[number];

export interface RuleResult {
  id: RuleId;
  status: "pass" | "fail" | "skipped";
  detail?: string;
}

export interface RulesReport {
  passed: boolean;
  results: RuleResult[];
  parsed?: InvoiceDeliverable;
}

export interface RulesInput {
  sourceText: string;
  allowedCurrencies: string[];
  deliverable: unknown;
}

// Integer formatting of minor units as the invoice prints them: 15000 -> "R150.00".
function rands(minor: number): string {
  const cents = BigInt(minor);
  return `R${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function sizeCheck(deliverable: unknown): string | undefined {
  let text: string | undefined;
  try {
    text = JSON.stringify(deliverable);
  } catch {
    return "deliverable is not serializable as JSON";
  }
  if (text === undefined) return "deliverable is not serializable as JSON";
  const bytes = Buffer.byteLength(text, "utf8");
  // Rejected, never truncated: a cut-off attack is still an attack.
  return bytes > DELIVERABLE_MAX_BYTES ? `${bytes} bytes exceeds the ${DELIVERABLE_MAX_BYTES}-byte limit` : undefined;
}

function lineArithmetic(d: InvoiceDeliverable): string | undefined {
  const wrong = d.line_items.flatMap((l, i) =>
    BigInt(l.quantity) * BigInt(l.unit_minor) === BigInt(l.amount_minor)
      ? []
      : [`line ${i + 1}: ${l.quantity} x ${l.unit_minor} != ${l.amount_minor}`],
  );
  return wrong.length > 0 ? wrong.join("; ") : undefined;
}

function totalCheck(d: InvoiceDeliverable): string | undefined {
  const sum = d.line_items.reduce((acc, l) => acc + BigInt(l.amount_minor), 0n);
  return sum === BigInt(d.total_minor) ? undefined : `line amounts sum to ${sum}, total_minor is ${d.total_minor}`;
}

const norm = (s: string) => s.trim().toLowerCase();

// Field by field against the parsed source: each value must sit in its own place, not merely occur
// somewhere in the text. Line items match as a multiset: every deliverable line uses exactly one
// source line (description, quantity, unit and amount all equal), and every source line is used once.
function sourceValues(d: InvoiceDeliverable, sourceText: string): string | undefined {
  const source = parseInvoiceSource(sourceText);
  if (!source) return "source_unparseable";
  const wrong: string[] = [];
  const text = (field: string, given: string, expected: string) => {
    if (norm(given) !== norm(expected)) wrong.push(`${field} "${given}" is not the source's "${expected}"`);
  };
  text("invoice_id", d.invoice_id, source.invoiceId);
  text("vendor", d.vendor, source.supplier);
  text("currency", d.currency, source.currency);
  if (d.total_minor !== source.totalMinor) {
    wrong.push(`total_minor ${rands(d.total_minor)} is not the source's Total due ${rands(source.totalMinor)}`);
  }

  const unused = [...source.lines];
  d.line_items.forEach((l, i) => {
    const at = unused.findIndex(
      (s) =>
        norm(s.description) === norm(l.description) &&
        s.quantity === l.quantity &&
        s.unitMinor === l.unit_minor &&
        s.amountMinor === l.amount_minor,
    );
    if (at === -1) {
      wrong.push(
        `line ${i + 1} "${l.description}" ${l.quantity} x ${rands(l.unit_minor)} = ${rands(l.amount_minor)} matches no unused source line`,
      );
    } else {
      unused.splice(at, 1);
    }
  });
  for (const s of unused) {
    wrong.push(`source line "${s.description}" ${s.quantity} x ${rands(s.unitMinor)} is missing from the deliverable`);
  }
  return wrong.length > 0 ? wrong.join("; ") : undefined;
}

export function runRules(input: RulesInput): RulesReport {
  const results: RuleResult[] = [];
  const record = (id: RuleId, failure: string | undefined) => {
    results.push(failure === undefined ? { id, status: "pass" } : { id, status: "fail", detail: failure });
    return failure === undefined;
  };
  const skipRest = () => {
    for (const id of RULE_IDS) if (!results.some((r) => r.id === id)) results.push({ id, status: "skipped" });
    return { passed: false, results };
  };

  if (!record("size", sizeCheck(input.deliverable))) return skipRest();
  const parsed = InvoiceDeliverableSchema.safeParse(input.deliverable);
  const schemaFailure = parsed.success
    ? undefined
    : parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "deliverable"}: ${i.message}`).join("; ");
  if (!record("schema", schemaFailure) || !parsed.success) return skipRest();
  const d = parsed.data;

  const ok = [
    record(
      "currency",
      input.allowedCurrencies.includes(d.currency) ? undefined : `currency ${d.currency} is not permitted for this job`,
    ),
    record("line_arithmetic", lineArithmetic(d)),
    record("total", totalCheck(d)),
    record("source_values", sourceValues(d, input.sourceText)),
  ].every(Boolean);
  return { passed: ok, results, parsed: d };
}
