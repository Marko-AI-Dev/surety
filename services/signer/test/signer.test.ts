import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "xrpl";
import { type AuthorizationPayload, signAuthorization } from "@surety/contracts";
import { testUsdAmount } from "@surety/xrpl-settlement";
import { type Signer, createSigner } from "../src/signer";
import type { SignerConfig } from "../src/config";
import { FakeLedger } from "./fake-ledger";

const GATE_SECRET = "gate-secret-for-signer-tests-0123456789";
const AUTH_NOW = new Date("2026-11-08T15:00:00.000Z");
const CLOSE = 800_000_000;

let dataDir: string;
let ledger: FakeLedger;
let buyer: Wallet;
let service: Wallet;
let seller: string;
let config: SignerConfig;

function makeSigner(): Signer {
  return createSigner({ config, ledger, buyer, service, now: () => AUTH_NOW });
}

function createReq(overrides: Record<string, unknown> = {}) {
  return {
    opId: randomUUID(),
    jobRef: "job-A",
    destination: seller,
    amountDrops: "1000000",
    cancelAfterSeconds: 180,
    ...overrides,
  };
}

function authFor(offerSequence: number, overrides: Partial<AuthorizationPayload> = {}) {
  return signAuthorization(
    {
      network: "testnet",
      owner: buyer.classicAddress,
      offerSequence,
      amountDrops: "1000000",
      destination: seller,
      jobSnapshotHash: "a".repeat(64),
      deliverableHash: "b".repeat(64),
      policyVersion: "test-0",
      decisionId: "decision-1",
      expiresAt: new Date(AUTH_NOW.getTime() + 60_000).toISOString(),
      nonce: randomBytes(16).toString("hex"),
      ...overrides,
    },
    GATE_SECRET,
  );
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "surety-signer-"));
  ledger = new FakeLedger(CLOSE);
  buyer = Wallet.generate();
  service = Wallet.generate();
  seller = Wallet.generate().classicAddress;
  config = {
    preimageKey: randomBytes(32),
    hmacSecret: "h".repeat(40),
    gateSecret: GATE_SECRET,
    wsUrl: "wss://s.altnet.rippletest.net:51233/",
    allowlist: [seller],
    maxJobDrops: 2_000_000n,
    minCancelSeconds: 60,
    maxCancelSeconds: 86_400,
    finishMarginSeconds: 5,
    port: 4100,
    dataDir,
    testUsd: null,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createEscrow", () => {
  it("locks funds from the buyer with a condition and ledger-time CancelAfter, never revealing the fulfillment", async () => {
    const res = await makeSigner().createEscrow(createReq());
    expect(res.result).toBe("tesSUCCESS");
    expect(res.owner).toBe(buyer.classicAddress);
    expect(res.condition.startsWith("A0258020")).toBe(true);
    expect(res.cancelAfter).toBe(CLOSE + 180);
    expect(ledger.escrows.get(`${buyer.classicAddress}:${res.offerSequence}`)?.Amount).toBe("1000000");
    expect(JSON.stringify(res)).not.toMatch(/fulfil/i);
    expect(ledger.submitted[0]?.Account).toBe(buyer.classicAddress);
  });

  it("refuses a destination that is not allowlisted", async () => {
    await expectCode(
      makeSigner().createEscrow(createReq({ destination: Wallet.generate().classicAddress })),
      "destination_not_allowed",
    );
    expect(ledger.submitted).toHaveLength(0);
  });

  it("refuses an amount over the per-job cap", async () => {
    await expectCode(makeSigner().createEscrow(createReq({ amountDrops: "2000001" })), "amount_over_cap");
    expect(ledger.submitted).toHaveLength(0);
  });

  it.each([59, 86_401])("refuses a cancel window of %i seconds", async (seconds) => {
    await expectCode(
      makeSigner().createEscrow(createReq({ cancelAfterSeconds: seconds })),
      "cancel_window_invalid",
    );
  });

  it("refuses malformed requests", async () => {
    await expectCode(makeSigner().createEscrow({ ...createReq(), amountDrops: "1.5" }), "bad_request");
    await expectCode(makeSigner().createEscrow({ ...createReq(), extra: "field" }), "bad_request");
  });

  it("records a validated non-success result as a conclusive failure, and replays it as one", async () => {
    ledger.nextResult = "tecUNFUNDED";
    const req = createReq();
    await expect(makeSigner().createEscrow(req)).rejects.toMatchObject({
      code: "op_failed",
      status: 409,
      message: expect.stringContaining("tecUNFUNDED"),
    });
    const journal = JSON.parse(readFileSync(join(dataDir, "journal.json"), "utf8"));
    expect(journal[req.opId].status).toBe("failed");
    await expectCode(makeSigner().createEscrow(req), "op_failed");
    expect(ledger.count("EscrowCreate")).toBe(1);
  });
});

