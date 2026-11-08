import type { Client } from "xrpl";
import { getValidatedCloseTime } from "@surety/xrpl-settlement";

// Validated ledger close time, connecting on demand. A testnet node that is slow or down fails
// one sweep (logged, retried next interval) instead of crashing the worker at boot.
export function ledgerClock(client: Client): () => Promise<number> {
  return async () => {
    if (!client.isConnected()) await client.connect();
    return getValidatedCloseTime(client);
  };
}
