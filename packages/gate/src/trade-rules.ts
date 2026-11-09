import {
  type AssetAmount,
  DELIVERABLE_MAX_BYTES,
  type DealIntent,
  type SupplierQuote,
  type TradeFields,
  TradeDocumentsSchema,
  canonicalJson,
} from "@surety/contracts";
import { formatDocUsd, parseTradeDocuments } from "./trade-docs";

// Surety Verify's deterministic layer for a deal: the supplier's documents against the purchase order,
// the accepted quote and the lock on the ledger. A failed rule is final: no model can turn it into a pass.
export const TRADE_RULE_IDS = [
  "size",
  "parse",
  "reader_agrees",
  "po_number",
  "parties",
  "goods",
  "arithmetic",
  "total_matches_lock",
  "currency",
  "terms",
  "shipment",
  "pay_to",
] as const;
export type TradeRuleId = (typeof TRADE_RULE_IDS)[number];

export interface TradeRuleResult {
  id: TradeRuleId;
  status: "pass" | "fail" | "skipped";
  detail?: string;
}

export interface TradeRulesReport {
  passed: boolean;
  results: TradeRuleResult[];
  parsed?: TradeFields;
}

export interface TradeRulesInput {
  intent: DealIntent;
  quote: SupplierQuote;
  // The supplier's submission exactly as stored.
  documents: unknown;
  // What the document reader extracted. null when the documents did not parse, so no reader was asked.
  readerFields: TradeFields | null;
  // The escrow on the ledger: who it pays, in which asset and how much. A deal only ever locks TESTUSD.
  lock: { destination: string; amount: AssetAmount };
}

const norm = (s: string) => s.trim().toLowerCase();
const usd = (cents: number) => formatDocUsd(cents);

function sizeCheck(documents: unknown): string | undefined {
  let text: string | undefined;
  try {
    text = canonicalJson(documents);
  } catch {
    return "the documents are not serializable as JSON";
  }
  const bytes = Buffer.byteLength(text, "utf8");
  return bytes > DELIVERABLE_MAX_BYTES ? `${bytes} bytes exceeds the ${DELIVERABLE_MAX_BYTES}-byte limit` : undefined;
}

function parties(f: TradeFields, intent: DealIntent): string | undefined {
  const wrong: string[] = [];
  const same = (label: string, given: string, expected: string) => {
    if (norm(given) !== norm(expected)) wrong.push(`${label} "${given}" is not "${expected}"`);
  };
  same("invoice seller", f.invoice.seller, intent.supplier.name);
  same("invoice buyer", f.invoice.buyer, intent.buyer.name);
  same("bill of lading shipper", f.billOfLading.shipper, intent.supplier.name);
  same("bill of lading consignee", f.billOfLading.consignee, intent.buyer.name);
  return wrong.length > 0 ? wrong.join("; ") : undefined;
}

function goods(f: TradeFields, intent: DealIntent, quote: SupplierQuote): string | undefined {
  if (f.invoice.lines.length !== 1) return `the invoice has ${f.invoice.lines.length} lines; the order has one`;
  const l = f.invoice.lines[0];
  if (!l) return "the invoice has no lines";
  const wrong: string[] = [];
  if (norm(l.description) !== norm(intent.goods.description)) wrong.push(`goods "${l.description}" are not "${intent.goods.description}"`);
  if (l.quantity !== quote.quantity) wrong.push(`quantity ${l.quantity} is not the quoted ${quote.quantity}`);
  if (l.unitCents !== quote.unitCents) wrong.push(`unit price ${usd(l.unitCents)} is not the quoted ${usd(quote.unitCents)}`);
  return wrong.length > 0 ? wrong.join("; ") : undefined;
}

function arithmetic(f: TradeFields): string | undefined {
  const wrong = f.invoice.lines.flatMap((l, i) =>
    BigInt(l.quantity) * BigInt(l.unitCents) === BigInt(l.amountCents)
      ? []
      : [`line ${i + 1}: ${l.quantity} x ${usd(l.unitCents)} is not ${usd(l.amountCents)}`],
  );
  const sum = f.invoice.lines.reduce((acc, l) => acc + BigInt(l.amountCents), 0n);
  if (sum !== BigInt(f.invoice.totalCents)) wrong.push(`the lines add up to ${usd(Number(sum))}, the total due is ${usd(f.invoice.totalCents)}`);
  return wrong.length > 0 ? wrong.join("; ") : undefined;
}