describe("finishEscrow", () => {
  it("pays the seller from the service account with the stored fulfillment", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const res = await signer.finishEscrow({ opId: randomUUID(), authorization: authFor(created.offerSequence) });
    expect(res.result).toBe("tesSUCCESS");
    const finish = ledger.submitted.find((t) => t.TransactionType === "EscrowFinish");
    expect(finish?.Account).toBe(service.classicAddress);
    expect(ledger.escrows.size).toBe(0);
    expect(JSON.stringify(res)).not.toMatch(/fulfil/i);
  });

  it("finishes an escrow created before a signer restart", async () => {
    const created = await makeSigner().createEscrow(createReq());
    const restarted = makeSigner();
    const res = await restarted.finishEscrow({ opId: randomUUID(), authorization: authFor(created.offerSequence) });
    expect(res.result).toBe("tesSUCCESS");
  });

  it("uses an authorization only once, even under concurrent calls", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const auth = authFor(created.offerSequence);
    const results = await Promise.allSettled([
      signer.finishEscrow({ opId: randomUUID(), authorization: auth }),
      signer.finishEscrow({ opId: randomUUID(), authorization: auth }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "authorization_consumed" });
    expect(ledger.count("EscrowFinish")).toBe(1);
    await expectCode(signer.finishEscrow({ opId: randomUUID(), authorization: auth }), "authorization_consumed");
  });

  it("rejects a tampered authorization", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const auth = authFor(created.offerSequence);
    const tampered = { ...auth, payload: { ...auth.payload, amountDrops: "1500000" } };
    await expectCode(signer.finishEscrow({ opId: randomUUID(), authorization: tampered }), "authorization_invalid");
    expect(ledger.count("EscrowFinish")).toBe(0);
  });

  it("rejects a valid authorization that does not match the escrow on the ledger", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    await expectCode(
      signer.finishEscrow({ opId: randomUUID(), authorization: authFor(created.offerSequence, { amountDrops: "999999" }) }),
      "escrow_mismatch",
    );
    await expectCode(
      signer.finishEscrow({
        opId: randomUUID(),
        authorization: authFor(created.offerSequence, { destination: Wallet.generate().classicAddress }),
      }),
      "escrow_mismatch",
    );
    await expectCode(signer.finishEscrow({ opId: randomUUID(), authorization: authFor(9999) }), "escrow_not_found");
    expect(ledger.count("EscrowFinish")).toBe(0);
  });

  it("refuses to finish near expiry by ledger time, whatever the laptop clock says", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2001-01-01T00:00:00Z"));
    ledger.closeTime = created.cancelAfter - 5;
    await expectCode(
      signer.finishEscrow({ opId: randomUUID(), authorization: authFor(created.offerSequence) }),
      "finish_window_closed",
    );
  });

  it("does not sign twice when a submit fails and the same opId is retried", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const req = { opId: randomUUID(), authorization: authFor(created.offerSequence) };
    ledger.throwOnNextSubmit = true;
    await expectCode(signer.finishEscrow(req), "ledger_failure");
    const res = await signer.finishEscrow(req);
    expect(res.result).toBe("tesSUCCESS");
    expect(ledger.count("EscrowFinish")).toBe(1);
    expect(ledger.lookups).toHaveLength(1);
  });

  it("marks a journaled finish that never reached the ledger as failed once LastLedgerSequence has passed", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const req = { opId: randomUUID(), authorization: authFor(created.offerSequence) };
    ledger.dropNextSubmit = true;
    await expectCode(signer.finishEscrow(req), "ledger_failure");
    await expectCode(signer.finishEscrow(req), "op_pending");
    ledger.ledgerIndex += 50;
    await expectCode(signer.finishEscrow(req), "op_failed");
    const journal = JSON.parse(readFileSync(join(dataDir, "journal.json"), "utf8"));
    expect(journal[req.opId].status).toBe("failed");
    await expectCode(signer.finishEscrow(req), "op_failed");
    expect(ledger.count("EscrowFinish")).toBe(0);
    expect(ledger.escrows.size).toBe(1);
  });

  it("does not mark a finish failed when it validates between reading the ledger and looking up the hash", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const req = { opId: randomUUID(), authorization: authFor(created.offerSequence) };
    ledger.holdNextSubmit = true;
    await expectCode(signer.finishEscrow(req), "ledger_failure");
    // While the signer reads the ledger height, the held finish validates and the ledger moves past LastLedgerSequence.
    ledger.onIndexRead = () => {
      ledger.releaseHeld();
      ledger.ledgerIndex += 50;
    };
    const res = await signer.finishEscrow(req);
    expect(res.result).toBe("tesSUCCESS");
    const journal = JSON.parse(readFileSync(join(dataDir, "journal.json"), "utf8"));
    expect(journal[req.opId].status).toBe("done");
  });

  it("keeps a never-validated finish pending when the node cannot confirm it searched the whole ledger range", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const req = { opId: randomUUID(), authorization: authFor(created.offerSequence) };
    ledger.dropNextSubmit = true;
    await expectCode(signer.finishEscrow(req), "ledger_failure");
    ledger.ledgerIndex += 50;
    ledger.historyGap = true;
    await expectCode(signer.finishEscrow(req), "op_pending");
    const range = ledger.lookupRanges.at(-1);
    expect(range?.maxLedger).toBeGreaterThan(range?.minLedger ?? Number.POSITIVE_INFINITY);
  });

  it("lets the same request retry when preparing the transaction failed before anything was signed", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const auth = authFor(created.offerSequence);
    const req = { opId: randomUUID(), authorization: auth };
    ledger.throwOnNextAutofill = true;
    await expectCode(signer.finishEscrow(req), "ledger_failure");
    const res = await signer.finishEscrow(req);
    expect(res.result).toBe("tesSUCCESS");
    expect(ledger.count("EscrowFinish")).toBe(1);
    await expectCode(signer.finishEscrow({ opId: randomUUID(), authorization: auth }), "authorization_consumed");
  });

  it("refuses to finish when the ledger's CancelAfter or owner disagrees with the signer's record", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const key = `${buyer.classicAddress}:${created.offerSequence}`;
    const entry = ledger.escrows.get(key);
    if (!entry) throw new Error("escrow missing from fake ledger");
    ledger.escrows.set(key, { ...entry, CancelAfter: created.cancelAfter + 1000 });
    await expectCode(
      signer.finishEscrow({ opId: randomUUID(), authorization: authFor(created.offerSequence) }),
      "escrow_mismatch",
    );
    ledger.escrows.set(key, { ...entry, Account: service.classicAddress });
    await expectCode(
      signer.finishEscrow({ opId: randomUUID(), authorization: authFor(created.offerSequence) }),
      "escrow_mismatch",
    );
    expect(ledger.count("EscrowFinish")).toBe(0);
  });

  it("treats the same opId with a different body as a conflict", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq());
    const opId = randomUUID();
    await signer.finishEscrow({ opId, authorization: authFor(created.offerSequence) });
    await expectCode(signer.finishEscrow({ opId, authorization: authFor(created.offerSequence) }), "op_conflict");
  });
});

