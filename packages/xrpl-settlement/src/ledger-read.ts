import type { Client } from "xrpl";
import type { IssuedAmount } from "./token";

// Read-only ledger queries. Always against the validated ledger.

export interface EscrowEntry {
  Account: string;
  Destination: string;
  Amount: string | IssuedAmount;
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

// XRP drops or a trust-line token amount. Anything else (an MPT amount, say) is refused.
function escrowAmount(raw: unknown): string | IssuedAmount {
  if (typeof raw === "string") return raw;
  const a = raw as Record<string, unknown> | null;
  if (
    a &&
    typeof a.currency === "string" &&
    typeof a.issuer === "string" &&
    typeof a.value === "string" &&
    Object.keys(a).length === 3
  ) {
    return { currency: a.currency, issuer: a.issuer, value: a.value };
  }
  throw new Error("escrow holds an unsupported amount");
}

export interface TrustLine {
  balance: string;
  limit: string;
  frozenByIssuer: boolean;
}

// The holder's trust line to one issuer for one currency, from the validated ledger.
// null when the account has no such line or does not exist.
export async function getTrustLine(
  client: Client,
  account: string,
  issuer: string,
  currencyHex: string,
): Promise<TrustLine | null> {
  try {
    const r = await client.request({ command: "account_lines", account, peer: issuer, ledger_index: "validated" });
    const line = r.result.lines.find((l) => l.currency === currencyHex);
    if (!line) return null;
    return { balance: line.balance, limit: line.limit, frozenByIssuer: line.freeze_peer === true };
  } catch (e) {
    if (rippledErrorCode(e) === "actNotFound") return null;
    throw e;
  }
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
    const amount = escrowAmount(node.Amount);
    return {
      Account: String(node.Account),
      Destination: String(node.Destination),
      Amount: amount,
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
