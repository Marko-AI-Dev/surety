import { describe, expect, it } from "vitest";
import type { Client } from "xrpl";
import { XrplLedger } from "../src/xrpl-ledger";

const EXPIRED = new Error(
  "The latest ledger sequence 105 is greater than the transaction's LastLedgerSequence (100).",
);

function stubClient(txResponse: () => unknown): Client {
  return {
    submitAndWait: async () => {
      throw EXPIRED;
    },
    request: async (req: { command: string }) => {
      if (req.command === "tx") return txResponse();
      throw new Error(`unexpected command ${req.command}`);
    },
  } as unknown as Client;
}

describe("XrplLedger.submitSigned", () => {
  it("returns the real outcome when xrpl.js reports expiry for a transaction that did validate", async () => {
    const ledger = new XrplLedger(
      "wss://unused",
      stubClient(() => ({
        result: { validated: true, ledger_index: 99, meta: { TransactionResult: "tesSUCCESS" }, tx_json: { Fee: "12" } },
      })),
    );
    expect(await ledger.submitSigned("BLOB", "HASH")).toEqual({
      validated: true,
      result: "tesSUCCESS",
      ledgerIndex: 99,
      feeDrops: "12",
    });
  });

  it("leaves the outcome unknown when the hash is not found, so the signer's ranged lookup decides", async () => {
    const ledger = new XrplLedger(
      "wss://unused",
      stubClient(() => {
        throw Object.assign(new Error("txnNotFound"), { data: { error: "txnNotFound" } });
      }),
    );
    await expect(ledger.submitSigned("BLOB", "HASH")).rejects.toThrow(/LastLedgerSequence/);
  });

  it("passes the ledger range to rippled and reports whether it searched all of it", async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      request: async (req: Record<string, unknown>) => {
        seen.push(req);
        throw Object.assign(new Error("txnNotFound"), { data: { error: "txnNotFound", searched_all: true } });
      },
    } as unknown as Client;
    const ledger = new XrplLedger("wss://unused", client);
    expect(await ledger.lookup("HASH", { minLedger: 100, maxLedger: 120 })).toEqual({
      validated: false,
      searchedAll: true,
    });
    expect(seen[0]).toMatchObject({ command: "tx", transaction: "HASH", min_ledger: 100, max_ledger: 120 });
  });
});