function totalMatchesLock(f: TradeFields, quote: SupplierQuote, lock: TradeRulesInput["lock"]): string | undefined {
  const wrong: string[] = [];
  if (f.invoice.totalCents !== quote.totalCents) wrong.push(`the invoice total ${usd(f.invoice.totalCents)} is not the quoted ${usd(quote.totalCents)}`);
  if (lock.amount.asset !== "TESTUSD") {
    wrong.push(`the payment is locked in ${lock.amount.asset}, not TESTUSD`);
  } else if (String(quote.totalCents) !== lock.amount.cents) {
    wrong.push(`the locked amount ${usd(Number(lock.amount.cents))} is not the quoted ${usd(quote.totalCents)}`);
  }
  return wrong.length > 0 ? wrong.join("; ") : undefined;
}

function terms(f: TradeFields, intent: DealIntent): string | undefined {
  const wrong: string[] = [];
  if (f.invoice.incoterm !== intent.incoterm || norm(f.invoice.port) !== norm(intent.port)) {
    wrong.push(`the invoice says ${f.invoice.incoterm} ${f.invoice.port}, the order ${intent.incoterm} ${intent.port}`);
  }
  if (norm(f.billOfLading.portOfDischarge) !== norm(intent.port)) {
    wrong.push(`the bill of lading discharges at ${f.billOfLading.portOfDischarge}, not ${intent.port}`);
  }
  return wrong.length > 0 ? wrong.join("; ") : undefined;
}

function shipment(f: TradeFields): string | undefined {
  const l = f.invoice.lines[0];
  if (!l) return "the invoice has no lines";
  const b = f.billOfLading;
  const wrong: string[] = [];
  if (b.goodsQuantity !== l.quantity) wrong.push(`the bill of lading ships ${b.goodsQuantity}, the invoice bills ${l.quantity}`);
  if (norm(b.goodsDescription) !== norm(l.description)) wrong.push(`the bill of lading ships "${b.goodsDescription}", the invoice bills "${l.description}"`);
  return wrong.length > 0 ? wrong.join("; ") : undefined;
}

// The redirection check: the invoice must ask for payment to the wallet the money is locked to, which
// is the approved supplier in the intent. "Our wallet has changed" fails here.
function payTo(f: TradeFields, intent: DealIntent, lock: TradeRulesInput["lock"]): string | undefined {
  if (f.invoice.payTo !== lock.destination) {
    return `the invoice asks for payment to ${f.invoice.payTo}, but the payment is locked to the supplier wallet ${lock.destination}`;
  }
  if (lock.destination !== intent.supplier.address) {
    return `the payment is locked to ${lock.destination}, not the intent's supplier wallet ${intent.supplier.address}`;
  }
  return undefined;
}

export function runTradeRules(input: TradeRulesInput): TradeRulesReport {
  const results: TradeRuleResult[] = [];
  const record = (id: TradeRuleId, failure: string | undefined) => {
    results.push(failure === undefined ? { id, status: "pass" } : { id, status: "fail", detail: failure });
    return failure === undefined;
  };
  const skipRest = (): TradeRulesReport => {
    for (const id of TRADE_RULE_IDS) if (!results.some((r) => r.id === id)) results.push({ id, status: "skipped" });
    return { passed: false, results };
  };

  if (!record("size", sizeCheck(input.documents))) return skipRest();
  const docs = TradeDocumentsSchema.safeParse(input.documents);
  const parsed = docs.success ? parseTradeDocuments(docs.data) : null;
  if (!record("parse", parsed ? undefined : "the documents do not follow the invoice and bill of lading template") || !parsed) {
    return skipRest();
  }

  const { intent, quote, lock } = input;
  const ok = [
    record(
      "reader_agrees",
      input.readerFields === null
        ? "the document reader returned nothing to compare"
        : canonicalJson(input.readerFields) === canonicalJson(parsed)
          ? undefined
          : "the document reader's fields differ from the documents",
    ),
    record("po_number", parsed.invoice.poNumber === intent.poNumber ? undefined : `PO number ${parsed.invoice.poNumber} is not ${intent.poNumber}`),
    record("parties", parties(parsed, intent)),
    record("goods", goods(parsed, intent, quote)),
    record("arithmetic", arithmetic(parsed)),
    record("total_matches_lock", totalMatchesLock(parsed, quote, lock)),
    record("currency", parsed.invoice.currency === "USD" ? undefined : `the invoice is in ${parsed.invoice.currency}, not USD`),
    record("terms", terms(parsed, intent)),
    record("shipment", shipment(parsed)),
    record("pay_to", payTo(parsed, intent, lock)),
  ].every(Boolean);
  return { passed: ok, results, parsed };
}
