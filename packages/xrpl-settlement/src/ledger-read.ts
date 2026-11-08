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
}

function rippledErrorCode(e: unknown): string | undefined {
  const data = (e as { data?: { error?: unknown } })?.data;
  return typeof data?.error === "string" ? data.error : undefined;
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

export async function getTxResult(client: Client, hash: string): Promise<TxResult> {
  try {
    const r = await client.request({ command: "tx", transaction: hash });
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
    if (rippledErrorCode(e) === "txnNotFound") return { validated: false };
    throw e;
  }
}
