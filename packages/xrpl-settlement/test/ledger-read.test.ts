import { describe, expect, it } from "vitest";
import type { Client } from "xrpl";
import { getEscrow, getTrustLine } from "../src/ledger-read";
import { TESTUSD_CURRENCY_HEX } from "../src/token";

const OWNER = "rBuyerXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const SELLER = "rSellerXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const ISSUER = "rIssuerXXXXXXXXXXXXXXXXXXXXXXXXXX";

function stub(handler: (req: Record<string, unknown>) => unknown): Client {
  return { request: async (req: Record<string, unknown>) => handler(req) } as unknown as Client;
}

const notFound = (code: string) => Object.assign(new Error(code), { data: { error: code } });

describe("getEscrow", () => {
  it("returns a TESTUSD amount", async () => {
    const amount = { currency: TESTUSD_CURRENCY_HEX, issuer: ISSUER, value: "48000" };
    const client = stub(() => ({
      result: { node: { Account: OWNER, Destination: SELLER, Amount: amount, Condition: "A025", CancelAfter: 5 } },
    }));
    expect(await getEscrow(client, OWNER, 7)).toEqual({
      Account: OWNER,
      Destination: SELLER,
      Amount: amount,
      Condition: "A025",
      CancelAfter: 5,
    });
  });

  it("still returns an XRP amount", async () => {
    const client = stub(() => ({ result: { node: { Account: OWNER, Destination: SELLER, Amount: "1000000" } } }));
    expect((await getEscrow(client, OWNER, 7))?.Amount).toBe("1000000");
  });

  it("throws on an MPT amount", async () => {
    const client = stub(() => ({
      result: { node: { Account: OWNER, Destination: SELLER, Amount: { mpt_issuance_id: "00AB", value: "5" } } },
    }));
    await expect(getEscrow(client, OWNER, 7)).rejects.toThrow("escrow holds an unsupported amount");
  });

  it("returns null when the escrow is gone", async () => {
    const client = stub(() => {
      throw notFound("entryNotFound");
    });
    expect(await getEscrow(client, OWNER, 7)).toBeNull();
  });
});

describe("getTrustLine", () => {
  it("returns null when the account has no TESTUSD line", async () => {
    const client = stub(() => ({ result: { lines: [{ currency: "USD", balance: "5", limit: "10", account: ISSUER }] } }));
    expect(await getTrustLine(client, SELLER, ISSUER, TESTUSD_CURRENCY_HEX)).toBeNull();
  });

  it("maps balance, limit and freeze_peer, asking the validated ledger for lines with the issuer", async () => {
    let seen: Record<string, unknown> = {};
    const client = stub((req) => {
      seen = req;
      return {
        result: {
          lines: [{ currency: TESTUSD_CURRENCY_HEX, balance: "48000", limit: "1000000000", account: ISSUER, freeze_peer: true }],
        },
      };
    });
    expect(await getTrustLine(client, SELLER, ISSUER, TESTUSD_CURRENCY_HEX)).toEqual({
      balance: "48000",
      limit: "1000000000",
      frozenByIssuer: true,
    });
    expect(seen).toMatchObject({ command: "account_lines", account: SELLER, peer: ISSUER, ledger_index: "validated" });
  });

  it("reports an unfrozen line when freeze_peer is absent", async () => {
    const client = stub(() => ({
      result: { lines: [{ currency: TESTUSD_CURRENCY_HEX, balance: "0", limit: "1000", account: ISSUER }] },
    }));
    expect((await getTrustLine(client, SELLER, ISSUER, TESTUSD_CURRENCY_HEX))?.frozenByIssuer).toBe(false);
  });

  it("returns null for actNotFound", async () => {
    const client = stub(() => {
      throw notFound("actNotFound");
    });
    expect(await getTrustLine(client, SELLER, ISSUER, TESTUSD_CURRENCY_HEX)).toBeNull();
  });

  it("rethrows any other ledger error", async () => {
    const client = stub(() => {
      throw new Error("socket closed");
    });
    await expect(getTrustLine(client, SELLER, ISSUER, TESTUSD_CURRENCY_HEX)).rejects.toThrow("socket closed");
  });
});
