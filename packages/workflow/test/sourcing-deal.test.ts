import { beforeEach, describe, expect, it } from "vitest";
import type { SourcingBrief } from "@surety/contracts";
import type { DecisionEngine, EvaluationResult } from "@surety/gate";
import {
  type DealsRepo,
  type InspectionRepo,
  type JobsRepo,
  NotInvited,
  SourcingClosed,
  type SourcingDeps,
  type SourcingRepo,
  answerDecider,
  commitQuote,
  createMemoryRepo,
  inviteSupplier,
  leadDecision,
  openSourcing,
  postNegotiatorMessage,
  postSupplierMessage,
  runEngineOnce,
  selectSupplier,
  settlementDraftFor,
  submitSettlement,
} from "../src/index";
import { FakeSigner } from "./fake-signer";
import { SUPPLIER, SUPPLIER_NAME } from "../../../scripts/deal-fixtures";

const SECOND = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const CLOSE = 800_000_000;
const GATE_SECRET = "gate-secret-for-sourcing-deal-tests-0123456";

function fixedEngine(sat: number, inj: number): DecisionEngine {
  return {
    mode: "fixture",
    async evaluate(input): Promise<EvaluationResult> {
      return {
        status: "ok",
        mode: "fixture",
        satisfaction: sat,
        injectionRisk: inj,
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
}

let repo: JobsRepo & DealsRepo & SourcingRepo & InspectionRepo;
let signer: FakeSigner;
let deps: SourcingDeps;
const NAMES: Record<string, string> = { [SUPPLIER]: SUPPLIER_NAME, [SECOND]: "Sunpeak Energy" };

const brief = (): SourcingBrief => ({
  buyer: { name: "Karoo Solar Imports (Pty) Ltd", address: signer.buyer },
  goods: { description: "Monocrystalline solar panel 550 W", quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000 },
  incoterm: "CIF",
  port: "Durban",
  deadlineSeconds: 300,
  negotiationSeconds: 90,
});
const form = (unitCents: number) => ({ quoteNumber: "Q-88213", quantity: 400, unitCents, incoterm: "CIF", port: "Durban", deliveryDays: 21, notes: "" });
const accept = { outcome: "accept", reason: "Cheapest committed quote within the brief." };
const settlement = {
  invoiceNumber: "INV-88213",
  blNumber: "SZXDUR-55120",
  vessel: "MSC AURORA V.214E",
  portOfLoading: "Shenzhen (Yantian)",
  remarks: { invoice: "Goods as per quote Q-88213.", billOfLading: "Clean on board. Freight prepaid." },
};

beforeEach(() => {
  repo = createMemoryRepo();
  signer = new FakeSigner(CLOSE, { secret: GATE_SECRET, now: () => new Date() });
  signer.testUsd = {
    issuer: signer.issuer,
    currencyHex: "5445535455534400000000000000000000000000",
    approvedSuppliers: [SUPPLIER, SECOND],
    policyVersion: 5,
    limits: { perDealCents: "10000000", dailyCents: "50000000", openDeals: 10 },
  };
  deps = {
    repo,
    signer,
    supplierLine: async () => ({ balanceCents: 0n, limitCents: 100_000_000_000n, frozenByIssuer: false }),
    engine: fixedEngine(0.95, 0.03),
    directory: (a) => NAMES[a] ?? null,
  };
});

async function sourcingWithQuotes(quotes: Record<string, number>) {
  const s = await openSourcing(deps, brief());
  for (const [address, unitCents] of Object.entries(quotes)) {
    await inviteSupplier(deps, s.id, address);
    await commitQuote(deps, s.id, address, form(unitCents));
  }
  return s;
}

describe("answerDecider", () => {
  it("carries the lead's answer as an agent decision", async () => {
    const d = answerDecider({ outcome: "decline", reason: "Too slow." }, "paperclip:lead");
    expect(d).toMatchObject({ kind: "agent", model: "paperclip:lead" });
    expect(await d.decide({} as never)).toEqual({ outcome: "decline", reason: "Too slow." });
  });
});

describe("selection and the lead's decision", () => {
  it("a lead accept on an honest committed quote locks $45,600.00 and marks the sourcing SELECTED", async () => {
    const s = await sourcingWithQuotes({ [SUPPLIER]: 11_400 });
    const deal = await selectSupplier(deps, s.id, SUPPLIER);
    expect(deal).toMatchObject({ state: "QUOTE_RECEIVED", ref: `PO-${s.ref.slice(3)}-S1`, intent: { supplier: { name: SUPPLIER_NAME, address: SUPPLIER } } });
    const { deal: accepted, job } = await leadDecision(deps, deal.id, accept, "lead");
    expect(accepted).toMatchObject({ state: "ACCEPTED", decision: { agent: { kind: "agent", model: "paperclip:lead", reason: accept.reason } } });
    expect(job).toMatchObject({ state: "LOCKED", amount: { asset: "TESTUSD", cents: "4560000" }, sellerAddress: SUPPLIER });
    expect(await repo.getSourcing(s.id)).toMatchObject({ state: "SELECTED", selectedSupplier: SUPPLIER, dealId: deal.id });
  });

  it("a committed quote above the maximum is overruled, the deal DECLINED, nothing locked, the sourcing still OPEN, and another supplier selectable", async () => {
    const s = await sourcingWithQuotes({ [SUPPLIER]: 12_500, [SECOND]: 11_900 });
    const over = await selectSupplier(deps, s.id, SUPPLIER);
    const first = await leadDecision(deps, over.id, accept, "lead");
    expect(first.deal).toMatchObject({ state: "DECLINED", decision: { final: "decline", reasonCodes: ["agent_overruled", "unit_price"] } });
    expect(first.job).toBeNull();
    expect(signer.calls.filter((c) => c.method === "create")).toHaveLength(0);
    expect(await repo.getSourcing(s.id)).toMatchObject({ state: "OPEN", dealId: null });
    const next = await selectSupplier(deps, s.id, SECOND);
    expect(next.ref).toBe(`PO-${s.ref.slice(3)}-S2`);
    expect((await leadDecision(deps, next.id, accept, "lead")).job?.state).toBe("LOCKED");
  });

  it("two lead decisions on two suppliers' deals at once lock at most one payment", async () => {
    const s = await sourcingWithQuotes({ [SUPPLIER]: 11_400, [SECOND]: 11_600 });
    const d1 = await selectSupplier(deps, s.id, SUPPLIER);
    const d2 = await selectSupplier(deps, s.id, SECOND);
    const settled = await Promise.allSettled([leadDecision(deps, d1.id, accept, "lead"), leadDecision(deps, d2.id, accept, "lead")]);
    const locked = settled.filter((r) => r.status === "fulfilled" && r.value.job?.state === "LOCKED");
    expect(locked).toHaveLength(1);
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(signer.calls.filter((c) => c.method === "create")).toHaveLength(1);
  });

  it("a decision on a policy-refused deal is refused and leaves the sourcing open", async () => {
    const s = await sourcingWithQuotes({ [SUPPLIER]: 11_400, [SECOND]: 11_600 });
    const ready = deps.supplierLine;
    deps.supplierLine = async (a) => (a === SECOND ? null : ready(a));
    const refused = await selectSupplier(deps, s.id, SECOND);
    expect(refused.state).toBe("POLICY_REFUSED");
    await expect(leadDecision(deps, refused.id, accept, "lead")).rejects.toThrow(/POLICY_REFUSED/);
    expect(await repo.getSourcing(s.id)).toMatchObject({ state: "OPEN", dealId: null });
    const ok = await selectSupplier(deps, s.id, SUPPLIER);
    expect((await leadDecision(deps, ok.id, accept, "lead")).job?.state).toBe("LOCKED");
  });

  it("a decision that throws before deciding keeps the claim for its retry, and only a decline releases it", async () => {
    const s = await sourcingWithQuotes({ [SUPPLIER]: 11_400, [SECOND]: 11_600 });
    const d = await selectSupplier(deps, s.id, SUPPLIER);
    const other = await selectSupplier(deps, s.id, SECOND);
    const health = signer.health.bind(signer);
    signer.health = async () => {
      throw new Error("signer unreachable");
    };
    await expect(leadDecision(deps, d.id, accept, "lead")).rejects.toThrow(/unreachable/);
    signer.health = health;
    expect(await repo.getSourcing(s.id)).toMatchObject({ state: "SELECTED", dealId: d.id });
    await expect(leadDecision(deps, other.id, accept, "lead")).rejects.toBeInstanceOf(SourcingClosed);
    expect((await leadDecision(deps, d.id, { outcome: "decline", reason: "Changed our mind." }, "lead")).deal.state).toBe("DECLINED");
    expect(await repo.getSourcing(s.id)).toMatchObject({ state: "OPEN", dealId: null });
    expect((await leadDecision(deps, other.id, accept, "lead")).job?.state).toBe("LOCKED");
  });

  it("a supplier cannot be selected twice", async () => {
    const s = await sourcingWithQuotes({ [SUPPLIER]: 12_500 });
    const d = await selectSupplier(deps, s.id, SUPPLIER);
    await leadDecision(deps, d.id, accept, "lead");
    await expect(selectSupplier(deps, s.id, SUPPLIER)).rejects.toThrow(/already has a deal/);
  });

  it("another supplier's address cannot submit the settlement (NotInvited)", async () => {
    const s = await sourcingWithQuotes({ [SUPPLIER]: 11_400 });
    const d = await selectSupplier(deps, s.id, SUPPLIER);
    await leadDecision(deps, d.id, accept, "lead");
    await expect(submitSettlement(deps, d.id, SECOND, settlement)).rejects.toBeInstanceOf(NotInvited);
    await expect(settlementDraftFor(deps, d.id, SECOND)).rejects.toBeInstanceOf(NotInvited);
  });
});

describe("end to end in memory", () => {
  it("every job a sourcing deal creates freezes inspection: \"required\"", async () => {
    const s = await openSourcing(deps, brief());
    await inviteSupplier(deps, s.id, SUPPLIER);
    await commitQuote(deps, s.id, SUPPLIER, form(11_400));
    const deal = await selectSupplier(deps, s.id, SUPPLIER);
    const { job } = await leadDecision(deps, deal.id, accept, "lead");
    expect(job?.criteria).toMatchObject({ kind: "trade", inspection: "required" });
  });

  it("open, invite, chat, commit, select, accept, settle, wait for the inspector, attest, runEngineOnce, PAID", async () => {
    const s = await openSourcing(deps, brief());
    await inviteSupplier(deps, s.id, SUPPLIER);
    await postNegotiatorMessage(deps, s.id, SUPPLIER, "What is your best price for 400 panels?");
    expect((await postSupplierMessage(deps, s.id, SUPPLIER, "We can do $114.00 each.")).delivered).toBe(true);
    await commitQuote(deps, s.id, SUPPLIER, form(11_400));
    const deal = await selectSupplier(deps, s.id, SUPPLIER);
    const { job } = await leadDecision(deps, deal.id, accept, "lead");
    if (!job) throw new Error("expected a locked job");
    const draft = await settlementDraftFor(deps, deal.id, SUPPLIER);
    expect(draft.fixed.invoice.totalCents).toBe(4_560_000);
    const delivered = await submitSettlement(deps, deal.id, SUPPLIER, { ...settlement, invoiceNumber: draft.suggested.invoiceNumber });
    expect(delivered.state).toBe("DELIVERED");
    const engineDeps = { repo, signer, engine: fixedEngine(0.95, 0.02), gateSecret: GATE_SECRET, ledgerCloseTime: async () => CLOSE + 10 };
    expect((await runEngineOnce(engineDeps)).awaitingInspection).toEqual([job.id]);
    await repo.addAttestation({ dealId: deal.id, jobId: job.id, inspector: "Port inspector (demo)", blNumber: "SZXDUR-55120", outcome: "attested", note: "" });
    const report = await runEngineOnce(engineDeps);
    expect(report.paid).toEqual([job.id]);
    expect((await repo.getJob(job.id))?.state).toBe("PAID");
  });
});