describe("cancelEscrow", () => {
  it("refuses before ledger close time passes CancelAfter, even if the laptop clock is far ahead", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq({ cancelAfterSeconds: 60 }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    ledger.closeTime = created.cancelAfter;
    await expectCode(
      signer.cancelEscrow({ opId: randomUUID(), owner: created.owner, offerSequence: created.offerSequence }),
      "cancel_not_yet_eligible",
    );
    expect(ledger.count("EscrowCancel")).toBe(0);
  });

  it("refunds from the service account once ledger time passes CancelAfter, even if the laptop clock is behind", async () => {
    const signer = makeSigner();
    const created = await signer.createEscrow(createReq({ cancelAfterSeconds: 60 }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2001-01-01T00:00:00Z"));
    ledger.closeTime = created.cancelAfter + 1;
    const res = await signer.cancelEscrow({
      opId: randomUUID(),
      owner: created.owner,
      offerSequence: created.offerSequence,
    });
    expect(res.result).toBe("tesSUCCESS");
    const cancel = ledger.submitted.find((t) => t.TransactionType === "EscrowCancel");
    expect(cancel?.Account).toBe(service.classicAddress);
    expect(ledger.escrows.size).toBe(0);
  });

  it("refuses an escrow this signer did not create", async () => {
    await expectCode(
      makeSigner().cancelEscrow({ opId: randomUUID(), owner: buyer.classicAddress, offerSequence: 77 }),
      "escrow_not_found",
    );
  });
});

describe("createEscrow in TESTUSD", () => {
  let issuer: string;
  let supplier: string;

  function testUsdConfig(overrides: Partial<NonNullable<SignerConfig["testUsd"]>> = {}) {
    issuer = issuer ?? Wallet.generate().classicAddress;
    config = {
      ...config,
      testUsd: {
        issuer,
        approvedSuppliers: [supplier],
        maxDealCents: 10_000_000n,
        dailyCents: 100_000_000n,
        maxOpenDeals: 50,
        operatorSecret: "o".repeat(40),
        ...overrides,
      },
    };
  }

  function readyLines(treasuryBalance = "1000000") {
    ledger.trustLines.set(`${buyer.classicAddress}:${issuer}`, {
      balance: treasuryBalance,
      limit: "1000000000",
      frozenByIssuer: false,
    });
    ledger.trustLines.set(`${supplier}:${issuer}`, { balance: "0", limit: "1000000000", frozenByIssuer: false });
  }

  const usdReq = (overrides: Record<string, unknown> = {}) => {
    const { amountDrops: _drops, ...rest } = createReq({ destination: supplier });
    return { ...rest, amountTestUsdCents: "4800000", ...overrides };
  };

  beforeEach(() => {
    issuer = Wallet.generate().classicAddress;
    supplier = Wallet.generate().classicAddress;
    testUsdConfig();
    readyLines();
  });

  it("locks TESTUSD from the treasury with a condition and ledger-time CancelAfter", async () => {
    const res = await makeSigner().createEscrow(usdReq());
    expect(res.result).toBe("tesSUCCESS");
    expect(res.issuer).toBe(issuer);
    expect(res.cancelAfter).toBe(CLOSE + 180);
    expect(ledger.submitted[0]?.Account).toBe(buyer.classicAddress);
    expect(ledger.submitted[0]?.Amount).toEqual(testUsdAmount(issuer, "4800000"));
    expect(ledger.escrows.get(`${buyer.classicAddress}:${res.offerSequence}`)?.Amount).toEqual(
      testUsdAmount(issuer, "4800000"),
    );
    expect(JSON.stringify(res)).not.toMatch(/fulfil/i);
  });

  it("refuses TESTUSD when no issuer is configured", async () => {
    config = { ...config, testUsd: null };
    await expectCode(makeSigner().createEscrow(usdReq()), "asset_not_enabled");
    expect(ledger.submitted).toHaveLength(0);
  });

  it("refuses a TESTUSD lock to an address on the XRP allowlist but not an approved supplier", async () => {
    await expectCode(makeSigner().createEscrow(usdReq({ destination: seller })), "destination_not_allowed");
    expect(ledger.submitted).toHaveLength(0);
  });

  it("refuses a TESTUSD lock over the per-deal cap, and locks exactly at it", async () => {
    await expectCode(makeSigner().createEscrow(usdReq({ amountTestUsdCents: "10000001" })), "amount_over_cap");
    expect(ledger.submitted).toHaveLength(0);
    readyLines("1000000000");
    const res = await makeSigner().createEscrow(usdReq({ amountTestUsdCents: "10000000" }));
    expect(res.result).toBe("tesSUCCESS");
  });

  it("names the per-deal cap in dollars", async () => {
    await expect(makeSigner().createEscrow(usdReq({ amountTestUsdCents: "10000001" }))).rejects.toThrow(
      "amount exceeds the per-deal cap of $100,000",
    );
  });

  it("refuses a destination without a TESTUSD trust line", async () => {
    ledger.trustLines.delete(`${supplier}:${issuer}`);
    await expectCode(makeSigner().createEscrow(usdReq()), "destination_not_ready");
    expect(ledger.submitted).toHaveLength(0);
  });

  it("refuses a destination whose trust line limit leaves no room", async () => {
    ledger.trustLines.set(`${supplier}:${issuer}`, { balance: "990000", limit: "1000000", frozenByIssuer: false });
    await expectCode(makeSigner().createEscrow(usdReq()), "destination_not_ready");
    expect(ledger.submitted).toHaveLength(0);
  });

  it("refuses a destination whose trust line the issuer froze", async () => {
    ledger.trustLines.set(`${supplier}:${issuer}`, { balance: "0", limit: "1000000000", frozenByIssuer: true });
    await expectCode(makeSigner().createEscrow(usdReq()), "destination_not_ready");
    expect(ledger.submitted).toHaveLength(0);
  });

  it("refuses when the treasury holds less TESTUSD than the amount", async () => {
    readyLines("47999.99");
    await expectCode(makeSigner().createEscrow(usdReq()), "insufficient_funds");
    expect(ledger.submitted).toHaveLength(0);
  });

  it("refuses when the treasury has no TESTUSD line at all", async () => {
    ledger.trustLines.delete(`${buyer.classicAddress}:${issuer}`);
    await expectCode(makeSigner().createEscrow(usdReq()), "insufficient_funds");
  });

  it("a failed trust-line read refuses with ledger_failure, signs nothing, and the same opId then locks", async () => {
    const req = usdReq();
    ledger.throwOnNextTrustLine = true;
    await expectCode(makeSigner().createEscrow(req), "ledger_failure");
    expect(ledger.submitted).toHaveLength(0);
    const res = await makeSigner().createEscrow(req);
    expect(res.result).toBe("tesSUCCESS");
  });

  it("refuses a body with both amountDrops and amountTestUsdCents", async () => {
    await expectCode(makeSigner().createEscrow(usdReq({ amountDrops: "1000000" })), "bad_request");
  });

  it("still locks XRP to the allowlist with TESTUSD configured", async () => {
    const res = await makeSigner().createEscrow(createReq());
    expect(res.result).toBe("tesSUCCESS");
    expect(res.issuer).toBeUndefined();
    expect(ledger.submitted[0]?.Amount).toBe("1000000");
  });
});

describe("TESTUSD caps", () => {
  let issuer: string;
  let supplier: string;

  function caps(overrides: Partial<NonNullable<SignerConfig["testUsd"]>> = {}) {
    config = {
      ...config,
      testUsd: {
        issuer,
        approvedSuppliers: [supplier],
        maxDealCents: 10_000_000n,
        dailyCents: 25_000_000n,
        maxOpenDeals: 50,
        operatorSecret: "o".repeat(40),
        ...overrides,
      },
    };
  }

  const lock = (cents: string, signer = makeSigner()) => {
    const { amountDrops: _drops, ...rest } = createReq({ destination: supplier });
    return signer.createEscrow({ ...rest, amountTestUsdCents: cents });
  };

  beforeEach(() => {
    issuer = Wallet.generate().classicAddress;
    supplier = Wallet.generate().classicAddress;
    caps();
    ledger.trustLines.set(`${buyer.classicAddress}:${issuer}`, { balance: "10000000", limit: "1000000000", frozenByIssuer: false });
    ledger.trustLines.set(`${supplier}:${issuer}`, { balance: "0", limit: "1000000000", frozenByIssuer: false });
  });

  it("refuses a TESTUSD lock that would take the rolling 24-hour total past the daily cap", async () => {
    await lock("9500000");
    await lock("9500000");
    await expectCode(lock("6000001"), "daily_cap_reached");
    expect((await lock("6000000")).result).toBe("tesSUCCESS");
  });

  it("names the daily cap in dollars", async () => {
    await lock("9500000");
    await lock("9500000");
    await expect(lock("6000001")).rejects.toThrow("$250,000");
  });

  it("frees daily capacity once a lock is more than 24 hours old by ledger time, whatever the laptop clock says", async () => {
    await lock("9500000");
    await lock("9500000");
    await lock("6000000");
    await expectCode(lock("1"), "daily_cap_reached");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 3 * 86_400_000));
    await expectCode(lock("1"), "daily_cap_reached");
    vi.useRealTimers();
    ledger.closeTime = CLOSE + 86_401;
    expect((await lock("6000000")).result).toBe("tesSUCCESS");
  });

  it("counts refunded deals toward the daily cap", async () => {
    const a = await lock("9500000");
    await lock("9500000");
    ledger.closeTime = CLOSE + 181;
    await makeSigner().cancelEscrow({ opId: randomUUID(), owner: a.owner, offerSequence: a.offerSequence });
    await expectCode(lock("6000001"), "daily_cap_reached");
  });

  it("refuses a TESTUSD lock when the open-deal limit is reached, and allows one after a deal is refunded", async () => {
    caps({ maxOpenDeals: 2 });
    const a = await lock("100");
    await lock("100");
    await expectCode(lock("100"), "open_deal_limit_reached");
    ledger.closeTime = CLOSE + 181;
    await makeSigner().cancelEscrow({ opId: randomUUID(), owner: a.owner, offerSequence: a.offerSequence });
    expect((await lock("100")).result).toBe("tesSUCCESS");
  });

  it("counts a submitted-but-unvalidated lock toward both caps", async () => {
    caps({ maxOpenDeals: 1, dailyCents: 5_000_000n });
    ledger.holdNextSubmit = true;
    await expectCode(lock("4000000"), "ledger_failure");
    await expectCode(lock("1"), "open_deal_limit_reached");
    caps({ maxOpenDeals: 50, dailyCents: 5_000_000n });
    await expectCode(lock("2000000"), "daily_cap_reached");
  });

  it("does not count a lock that failed on the ledger", async () => {
    caps({ maxOpenDeals: 1 });
    ledger.nextResult = "tecUNFUNDED";
    await expectCode(lock("100"), "op_failed");
    expect((await lock("100")).result).toBe("tesSUCCESS");
  });

  it("XRP locks are unaffected by TESTUSD caps", async () => {
    caps({ maxOpenDeals: 1, dailyCents: 1n });
    for (let i = 0; i < 6; i++) {
      expect((await makeSigner().createEscrow(createReq())).result).toBe("tesSUCCESS");
    }
  });

  it("two concurrent locks that together exceed the daily cap: exactly one succeeds", async () => {
    caps({ dailyCents: 15_000_000n });
    const signer = makeSigner();
    const results = await Promise.allSettled([lock("9000000", signer), lock("9000000", signer)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "daily_cap_reached" });
  });

  it("the daily total and open count survive a signer restart", async () => {
    caps({ maxOpenDeals: 2 });
    await lock("9500000", makeSigner());
    await lock("9500000", makeSigner());
    const restarted = makeSigner();
    await expectCode(lock("1", restarted), "open_deal_limit_reached");
    caps({ maxOpenDeals: 50 });
    await expectCode(lock("6000001", makeSigner()), "daily_cap_reached");
  });
});

