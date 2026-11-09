import { type DealIntent, type SupplierQuote, budgetCents } from "@surety/contracts";
import { formatDocUsd } from "./trade-docs";

// The hard checks around a deal's commercial terms. Every check runs, so the record shows the whole
// picture, not just the first problem. Details are plain English for the deal record. These checks
// are a second line: the signer enforces the same limits on every lock whatever they say.

export interface CheckResult<Id extends string> {
  id: Id;
  status: "pass" | "fail";
  detail?: string;
}

export interface CheckReport<Id extends string> {
  passed: boolean;
  results: CheckResult<Id>[];
}

export type IntentCheckId = "buyer_treasury" | "asset_enabled" | "approved_supplier" | "budget_within_cap" | "supplier_ready";
export type QuoteCheckId =
  | "supplier_wallet"
  | "approved_supplier"
  | "quantity"
  | "unit_price"
  | "arithmetic"
  | "currency"
  | "terms"
  | "per_deal_cap";

export interface TestUsdPolicyView {
  perDealCents: string;
  approvedSuppliers: string[];
}

// The supplier's TESTUSD trust line, in cents. null when the supplier has no line.
export interface SupplierLine {
  balanceCents: bigint;
  limitCents: bigint;
  frozenByIssuer: boolean;
}

export interface IntentContext {
  treasury: string;
  testUsd: TestUsdPolicyView | null;
  supplierLine: SupplierLine | null;
}

const usd = (cents: bigint) => formatDocUsd(Number(cents));
const samePort = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function report<Id extends string>(checks: [Id, string | undefined][]): CheckReport<Id> {
  const results = checks.map(([id, failure]): CheckResult<Id> => (failure === undefined ? { id, status: "pass" } : { id, status: "fail", detail: failure }));
  return { passed: results.every((r) => r.status === "pass"), results };
}

// The Policy step: can this intent be locked at all under the live operator policy?
export function checkIntent(intent: DealIntent, ctx: IntentContext): CheckReport<IntentCheckId> {
  const budget = budgetCents(intent);
  const policy = ctx.testUsd;
  const line = ctx.supplierLine;
  const room = line ? line.limitCents - line.balanceCents : 0n;
  return report<IntentCheckId>([
    ["buyer_treasury", intent.buyer.address === ctx.treasury ? undefined : `the buyer wallet ${intent.buyer.address} is not the treasury ${ctx.treasury}`],
    ["asset_enabled", policy ? undefined : "TESTUSD payments are not enabled on the signer"],
    [
      "approved_supplier",
      !policy
        ? "there is no TESTUSD policy to approve the supplier"
        : policy.approvedSuppliers.includes(intent.supplier.address)
          ? undefined
          : `the supplier wallet ${intent.supplier.address} is not an approved supplier`,
    ],
    [
      "budget_within_cap",
      !policy
        ? "there is no TESTUSD policy with a per-deal cap"
        : budget <= BigInt(policy.perDealCents)
          ? undefined
          : `the budget ${usd(budget)} is above the per-deal cap ${usd(BigInt(policy.perDealCents))}`,
    ],
    [
      "supplier_ready",
      !line
        ? "the supplier wallet has no TESTUSD trust line, so it cannot receive the payment"
        : line.frozenByIssuer
          ? "the supplier's TESTUSD trust line is frozen"
          : room < budget
            ? `the supplier's trust line has room for ${usd(room < 0n ? 0n : room)}, less than the budget ${usd(budget)}`
            : undefined,
    ],
  ]);
}

// The quote against the intent and the live policy. The deal agent sees this report, and an accept
// is only carried out when it passes.
export function checkQuote(intent: DealIntent, quote: SupplierQuote, limits: TestUsdPolicyView): CheckReport<QuoteCheckId> {
  const total = BigInt(quote.totalCents);
  const expected = BigInt(quote.quantity) * BigInt(quote.unitCents);
  return report<QuoteCheckId>([
    [
      "supplier_wallet",
      quote.supplierAddress === intent.supplier.address
        ? undefined
        : `the quote asks for payment to ${quote.supplierAddress}, not the intent's supplier wallet ${intent.supplier.address}`,
    ],
    [
      "approved_supplier",
      limits.approvedSuppliers.includes(quote.supplierAddress) ? undefined : `the wallet ${quote.supplierAddress} is not an approved supplier`,
    ],
    ["quantity", quote.quantity === intent.goods.quantity ? undefined : `the quote is for ${quote.quantity}, the intent for ${intent.goods.quantity}`],
    [
      "unit_price",
      quote.unitCents <= intent.goods.maxUnitCents
        ? undefined
        : `unit price ${formatDocUsd(quote.unitCents)} is above the intent's maximum ${formatDocUsd(intent.goods.maxUnitCents)}`,
    ],
    [
      "arithmetic",
      expected === total ? undefined : `${quote.quantity} x ${formatDocUsd(quote.unitCents)} is ${usd(expected)}, but the quote total is ${usd(total)}`,
    ],
    ["currency", quote.currency === "USD" ? undefined : `the quote is in ${quote.currency}, not USD`],
    [
      "terms",
      quote.incoterm === intent.incoterm && samePort(quote.port, intent.port)
        ? undefined
        : `the quote is ${quote.incoterm} ${quote.port}, the intent ${intent.incoterm} ${intent.port}`,
    ],
    [
      "per_deal_cap",
      total <= BigInt(limits.perDealCents) ? undefined : `the total ${usd(total)} is above the per-deal cap ${usd(BigInt(limits.perDealCents))}`,
    ],
  ]);
}
