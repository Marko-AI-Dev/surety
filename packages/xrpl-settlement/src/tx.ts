import type { EscrowCancel, EscrowCreate, EscrowFinish } from "xrpl";
import type { IssuedAmount } from "./token";

export function buildEscrowCreate(p: {
  account: string;
  destination: string;
  // Drops for XRP, an issued amount for TESTUSD.
  amount: string | IssuedAmount;
  condition: string;
  cancelAfter: number;
}): EscrowCreate {
  return {
    TransactionType: "EscrowCreate",
    Account: p.account,
    Destination: p.destination,
    Amount: p.amount,
    Condition: p.condition,
    CancelAfter: p.cancelAfter,
  };
}

export function buildEscrowFinish(p: {
  account: string;
  owner: string;
  offerSequence: number;
  condition: string;
  fulfillment: string;
}): EscrowFinish {
  return {
    TransactionType: "EscrowFinish",
    Account: p.account,
    Owner: p.owner,
    OfferSequence: p.offerSequence,
    Condition: p.condition,
    Fulfillment: p.fulfillment,
  };
}

export function buildEscrowCancel(p: {
  account: string;
  owner: string;
  offerSequence: number;
}): EscrowCancel {
  return {
    TransactionType: "EscrowCancel",
    Account: p.account,
    Owner: p.owner,
    OfferSequence: p.offerSequence,
  };
}
