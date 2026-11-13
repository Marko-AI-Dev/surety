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
  // On a message to a supplier (14 Nov): who wrote it, and whether the buyer approved or reworded it.
  by?: "negotiator" | "buyer";
  buyerApproved?: boolean;
  buyerEdited?: boolean;
}

export interface RecordInvite {
  address: string;
  name: string;
  status: "in" | "out";
  cards: Card[];
  quote: { unitCents: number; quantity: number; totalCents: number } | null;
  // Phase 4d: the delivery time committed with the quote.
  deliveryDays?: number | null;
  dealId: string | null;
}

// Phase 4d: Surety's ordering of the committed quotes for the buyer's priority.
export interface RankingRow {
  supplier: string;
  unitCents: number;
  deliveryDays: number | null;
  eligible: boolean;
  why: string;
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

// The second key for a release: an inspector, a role separate from the buyer's agents and from the
// supplier, attests the bill of lading before the payment can be released. The API for it is not
// built yet, so this shape is provisional and every field is optional. A record without it (such as
// the recorded run of 9 Nov) was released on the supplier's documents alone.
export interface Inspection {
  state: "pending" | "attested" | "refused";
  inspector?: string | null;
  blNumber?: string | null;
  note?: string | null;
  at?: string | null;
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
      // Phase 4d: what the buyer cares about most, and the slowest delivery it accepts.
      priority?: "price" | "speed" | "balanced";
      latestDeliveryDays?: number | null;
      push?: "gentle" | "firm";
      autonomy?: "full" | "approve";
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
  inspection?: Inspection | null;
  ranking?: RankingRow[] | null;
  // The buyer's final yes: the Lead recommends a deal and nothing locks until the buyer approves it.
  approval?: { state: "waiting" | "approved" | "declined"; dealId: string; supplier: string; leadReason: string; at: string; answeredAt: string | null } | null;
  // What the buyer told its negotiator during the negotiation.
  buyerNotes?: { text: string; at: string }[] | null;
  // The buyer's control of the negotiation (14 Nov): its settings, when the lead should decide, the
  // messages waiting for the buyer, the buyer's chat with its agent, and which suppliers are writing.
  controls?: { autonomy: "full" | "approve"; push: "gentle" | "firm"; wrapUpAt: string | null } | null;
  decideNow?: { ready: boolean; why: "criteria_met" | "buyer_asked" | "time_over" | null } | null;
  drafts?: { id: string; supplier: string; text: string; at: string }[] | null;
  chat?: { role: "buyer" | "agent"; text: string; at: string }[] | null;
  typing?: Record<string, string> | null;
  // Phase 4d: notes on the run, such as a choice that went against the priority.
  notes?: unknown[] | null;
  events?: { at: string; actor: string; from: string | null; to: string; reasonCodes: string[] }[] | null;
}

export interface SourcingListItem {
  id: string;
  ref: string;
  state: string;
  createdAt?: string;
  goods?: string;
  quantity?: number;
  // Where the purchase stands (13 Nov). Absent from an older backend.
  stage?: "negotiating" | "waiting" | "declined" | "locked" | "paid" | "refunded" | "stopped" | "closed";
  supplier?: string | null;
  totalCents?: number | null;
}
