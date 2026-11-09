// A sourcing is OPEN while suppliers chat and commit quotes, SELECTED once the lead's accepted deal
// locks, and CLOSED if it ends without one.
export const SOURCING_STATES = ["OPEN", "SELECTED", "CLOSED"] as const;
export type SourcingState = (typeof SOURCING_STATES)[number];
