// A sourcing is OPEN while suppliers chat and commit quotes, SELECTED from the moment the lead decides
// on a supplier's deal (released back to OPEN if that decision declines), and CLOSED if it ends without
// a deal.
export const SOURCING_STATES = ["OPEN", "SELECTED", "CLOSED"] as const;
export type SourcingState = (typeof SOURCING_STATES)[number];
