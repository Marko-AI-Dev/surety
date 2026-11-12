// The recorded testnet runs, imported straight from evidence/ (never copied, never edited).
import dealsJson from "../../../../evidence/deals-2026-11-09T15-07-44-320Z.json";
import sourcingJson from "../../../../evidence/sourcing-2026-11-09T18-56-04-932Z.json";
import signerJson from "../../../../evidence/testusd-signer-2026-11-09T09-22-15-177Z.json";
import type { DealsEvidence, SignerEvidence } from "./attacks";
import type { SourcingRecord } from "./types";

export const recordedRun = sourcingJson as unknown as SourcingRecord;
export const dealsEvidence = dealsJson as unknown as DealsEvidence;
export const signerEvidence = signerJson as unknown as SignerEvidence;

export const RECORDED_RUN_FILE = "evidence/sourcing-2026-11-09T18-56-04-932Z.json";

// The operator's limits during the recorded run. The sourcing evidence does not carry them; these
// are the live policy v5 values written down in docs/log.md on 9 Nov 2026, and the deals evidence
// from the same afternoon records policy version 5 on its Policy step.
export const DOCUMENTED_LIMITS = {
  source: "docs/log.md, 9 Nov 2026: live policy v5",
  policyVersion: 5,
  perDealCents: 10_000_000,
  dailyCents: 50_000_000,
  openDeals: 10,
};

// Bouncer thresholds (chat-v1) and Surety Verify thresholds (policy-v4-trade), from packages/gate/src/policy.ts.
export const CHAT_THRESHOLDS = { deliverMinOrdinary: 0.3, deliverMaxSteering: 0.2, yellowMinSteering: 0.5 };
export const TRADE_THRESHOLDS = { approveMinConsistency: 0.7, approveMaxTrick: 0.2 };

// The twelve trade rules Surety Verify runs before the decision model, in order
// (packages/gate/src/trade-rules.ts). The model is asked only when all of them pass.
export const TRADE_RULES: { id: string; label: string }[] = [
  { id: "size", label: "Documents are a normal size" },
  { id: "parse", label: "Documents are readable" },
  { id: "reader_agrees", label: "Read the same way twice" },
  { id: "po_number", label: "Order number" },
  { id: "parties", label: "Buyer and supplier" },
  { id: "goods", label: "Goods, quantity, unit price" },
  { id: "arithmetic", label: "The sums add up" },
  { id: "total_matches_lock", label: "Total equals the locked amount" },
  { id: "currency", label: "Currency" },
  { id: "terms", label: "Delivery terms and port" },
  { id: "shipment", label: "Shipment matches invoice" },
  { id: "pay_to", label: "Pays the wallet the money is locked for" },
];
