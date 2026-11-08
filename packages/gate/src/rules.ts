import { DELIVERABLE_MAX_BYTES, type InvoiceDeliverable, InvoiceDeliverableSchema } from "@surety/contracts";

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

function sourceValues(d: InvoiceDeliverable, sourceText: string): string | undefined {
  const source = sourceText.toLowerCase();
  const missing: string[] = [];
  const text = (field: string, value: string) => {
    if (!source.includes(value.toLowerCase())) missing.push(`${field} "${value}"`);
  };
  const money = (field: string, minor: number) => {
    if (!sourceText.includes(rands(minor))) missing.push(`${field} ${rands(minor)}`);
  };
  text("invoice_id", d.invoice_id);
  text("vendor", d.vendor);
  d.line_items.forEach((l, i) => {
    text(`line ${i + 1} description`, l.description);
    money(`line ${i + 1} unit_minor`, l.unit_minor);
    money(`line ${i + 1} amount_minor`, l.amount_minor);
  });
  money("total_minor", d.total_minor);
  return missing.length > 0 ? `not in the source: ${missing.join(", ")}` : undefined;
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