describe("finish, cancel and health for TESTUSD", () => {
  let issuer: string;
  let supplier: string;

  function usdConfig(overrides: Partial<NonNullable<SignerConfig["testUsd"]>> = {}) {
    config = {
      ...config,
      testUsd: {
        issuer,
        approvedSuppliers: [supplier],
        maxDealCents: 10_000_000n,
        dailyCents: 25_000_000n,
        maxOpenDeals: 50,
        operatorSecret: "o".repeat(40),
        ...overrides,
      },
    };
  }

  const lock = (cents = "4800000") => {
    const { amountDrops: _drops, ...rest } = createReq({ destination: supplier });
    return makeSigner().createEscrow({ ...rest, amountTestUsdCents: cents });
  };

  function usdAuthFor(offerSequence: number, cents = "4800000", overrides: Record<string, unknown> = {}) {
    const { payload } = authFor(offerSequence, { destination: supplier });
    const { amountDrops: _drops, ...rest } = payload;
    return signAuthorization({ ...rest, amountTestUsdCents: cents, ...overrides } as AuthorizationPayload, GATE_SECRET);
  }

  beforeEach(() => {
    issuer = Wallet.generate().classicAddress;
    supplier = Wallet.generate().classicAddress;
    usdConfig();
    ledger.trustLines.set(`${buyer.classicAddress}:${issuer}`, { balance: "10000000", limit: "1000000000", frozenByIssuer: false });
    ledger.trustLines.set(`${supplier}:${issuer}`, { balance: "0", limit: "1000000000", frozenByIssuer: false });
  });

  it("pays a TESTUSD escrow with a matching authorization", async () => {
    const res = await lock();
    const paid = await makeSigner().finishEscrow({ opId: randomUUID(), authorization: usdAuthFor(res.offerSequence) });
    expect(paid.result).toBe("tesSUCCESS");
    expect(ledger.submitted.at(-1)).toMatchObject({ TransactionType: "EscrowFinish", Account: service.classicAddress });
    const records = JSON.parse(readFileSync(join(dataDir, "escrows.json"), "utf8"));
    expect(records[`${buyer.classicAddress}:${res.offerSequence}`].status).toBe("finished");
  });

  it("rejects an XRP-amount authorization for a TESTUSD escrow", async () => {
    const res = await lock();
    await expectCode(
      makeSigner().finishEscrow({ opId: randomUUID(), authorization: authFor(res.offerSequence, { destination: supplier }) }),
      "escrow_mismatch",
    );
  });

  it("rejects an authorization for a different TESTUSD amount", async () => {
    const res = await lock();
    await expectCode(
      makeSigner().finishEscrow({ opId: randomUUID(), authorization: usdAuthFor(res.offerSequence, "4800001") }),
      "escrow_mismatch",
    );
  });

  it.each([
    ["issuer", (a: Record<string, string>) => ({ ...a, issuer: Wallet.generate().classicAddress })],
    ["currency", (a: Record<string, string>) => ({ ...a, currency: "USD" })],
    ["sub-cent value", (a: Record<string, string>) => ({ ...a, value: "48000.001" })],
    ["exponent value", (a: Record<string, string>) => ({ ...a, value: "4.8e4" })],
    ["XRP amount", () => "4800000"],
  ])("rejects when the ledger's %s differs from the record", async (_name, mutate) => {
    const res = await lock();
    const key = `${buyer.classicAddress}:${res.offerSequence}`;
    const entry = ledger.escrows.get(key);
    if (!entry) throw new Error("escrow missing");
    ledger.escrows.set(key, { ...entry, Amount: mutate(entry.Amount as unknown as Record<string, string>) as never });
    await expectCode(
      makeSigner().finishEscrow({ opId: randomUUID(), authorization: usdAuthFor(res.offerSequence) }),
      "escrow_mismatch",
    );
    expect(ledger.count("EscrowFinish")).toBe(0);
  });

  it("refunds a TESTUSD escrow after ledger time passes CancelAfter", async () => {
    const res = await lock();
    ledger.closeTime = CLOSE + 181;
    const refunded = await makeSigner().cancelEscrow({ opId: randomUUID(), owner: res.owner, offerSequence: res.offerSequence });
    expect(refunded.result).toBe("tesSUCCESS");
    expect(ledger.escrows.has(`${buyer.classicAddress}:${res.offerSequence}`)).toBe(false);
  });

  it("a paid TESTUSD deal still counts toward the daily cap and frees an open slot", async () => {
    usdConfig({ maxOpenDeals: 1, dailyCents: 6_000_000n });
    const res = await lock();
    await expectCode(lock("100"), "open_deal_limit_reached");
    await makeSigner().finishEscrow({ opId: randomUUID(), authorization: usdAuthFor(res.offerSequence) });
    await expectCode(lock("1200001"), "daily_cap_reached");
    expect((await lock("1200000")).result).toBe("tesSUCCESS");
  });

  it("an XRP escrow recorded without any asset field still finishes and cancels", async () => {
    const a = await makeSigner().createEscrow(createReq());
    const b = await makeSigner().createEscrow(createReq());
    const records = JSON.parse(readFileSync(join(dataDir, "escrows.json"), "utf8"));
    for (const r of Object.values(records) as Record<string, unknown>[]) {
      expect(r).not.toHaveProperty("asset");
      expect(r).not.toHaveProperty("amountTestUsdCents");
      expect(r).not.toHaveProperty("lockedAtCloseTime");
    }
    const paid = await makeSigner().finishEscrow({ opId: randomUUID(), authorization: authFor(a.offerSequence) });
    expect(paid.result).toBe("tesSUCCESS");
    ledger.closeTime = CLOSE + 181;
    const refunded = await makeSigner().cancelEscrow({ opId: randomUUID(), owner: b.owner, offerSequence: b.offerSequence });
    expect(refunded.result).toBe("tesSUCCESS");
  });

  it("health reports the TESTUSD issuer, approved suppliers and limits, and nothing secret", async () => {
    const health = await makeSigner().health();
    expect(health.testUsd).toEqual({
      issuer,
      currencyHex: "5445535455534400000000000000000000000000",
      approvedSuppliers: [supplier],
      policyVersion: 1,
      limits: { perDealCents: "10000000", dailyCents: "25000000", openDeals: 50 },
    });
    const text = JSON.stringify(health);
    expect(text).not.toContain("o".repeat(40));
    expect(text).not.toContain(config.preimageKey.toString("hex"));
    expect(text).not.toMatch(/seed|secret/i);
  });

  it("health has no TESTUSD section when TESTUSD is off", async () => {
    config = { ...config, testUsd: null };
    expect(await makeSigner().health()).not.toHaveProperty("testUsd");
  });
});

