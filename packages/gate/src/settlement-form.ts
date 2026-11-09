import type { DealIntent, SettlementForm, SupplierQuote, TradeDocuments, TradeFields } from "@surety/contracts";
import { renderTradeDocuments } from "./trade-docs";

// The supplier's settlement form. Nobody types the document template: everything the deal decides is
// fixed here, the supplier adds the few facts only it knows, and the form renders the commercial
// invoice and bill of lading the trade rules read. `edits` exists for the Attack lab and is never
// pre-filled; every edit it carries must be caught by the rules.

export interface SettlementDraft {
  fixed: {
    invoice: Omit<TradeFields["invoice"], "invoiceNumber">;
    billOfLading: Omit<TradeFields["billOfLading"], "blNumber" | "portOfLoading" | "vessel">;
  };
  suggested: { invoiceNumber: string; remarks: { invoice: string; billOfLading: string } };
}

export function settlementDraft(intent: DealIntent, quote: SupplierQuote): SettlementDraft {
  return {
    fixed: {
      invoice: {
        poNumber: intent.poNumber,
        seller: intent.supplier.name,
        buyer: intent.buyer.name,
        payTo: quote.supplierAddress,
        currency: quote.currency,
        incoterm: quote.incoterm,
        port: quote.port,
        lines: [{ description: intent.goods.description, quantity: quote.quantity, unitCents: quote.unitCents, amountCents: quote.totalCents }],
        totalCents: quote.totalCents,
      },
      billOfLading: {
        shipper: intent.supplier.name,
        consignee: intent.buyer.name,
        portOfDischarge: intent.port,
        goodsDescription: intent.goods.description,
        goodsQuantity: quote.quantity,
      },
    },
    suggested: {
      invoiceNumber: `INV-${quote.quoteNumber.replace(/^Q-?/, "")}`,
      remarks: { invoice: `Goods as per quote ${quote.quoteNumber}.`, billOfLading: "Clean on board. Freight prepaid." },
    },
  };
}

export function buildSettlementDocuments(intent: DealIntent, quote: SupplierQuote, form: SettlementForm): TradeDocuments {
  const { fixed } = settlementDraft(intent, quote);
  const e = form.edits ?? {};
  const line = fixed.invoice.lines[0];
  if (!line) throw new Error("the settlement draft has no invoice line");
  const fields: TradeFields = {
    invoice: {
      ...fixed.invoice,
      invoiceNumber: form.invoiceNumber,
      payTo: e.payTo ?? fixed.invoice.payTo,
      lines: [{ ...line, quantity: e.invoiceQuantity ?? line.quantity, unitCents: e.unitCents ?? line.unitCents }],
      totalCents: e.totalCents ?? fixed.invoice.totalCents,
    },
    billOfLading: {
      ...fixed.billOfLading,
      blNumber: form.blNumber,
      portOfLoading: form.portOfLoading,
      vessel: form.vessel,
      goodsQuantity: e.blQuantity ?? fixed.billOfLading.goodsQuantity,
    },
  };
  return renderTradeDocuments(fields, form.remarks);
}
