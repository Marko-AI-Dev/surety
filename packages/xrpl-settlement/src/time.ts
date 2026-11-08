import { rippleTimeToISOTime } from "xrpl";

// Seconds between the Unix epoch and the Ripple epoch (2000-01-01T00:00:00Z).
export const RIPPLE_EPOCH_OFFSET = 946684800;

// CancelAfter is computed from the latest validated ledger close time, never laptop time.
export function cancelAfterFrom(closeTime: number, seconds: number): number {
  if (!Number.isInteger(closeTime) || closeTime < 0) {
    throw new RangeError(`closeTime must be a non-negative integer, got ${closeTime}`);
  }
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new RangeError(`seconds must be a non-negative integer, got ${seconds}`);
  }
  return closeTime + seconds;
}

export function rippleToIso(rippleTime: number): string {
  return rippleTimeToISOTime(rippleTime);
}
