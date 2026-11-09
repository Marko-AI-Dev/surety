// One shape for replay and live. It is the shape of evidence/sourcing-*.json; a live record from
// GET /sourcing/:id/record carries the same fields, with everything after the negotiation absent
// until it happens.

export type Card = "yellow" | "red";

export interface ScreenRecord {
  links?: string[];
  rules?: { passed: boolean; results: { id: string; status: string; detail?: string }[] };
  costUsd?: number | null;
  samples?: { satisfaction: number; injectionRisk: number }[] | null;
  reasonCodes?: string[];
  satisfaction?: number | null;
  injectionRisk?: number | null;
  source?: string;
}

export interface RecordMessage {
  at: string;
  kind: "to_supplier" | "from_supplier" | "report";
  supplier: string;
  body: string;
  delivered: boolean;
  card: Card | null;
  offer: { supplier: string; unitCents: number; quantity: number; deliveryDays: number; summary?: string } | null;
  screen: ScreenRecord | null;
}

export interface RecordInvite {
  address: string;
  name: string;
  status: "in" | "out";
  cards: Card[];
  quote: { unitCents: number; quantity: number; totalCents: number } | null;
  dealId: string | null;
}

export interface LedgerTx {
  txHash: string;
  validated: boolean;
  result: string;
  ledgerIndex: number;
  feeDrops?: string;
  explorer: string;
}

export interface RecordDeal {
  id: string;
  ref: string;
  state: string;
  supplier: { name: string; address: string };
  quote: {
    quoteNumber: string;
    supplierAddress: string;
    quantity: number;
    unitCents: number;
    totalCents: number;
    incoterm: string;
    port: string;
    notes: string;
    currency: string;
  } | null;
  decision: {
    agent: { kind: string; model: string | null; reason: string; outcome: "accept" | "decline" };
    final: "accept" | "decline";
    reasonCodes: string[];
  } | null;
}

export interface PolicyView {
  policyVersion: number;
  limits: { perDealCents: string; dailyCents: string; openDeals: number };
  approvedSuppliers: { address: string; name: string; onHold: boolean }[];
}

export interface SourcingRecord {
  network: string;
  recordedAt?: string;
  sourcing: {
    id: string;
    ref: string;
    state: string;
    brief: {
      buyer: { name: string; address: string };
      goods: { description: string; quantity: number; targetUnitCents: number; maxUnitCents: number };
      incoterm: string;
      port: string;
      deadlineSeconds: number;
      negotiationSeconds: number;
    };
    negotiationEndsAt: string;
  };
  invites: RecordInvite[];
  suggestions: { id: string; sourcingId: string; name: string; address: string; reason: string; createdAt: string }[];
  messages: RecordMessage[];
  deals?: RecordDeal[];
  job?: { id: string; ref: string; state: string; amount: { asset: string; cents: string }; seller: string; policyVersion: string } | null;
  verify?: { outcome: string; satisfaction: number | null; injectionRisk: number | null; reasonCodes: string[]; policyVersion: string } | null;
  create?: LedgerTx | null;
  finish?: LedgerTx | null;
  cancel?: LedgerTx | null;
  treasuryCents?: { before: string | null; after: string | null } | null;
  costUsd?: { bouncer: number; verify: number } | null;
  checks?: Record<string, boolean> | null;
  policy?: PolicyView | null;
  events?: { at: string; actor: string; from: string | null; to: string; reasonCodes: string[] }[] | null;
}

export interface SourcingListItem {
  id: string;
  ref: string;
  state: string;
  createdAt?: string;
}
