import {
  type DealIntent,
  MAX_TESTUSD_CENTS,
  type SupplierQuote,
  type TradeDocuments,
  type TradeFields,
  TradeFieldsSchema,
} from "@surety/contracts";

// The deal's documents as text, in one fixed template: a commercial invoice and a bill of lading. Each
// labelled line appears exactly once; a missing or repeated label makes the document unparseable, so
// the parse rule fails closed instead of guessing. Rows that match no label are ignored: free text is
// the decision model's job, never the parser's. Money is read by splitting strings, never as floats.

const MONEY = /^\$(0|[1-9]\d{0,2}(?:,\d{3})*)\.(\d{2})$/;

// "$48,000.00" from 4800000 cents. Always two decimals and thousands commas, as the documents print it.
export function formatDocUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError("cents must be a non-negative integer");
  const c = BigInt(cents);
  return `$${(c / 100n).toLocaleString("en-US")}.${String(c % 100n).padStart(2, "0")}`;
}

// The exact inverse of formatDocUsd. Anything else ("$48000.00", "$48,000.5", "$ 1.00") is null.
export function parseDocUsd(text: string): number | null {
  const m = MONEY.exec(text);
  if (!m?.[1] || m[2] === undefined) return null;
  const cents = BigInt(m[1].replaceAll(",", "")) * 100n + BigInt(m[2]);
  return cents <= MAX_TESTUSD_CENTS ? Number(cents) : null;
}

const lineRow = (l: TradeFields["invoice"]["lines"][number]) =>
  `${l.quantity} x ${l.description} @ ${formatDocUsd(l.unitCents)} = ${formatDocUsd(l.amountCents)}`;

const withRemarks = (rows: string[], remarks: string) => (remarks.trim() === "" ? rows : [...rows, `Remarks: ${remarks}`]);

export function renderTradeDocuments(fields: TradeFields, remarks: { invoice: string; billOfLading: string }): TradeDocuments {
  const i = fields.invoice;
  const b = fields.billOfLading;
  const invoice = withRemarks(
    [
      "COMMERCIAL INVOICE",
      `Invoice number: ${i.invoiceNumber}`,
      `PO number: ${i.poNumber}`,
      `Seller: ${i.seller}`,
      `Buyer: ${i.buyer}`,
      `Pay to wallet: ${i.payTo}`,
      `Currency: ${i.currency}`,
      `Incoterm: ${i.incoterm} ${i.port}`,
      ...i.lines.map(lineRow),
      `Total due: ${formatDocUsd(i.totalCents)}`,
    ],
    remarks.invoice,
  );
  const billOfLading = withRemarks(
    [
      "BILL OF LADING",
      `B/L number: ${b.blNumber}`,
      `Shipper: ${b.shipper}`,
      `Consignee: ${b.consignee}`,
      `Port of loading: ${b.portOfLoading}`,
      `Port of discharge: ${b.portOfDischarge}`,
      `Vessel: ${b.vessel}`,
      `Goods: ${b.goodsQuantity} x ${b.goodsDescription}`,
    ],
    remarks.billOfLading,
  );
  return { commercialInvoice: invoice.join("\n"), billOfLading: billOfLading.join("\n") };
}

const rowsOf = (text: string) => text.split(/\r?\n/).map((r) => r.trim());

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// The value of a label that appears exactly once, or null.
function single(rows: string[], label: string): string | null {
  const pattern = new RegExp(`^${escape(label)}:(.*)$`);
  const found = rows.flatMap((r) => {
    const m = pattern.exec(r);
    return m?.[1] === undefined ? [] : [m[1].trim()];
  });
  return found.length === 1 && found[0] ? found[0] : null;
}

const QUANTITY = /^[1-9]\d{0,6}$/;
// Anything shaped like a line row must parse strictly, so a malformed line is never silently dropped.
const LOOSE_LINE = /^\S+ x .+ @ .+ = .+$/;
const LINE = /^(\S+) x (.+?) @ (\S+) = (\S+)$/;
const GOODS = /^(\S+) x (.+)$/;
const TERMS = /^([A-Z]{3}) (.+)$/;

export function parseTradeDocuments(docs: TradeDocuments): TradeFields | null {
  const inv = rowsOf(docs.commercialInvoice);
  const bl = rowsOf(docs.billOfLading);

  const lines: TradeFields["invoice"]["lines"] = [];
  for (const row of inv) {
    if (!LOOSE_LINE.test(row)) continue;
    const m = LINE.exec(row);
    if (!m) return null;
    const [, qty, description, unit, amount] = m;
    const unitCents = parseDocUsd(unit ?? "");
    const amountCents = parseDocUsd(amount ?? "");
    if (!qty || !QUANTITY.test(qty) || !description || unitCents === null || amountCents === null) return null;
    lines.push({ description: description.trim(), quantity: Number(qty), unitCents, amountCents });
  }

  const terms = TERMS.exec(single(inv, "Incoterm") ?? "");
  const total = parseDocUsd(single(inv, "Total due") ?? "");
  const goods = GOODS.exec(single(bl, "Goods") ?? "");
  if (!terms?.[1] || !terms[2] || total === null || !goods?.[1] || !goods[2] || !QUANTITY.test(goods[1])) return null;

  const candidate = {
    invoice: {
      invoiceNumber: single(inv, "Invoice number"),
      poNumber: single(inv, "PO number"),
      seller: single(inv, "Seller"),
      buyer: single(inv, "Buyer"),
      payTo: single(inv, "Pay to wallet"),
      currency: single(inv, "Currency"),
      incoterm: terms[1],
      port: terms[2].trim(),
      lines,
      totalCents: total,
    },
    billOfLading: {
      blNumber: single(bl, "B/L number"),
      shipper: single(bl, "Shipper"),
      consignee: single(bl, "Consignee"),
      portOfLoading: single(bl, "Port of loading"),
      portOfDischarge: single(bl, "Port of discharge"),
      vessel: single(bl, "Vessel"),
      goodsDescription: goods[2].trim(),
      goodsQuantity: Number(goods[1]),
    },
  };
  // A null label, an invalid wallet or an empty line list fails the schema: unparseable.
  const parsed = TradeFieldsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// The purchase order the deal locks against, frozen as the job's source text.
export function renderPurchaseOrder(intent: DealIntent, quote: SupplierQuote): string {
  return [
    "PURCHASE ORDER",
    `PO number: ${intent.poNumber}`,
    `Buyer: ${intent.buyer.name}, treasury wallet ${intent.buyer.address}`,
    `Supplier: ${intent.supplier.name}, wallet ${quote.supplierAddress}`,
    `Goods: ${quote.quantity} x ${intent.goods.description} @ ${formatDocUsd(quote.unitCents)} = ${formatDocUsd(quote.totalCents)}`,
    `Maximum unit price in the intent: ${formatDocUsd(intent.goods.maxUnitCents)}`,
    `Accepted quote: ${quote.quoteNumber}`,
    `Total: ${formatDocUsd(quote.totalCents)} (USD, settled as TESTUSD on XRPL Testnet)`,
    `Incoterm: ${intent.incoterm} ${intent.port}`,
    `Refund deadline: ${intent.deadlineSeconds} seconds after the payment locks`,
  ].join("\n");
}