describe("operator policy", () => {
  let issuer: string;
  let supplier: string;
  let other: string;

  const lock = (cents: string, destination = supplier) => {
    const { amountDrops: _drops, ...rest } = createReq({ destination });
    return makeSigner().createEscrow({ ...rest, amountTestUsdCents: cents });
  };

  const policyReq = (version: number, overrides: Record<string, unknown> = {}) => ({
    opId: randomUUID(),
    expectedVersion: version,
    perDealCents: "250000",
    dailyCents: "2500000",
    maxOpenDeals: 5,
    approvedSuppliers: [supplier, other],
    ...overrides,
  });

  beforeEach(() => {
    issuer = Wallet.generate().classicAddress;
    supplier = Wallet.generate().classicAddress;
    other = Wallet.generate().classicAddress;
    config = {
      ...config,
      testUsd: {
        issuer,
        approvedSuppliers: [supplier, other],
        maxDealCents: 250_000n,
        dailyCents: 2_500_000n,
        maxOpenDeals: 5,
        operatorSecret: "o".repeat(40),
      },
    };
    ledger.trustLines.set(`${buyer.classicAddress}:${issuer}`, { balance: "1000000", limit: "1000000000", frozenByIssuer: false });
    ledger.trustLines.set(`${supplier}:${issuer}`, { balance: "0", limit: "1000000000", frozenByIssuer: false });
    ledger.trustLines.set(`${other}:${issuer}`, { balance: "0", limit: "1000000000", frozenByIssuer: false });
  });

  it("lowering the per-deal cap applies to the next lock", async () => {
    expect((await lock("200000")).result).toBe("tesSUCCESS");
    const view = await makeSigner().updatePolicy(policyReq(1, { perDealCents: "100000" }));
    expect(view.version).toBe(2);
    await expectCode(lock("200000"), "amount_over_cap");
    expect((await lock("100000")).result).toBe("tesSUCCESS");
  });

  it("removing a supplier blocks new locks to it but its locked deal still pays", async () => {
    const res = await lock("200000");
    await makeSigner().updatePolicy(policyReq(1, { approvedSuppliers: [other] }));
    await expectCode(lock("100"), "destination_not_allowed");
    const { payload } = authFor(res.offerSequence, { destination: supplier });
    const { amountDrops: _drops, ...rest } = payload;
    const auth = signAuthorization({ ...rest, amountTestUsdCents: "200000" } as AuthorizationPayload, GATE_SECRET);
    const paid = await makeSigner().finishEscrow({ opId: randomUUID(), authorization: auth });
    expect(paid.result).toBe("tesSUCCESS");
  });

  it("raising the daily cap frees capacity immediately", async () => {
    await makeSigner().updatePolicy(policyReq(1, { perDealCents: "200000", dailyCents: "300000" }));
    await lock("200000");
    await expectCode(lock("150000"), "daily_cap_reached");
    await makeSigner().updatePolicy(policyReq(2, { perDealCents: "200000", dailyCents: "400000" }));
    expect((await lock("150000")).result).toBe("tesSUCCESS");
  });

  it("health reports the live policy and its version", async () => {
    await makeSigner().updatePolicy(policyReq(1, { perDealCents: "100000", maxOpenDeals: 3, approvedSuppliers: [other] }));
    const health = await makeSigner().health();
    expect(health.testUsd).toMatchObject({
      policyVersion: 2,
      approvedSuppliers: [other],
      limits: { perDealCents: "100000", dailyCents: "2500000", openDeals: 3 },
    });
  });

  it("refuses a policy update when TESTUSD is off", async () => {
    config = { ...config, testUsd: null };
    await expectCode(makeSigner().updatePolicy(policyReq(1)), "asset_not_enabled");
  });

  it("a lock queued before a cap cut is judged by the old policy only", async () => {
    const signer = makeSigner();
    const [locked, updated] = await Promise.allSettled([
      (async () => {
        const { amountDrops: _drops, ...rest } = createReq({ destination: supplier });
        return signer.createEscrow({ ...rest, amountTestUsdCents: "200000" });
      })(),
      signer.updatePolicy(policyReq(1, { perDealCents: "100000" })),
    ]);
    expect(locked.status).toBe("fulfilled");
    expect(updated.status).toBe("fulfilled");
    await expectCode(lock("200000"), "amount_over_cap");
  });

  it("a lock queued after a cap cut is judged by the new policy only", async () => {
    const signer = makeSigner();
    const [updated, locked] = await Promise.allSettled([
      signer.updatePolicy(policyReq(1, { perDealCents: "100000" })),
      (async () => {
        const { amountDrops: _drops, ...rest } = createReq({ destination: supplier });
        return signer.createEscrow({ ...rest, amountTestUsdCents: "200000" });
      })(),
    ]);
    expect(updated.status).toBe("fulfilled");
    expect(locked.status).toBe("rejected");
    expect((locked as PromiseRejectedResult).reason).toMatchObject({ code: "amount_over_cap" });
  });
});

