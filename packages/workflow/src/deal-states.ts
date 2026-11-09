// The deal lifecycle before the escrow lock. The database check constraint lists the same 5 states.
// After ACCEPTED, the deal's progress is its escrow job's state (LOCKED, DELIVERED, PAID, REFUNDED ...).
export const DEAL_STATES = ["POLICY_REFUSED", "AWAITING_QUOTE", "QUOTE_RECEIVED", "DECLINED", "ACCEPTED"] as const;

export type DealState = (typeof DEAL_STATES)[number];

export const TERMINAL_DEAL_STATES = ["POLICY_REFUSED", "DECLINED", "ACCEPTED"] as const satisfies readonly DealState[];
