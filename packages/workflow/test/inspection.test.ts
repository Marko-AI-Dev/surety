import { beforeEach, describe, expect, it } from "vitest";
import type { SourcingBrief } from "@surety/contracts";
import type { DecisionEngine, EvaluationResult } from "@surety/gate";
import {
  AttestationConflict,
  type SourcingDeps,
  InspectionNotFound,
  attest,
  commitQuote,
  createMemoryRepo,
  decideQuote,
  inspectionOf,
  inspectorQueue,
  inviteSupplier,
  leadDecision,
  openDeal,
  openSourcing,
  ruleFollowingDecider,
  selectSupplier,
  submitQuote,
  submitSettlement,
} from "../src/index";
import { FakeSigner } from "./fake-signer";
import { SUPPLIER, SUPPLIER_NAME, intent as baseIntent, quote } from "../../../scripts/deal-fixtures";

const CLOSE = 800_000_000;
const INSPECTOR = "Port inspector (demo)";

const clean: DecisionEngine = {
  mode: "fixture",
  async evaluate(input): Promise<EvaluationResult> {
    return {
      status: "ok",
      mode: "fixture",
      satisfaction: 0.95,
      injectionRisk: 0.03,
      provider: "fixture",
      model: "fixture",
      latencyMs: 1,
      reasonCodes: [],
      requestId: input.requestId,
      evaluatedAt: new Date().toISOString(),
      costUsd: null,
    };
  },
};

let signer: FakeSigner;
let deps: SourcingDeps;

const brief = (): SourcingBrief => ({
  buyer: { name: "Karoo Solar Imports (Pty) Ltd", address: signer.buyer },
  goods: { description: "Monocrystalline solar panel 550 W", quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000 },
  incoterm: "CIF",
  port: "Durban",
  deadlineSeconds: 300,
  negotiationSeconds: 90,
});
const form = { quoteNumber: "Q-88213", quantity: 400, unitCents: 11_400, incoterm: "CIF", port: "Durban", deliveryDays: 21, notes: "" };
const settlement = {
  invoiceNumber: "INV-88213",
  blNumber: "SZXDUR-55120",
  vessel: "MSC AURORA V.214E",
  portOfLoading: "Shenzhen (Yantian)",
  remarks: { invoice: "Goods as per quote Q-88213.", billOfLading: "Clean on board. Freight prepaid." },
};

beforeEach(() => {
  signer = new FakeSigner(CLOSE, { secret: "gate-secret-for-inspection-0123456789abcdef", now: () => new Date() });
  signer.testUsd = {
    issuer: signer.issuer,
    currencyHex: "5445535455534400000000000000000000000000",
    approvedSuppliers: [SUPPLIER],
    policyVersion: 5,
    limits: { perDealCents: "10000000", dailyCents: "50000000", openDeals: 10 },
  };
  deps = {
    repo: createMemoryRepo(),
    signer,
    supplierLine: async () => ({ balanceCents: 0n, limitCents: 100_000_000_000n, frozenByIssuer: false }),
    engine: clean,
    directory: (a) => (a === SUPPLIER ? SUPPLIER_NAME : null),
  };
});

// A sourcing deal accepted and locked.
async function lockedSourcingDeal() {
  const s = await openSourcing(deps, brief());
  await inviteSupplier(deps, s.id, SUPPLIER);
  await commitQuote(deps, s.id, SUPPLIER, form);
  const deal = await selectSupplier(deps, s.id, SUPPLIER);
  const { job } = await leadDecision(deps, deal.id, { outcome: "accept", reason: "Cheapest within the brief." }, "lead");
  if (!job) throw new Error("expected a locked job");
  return { dealId: deal.id, job };
}

// A 4b deal (no sourcing), accepted and locked.
async function locked4bDeal() {
  const d = { repo: deps.repo, signer, supplierLine: deps.supplierLine, decider: ruleFollowingDecider };
  const deal = await openDeal(d, { ...baseIntent, buyer: { ...baseIntent.buyer, address: signer.buyer }, poNumber: "PO-4B-1" });
  await submitQuote(d, deal.id, quote);
  await decideQuote(d, deal.id);
  return deal.id;
}

const attestation = { blNumber: "SZXDUR-55120", outcome: "attested", note: "400 cartons counted, seal intact" };

describe("the inspector's queue and attestation", () => {
  it("the queue lists a LOCKED sourcing deal with PO, goods, quantity, port and supplier name", async () => {
    const { dealId, job } = await lockedSourcingDeal();
    expect(await inspectorQueue(deps)).toEqual([
      {
        dealId,
        poNumber: job.ref,
        goods: "Monocrystalline solar panel 550 W",
        quantity: 400,
        incoterm: "CIF",
        port: "Durban",
        supplierName: SUPPLIER_NAME,
        jobState: "LOCKED",
      },
    ]);
  });

  it('after the supplier submits B/L SZXDUR-55120, the queue JSON contains neither "SZXDUR" nor "55120"', async () => {
    const { dealId } = await lockedSourcingDeal();
    await submitSettlement(deps, dealId, SUPPLIER, settlement);
    const queue = await inspectorQueue(deps);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.jobState).toBe("DELIVERED");
    const text = JSON.stringify(queue);
    expect(text).not.toContain("SZXDUR");
    expect(text).not.toContain("55120");
  });

  it("a 4b deal never appears and attest on it throws InspectionNotFound", async () => {
    const dealId = await locked4bDeal();
    expect(await inspectorQueue(deps)).toEqual([]);
    await expect(attest(deps, dealId, attestation, INSPECTOR)).rejects.toBeInstanceOf(InspectionNotFound);
    expect(await inspectionOf(deps, dealId)).toBeNull();
  });

  it("an unknown deal throws InspectionNotFound", async () => {
    await expect(attest(deps, "00000000-0000-4000-8000-000000000000", attestation, INSPECTOR)).rejects.toBeInstanceOf(InspectionNotFound);
  });

  it("inspectionOf goes from pending to attested with inspector, blNumber, note and at", async () => {
    const { dealId, job } = await lockedSourcingDeal();
    expect(await inspectionOf(deps, dealId)).toEqual({ state: "pending" });
    const answered = await attest(deps, dealId, { ...attestation, blNumber: " SZXDUR-55120 " }, INSPECTOR);
    expect(answered).toEqual({ state: "attested", inspector: INSPECTOR, blNumber: "SZXDUR-55120", note: attestation.note, at: expect.any(String) });
    expect(await inspectionOf(deps, dealId)).toEqual(answered);
    expect(await inspectorQueue(deps)).toEqual([]);
    expect((await deps.repo.getAttestation(job.id))?.inspector).toBe(INSPECTOR);
  });

  it("a refusal is recorded as refused, and a second different answer is AttestationConflict", async () => {
    const { dealId } = await lockedSourcingDeal();
    const refused = await attest(deps, dealId, { blNumber: "SZXDUR-55120", outcome: "refused", note: "Seal broken" }, INSPECTOR);
    expect(refused.state).toBe("refused");
    await expect(attest(deps, dealId, attestation, INSPECTOR)).rejects.toBeInstanceOf(AttestationConflict);
  });

  it("a bad form is refused before anything is stored", async () => {
    const { dealId } = await lockedSourcingDeal();
    await expect(attest(deps, dealId, { ...attestation, outcome: "approve" }, INSPECTOR)).rejects.toThrow();
    expect(await inspectionOf(deps, dealId)).toEqual({ state: "pending" });
  });
});