describe("review fixes", () => {
  let issuer: string;
  let supplier: string;

  beforeEach(() => {
    issuer = Wallet.generate().classicAddress;
    supplier = Wallet.generate().classicAddress;
    config = {
      ...config,
      testUsd: {
        issuer,
        approvedSuppliers: [supplier],
        maxDealCents: 250_000n,
        dailyCents: 2_500_000n,
        maxOpenDeals: 1,
        operatorSecret: "o".repeat(40),
      },
    };
    ledger.trustLines.set(`${buyer.classicAddress}:${issuer}`, { balance: "1000000", limit: "1000000000", frozenByIssuer: false });
    ledger.trustLines.set(`${supplier}:${issuer}`, { balance: "0", limit: "1000000000", frozenByIssuer: false });
  });

  const lock = (cents = "100") => {
    const { amountDrops: _drops, ...rest } = createReq({ destination: supplier });
    return makeSigner().createEscrow({ ...rest, amountTestUsdCents: cents });
  };

  it("a stuck create that can never validate stops holding its open slot once its LastLedgerSequence has passed", async () => {
    ledger.holdNextSubmit = true;
    await expectCode(lock(), "ledger_failure");
    await expectCode(lock(), "open_deal_limit_reached");
    ledger.ledgerIndex += 30;
    expect((await lock()).result).toBe("tesSUCCESS");
  });

  it("a stuck create that did validate is recorded and keeps its open slot", async () => {
    ledger.holdNextSubmit = true;
    await expectCode(lock(), "ledger_failure");
    ledger.releaseHeld();
    ledger.ledgerIndex += 30;
    await expectCode(lock(), "open_deal_limit_reached");
    const records = JSON.parse(readFileSync(join(dataDir, "escrows.json"), "utf8"));
    expect(Object.values(records).filter((r) => (r as { status: string }).status === "locked")).toHaveLength(1);
  });

  it("refuses a policy update naming a supplier address with a bad checksum", async () => {
    const good = supplier;
    const typo = `${good.slice(0, -1)}${good.endsWith("a") ? "b" : "a"}`;
    await expectCode(
      makeSigner().updatePolicy({
        opId: randomUUID(),
        expectedVersion: 1,
        perDealCents: "250000",
        dailyCents: "2500000",
        maxOpenDeals: 5,
        approvedSuppliers: [good, typo],
      }),
      "bad_request",
    );
    expect((await makeSigner().health()).testUsd?.policyVersion).toBe(1);
  });
});

