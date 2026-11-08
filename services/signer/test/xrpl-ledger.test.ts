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

  it("reports conclusive expiry only when the hash is not on the validated ledger", async () => {
    const ledger = new XrplLedger(
      "wss://unused",
      stubClient(() => {
        throw Object.assign(new Error("txnNotFound"), { data: { error: "txnNotFound" } });
      }),
    );
    expect(await ledger.submitSigned("BLOB", "HASH")).toEqual({
      validated: false,
      result: "expired_past_last_ledger_sequence",
      ledgerIndex: 0,
      feeDrops: "0",
    });
  });
});
