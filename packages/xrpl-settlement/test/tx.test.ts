import { describe, expect, it } from "vitest";
import { buildEscrowCancel, buildEscrowCreate, buildEscrowFinish } from "../src/tx";
import { explorerTxUrl } from "../src/explorer";

const BUYER = "rBuyerXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const SELLER = "rSellerXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const SERVICE = "rServiceXXXXXXXXXXXXXXXXXXXXXXXXXX";

describe("escrow transaction builders", () => {
  it("builds a conditional EscrowCreate with CancelAfter and no FinishAfter", () => {
    const tx = buildEscrowCreate({
      account: BUYER,
      destination: SELLER,
      amountDrops: "1000000",
      condition: "A0258020AA",
      cancelAfter: 800000180,
    });
    expect(tx).toEqual({
      TransactionType: "EscrowCreate",
      Account: BUYER,
      Destination: SELLER,
      Amount: "1000000",
      Condition: "A0258020AA",
      CancelAfter: 800000180,
    });
    expect("FinishAfter" in tx).toBe(false);
  });

  it("builds an EscrowFinish carrying condition and fulfillment", () => {
    expect(
      buildEscrowFinish({
        account: SERVICE,
        owner: BUYER,
        offerSequence: 42,
        condition: "A0258020AA",
        fulfillment: "A0228020BB",
      }),
    ).toEqual({
      TransactionType: "EscrowFinish",
      Account: SERVICE,
      Owner: BUYER,
      OfferSequence: 42,
      Condition: "A0258020AA",
      Fulfillment: "A0228020BB",
    });
  });

  it("builds an EscrowCancel", () => {
    expect(buildEscrowCancel({ account: SERVICE, owner: BUYER, offerSequence: 42 })).toEqual({
      TransactionType: "EscrowCancel",
      Account: SERVICE,
      Owner: BUYER,
      OfferSequence: 42,
    });
  });

  it("links to the testnet explorer", () => {
    expect(explorerTxUrl("ABC")).toBe("https://testnet.xrpl.org/transactions/ABC");
  });
});
