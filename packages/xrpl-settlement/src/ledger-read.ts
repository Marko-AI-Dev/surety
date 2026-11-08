import type { Client } from "xrpl";

// Read-only ledger queries. Always against the validated ledger.

export interface EscrowEntry {
  Account: string;
  Destination: string;
  Amount: string;
  Condition?: string;
  CancelAfter?: number;
}

export interface TxResult {
  validated: boolean;
  result?: string;
  ledgerIndex?: number;
  feeDrops?: string;
  // Only set for a ranged lookup that found nothing: true means the node had every ledger in the range.
  searchedAll?: boolean;
}

export interface LedgerRange {
  minLedger: number;
  maxLedger: number;
}

function rippledError(e: unknown): { error?: unknown; searched_all?: unknown } | undefined {
  return (e as { data?: { error?: unknown; searched_all?: unknown } })?.data;
}

function rippledErrorCode(e: unknown): string | undefined {
  const error = rippledError(e)?.error;
  return typeof error === "string" ? error : undefined;
}

export async function getValidatedCloseTime(client: Client): Promise<number> {
  const r = await client.request({ command: "ledger", ledger_index: "validated" });
  return r.result.ledger.close_time;
}

export async function getEscrow(
  client: Client,
  owner: string,
  offerSequence: number,
): Promise<EscrowEntry | null> {
  try {
    const r = await client.request({
      command: "ledger_entry",
      escrow: { owner, seq: offerSequence },
      ledger_index: "validated",
    });
    const node = r.result.node as unknown as Record<string, unknown>;
    if (typeof node.Amount !== "string") {
      throw new Error("escrow holds a non-XRP amount, which Surety does not support");
    }
    return {
      Account: String(node.Account),
      Destination: String(node.Destination),
      Amount: node.Amount,
      Condition: typeof node.Condition === "string" ? node.Condition : undefined,
      CancelAfter: typeof node.CancelAfter === "number" ? node.CancelAfter : undefined,
    };
  } catch (e) {
    if (rippledErrorCode(e) === "entryNotFound") return null;
    throw e;
  }
}

export async function getTxResult(client: Client, hash: string, range?: LedgerRange): Promise<TxResult> {
  try {
    const r = await client.request({
      command: "tx",
      transaction: hash,
      ...(range ? { min_ledger: range.minLedger, max_ledger: range.maxLedger } : {}),
    });
    const res = r.result as unknown as {
      validated?: boolean;
      ledger_index?: number;
      meta?: unknown;
      tx_json?: { Fee?: string };
    };
    const meta = res.meta as { TransactionResult?: string } | undefined;
    return {
      validated: res.validated === true,
      result: typeof meta === "object" ? meta?.TransactionResult : undefined,
      ledgerIndex: res.ledger_index,
      feeDrops: res.tx_json?.Fee,
    };
  } catch (e) {
    if (rippledErrorCode(e) === "txnNotFound") {
      return range ? { validated: false, searchedAll: rippledError(e)?.searched_all === true } : { validated: false };
    }
    throw e;
  }
}