describe("starting policy and crash safety", () => {
  let issuer: string;
  let supplier: string;

  beforeEach(() => {
    issuer = Wallet.generate().classicAddress;
    supplier = Wallet.generate().classicAddress;
    config = {
      ...config,
      testUsd: {
        issuer,
        approvedSuppliers: [supplier],
        maxDealCents: 250_000n,
        dailyCents: 2_500_000n,
        maxOpenDeals: 2,
        operatorSecret: "o".repeat(40),
      },
    };
    ledger.trustLines.set(`${buyer.classicAddress}:${issuer}`, { balance: "1000000", limit: "1000000000", frozenByIssuer: false });
    ledger.trustLines.set(`${supplier}:${issuer}`, { balance: "0", limit: "1000000000", frozenByIssuer: false });
  });

  const lock = () => {
    const { amountDrops: _drops, ...rest } = createReq({ destination: supplier });
    return makeSigner().createEscrow({ ...rest, amountTestUsdCents: "100" });
  };

  it.each(["treasury", "service", "issuer"])("refuses to start with the %s among the starting approved suppliers", (who) => {
    const address = who === "treasury" ? buyer.classicAddress : who === "service" ? service.classicAddress : issuer;
    config = { ...config, testUsd: { ...(config.testUsd as NonNullable<SignerConfig["testUsd"]>), approvedSuppliers: [supplier, address] } };
    expect(() => makeSigner()).toThrow(/APPROVED_SUPPLIERS cannot include the treasury, the service account or the issuer/);
  });

  it("a deal recorded as locked whose journal entry still says submitted (a crash between the two writes) counts once", async () => {
    const res = await lock();
    const journalPath = join(dataDir, "journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal[res.opId].status = "submitted";
    writeFileSync(journalPath, JSON.stringify(journal));
    expect((await lock()).result).toBe("tesSUCCESS");
    await expectCode(lock(), "open_deal_limit_reached");
  });
});
