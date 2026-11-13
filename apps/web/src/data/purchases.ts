import { usd } from "./format";
import type { SourcingListItem } from "./types";

// The buyer's purchases, newest first, each with one plain line for where it stands. Worked out from
// the list the API sends, so it is tested without a screen.

export interface PurchaseRow {
  id: string;
  ref: string;
  title: string;
  // The day it was opened, or null when the list does not say.
  opened: string | null;
  line: string;
  tone: "plain" | "ok" | "held" | "stop" | "money";
  amount: string | null;
  // Where the row leads: the newest purchase is the buyer's main screen, an earlier one opens by its id.
  href: string;
  // This is the purchase on screen now.
  showing: boolean;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function standing(p: SourcingListItem): Pick<PurchaseRow, "line" | "tone"> {
  const supplier = p.supplier ?? "the supplier";
  switch (p.stage) {
    case "negotiating":
      return { line: "Your agents are negotiating", tone: "plain" };
    case "waiting":
      return { line: "Waiting for your yes or no", tone: "held" };
    case "declined":
      return { line: "You said no. Nothing was paid.", tone: "stop" };
    case "locked":
      return { line: `Payment locked for ${supplier}, waiting for the checks`, tone: "money" };
    case "paid":
      return { line: `Paid to ${supplier}`, tone: "ok" };
    case "refunded":
      return { line: `Refunded to you. ${p.supplier ?? "The supplier"} was not paid.`, tone: "stop" };
    case "stopped":
      return { line: "Stopped before any payment. Nothing was paid.", tone: "stop" };
    case "closed":
      return { line: "Closed with no deal", tone: "plain" };
    default:
      // A backend from before 13 Nov sends no stage.
      return { line: "In progress", tone: "plain" };
  }
}

// `showing` is the id of the purchase on screen, or null for the newest.
export function purchaseRows(list: SourcingListItem[], showing: string | null): PurchaseRow[] {
  const newest = list[0]?.id ?? null;
  const onScreen = showing && list.some((p) => p.id === showing) ? showing : newest;
  return list.map((p) => ({
    id: p.id,
    ref: p.ref,
    title: p.quantity !== undefined && p.goods ? `${p.quantity.toLocaleString("en-US")} x ${p.goods}` : p.ref,
    opened: p.createdAt ? day(p.createdAt) : null,
    ...standing(p),
    amount: p.totalCents === null || p.totalCents === undefined ? null : usd(p.totalCents),
    href: p.id === newest ? "#/" : `#/?p=${p.id}`,
    showing: p.id === onScreen,
  }));
}
