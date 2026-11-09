import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "xrpl";
import { type AuthorizationPayload, signAuthorization } from "@surety/contracts";
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
