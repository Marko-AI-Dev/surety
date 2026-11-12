import { beforeEach, describe, expect, it } from "vitest";
import type { TradeDocuments } from "@surety/contracts";
import type { DecisionEngine, EvaluationResult } from "@surety/gate";
import {
  DECISION_CUTOFF_SECONDS,
  type DealsRepo,
  type InspectionRepo,
  type Job,
  type JobsRepo,
  TRADE_CRITERIA,
  TRADE_CRITERIA_INSPECTED,
  createMemoryRepo,
  decideQuote,
  evaluateJob,
  openDeal,
  ruleFollowingDecider,
  runEngineOnce,
  submitDocuments,
  submitQuote,
} from "../src/index";
import { FakeSigner } from "./fake-signer";
import { SUPPLIER, intent as baseIntent, presets, quote } from "../../../scripts/deal-fixtures";

// The inspector's second key on the money path: a sourcing deal is paid only after a person attests the
// bill of lading number, and that number matches the supplier's documents. Everything else refunds.

const CLOSE = 800_000_000;
const DEADLINE = CLOSE + baseIntent.deadlineSeconds;
const CUTOFF = DEADLINE - DECISION_CUTOFF_SECONDS;
const GATE_SECRET = "gate-secret-for-inspection-tests-0123456789";

let repo: JobsRepo & DealsRepo & InspectionRepo;
let signer: FakeSigner;
let closeTime: number;
let pos = 0;

beforeEach(() => {
  repo = createMemoryRepo();
  signer = new FakeSigner(CLOSE, { secret: GATE_SECRET, now: () => new Date() });
  signer.testUsd = {
    issuer: signer.issuer,
    currencyHex: "5445535455534400000000000000000000000000",
    approvedSuppliers: [SUPPLIER],
    policyVersion: 5,
    limits: { perDealCents: "10000000", dailyCents: "50000000", openDeals: 10 },
  };
  closeTime = CLOSE + 10;
});

// Approves everything it is asked, and counts the asks.
function approving() {
  let calls = 0;
  const engine: DecisionEngine & { calls: () => number } = {
    mode: "fixture",
    calls: () => calls,
    async evaluate(input): Promise<EvaluationResult> {
      calls += 1;
      return {
        status: "ok",
        mode: "fixture",
        satisfaction: 0.95,
        injectionRisk: 0.02,
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
  return engine;
}

// A locked deal with these documents delivered: a sourcing deal (inspection: "required") or a 4b deal.
async function deliveredDeal(docs: TradeDocuments, kind: "sourcing" | "4b" = "sourcing"): Promise<{ dealId: string; job: Job }> {
  pos += 1;
  const po = `PO-INSP-${pos}`;
  const deps = {
    repo,
    signer,
    supplierLine: async () => ({ balanceCents: 0n, limitCents: 100_000_000_000n, frozenByIssuer: false }),
    decider: ruleFollowingDecider,
    ...(kind === "sourcing" ? { inspection: "required" as const } : {}),
  };
  const deal = await openDeal(deps, { ...baseIntent, buyer: { ...baseIntent.buyer, address: signer.buyer }, poNumber: po });
  await submitQuote(deps, deal.id, quote);
  await decideQuote(deps, deal.id);
  const job = await submitDocuments(deps, deal.id, {
    ...docs,
    commercialInvoice: docs.commercialInvoice.replace("PO number: PO-2026-0412", `PO number: ${po}`),
  });
  return { dealId: deal.id, job };
}

const doc = (name: string) => presets[name] as TradeDocuments;
const engineDeps = (engine: DecisionEngine) => ({ repo, signer, engine, gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime });
const stateOf = async (job: Job) => (await repo.getJob(job.id))?.state;
const attest = (dealId: string, job: Job, blNumber = "SZXDUR-55120", outcome: "attested" | "refused" = "attested", note = "400 cartons counted, seal intact") =>
  repo.addAttestation({ dealId, jobId: job.id, inspector: "Port inspector (demo)", blNumber, outcome, note });

// Past the deadline the expiry sweep refunds; the fake signer records every cancel and finish.
async function refundAtDeadline(engine: DecisionEngine) {
  closeTime = DEADLINE + 1;
  return runEngineOnce(engineDeps(engine));
}

describe("the inspector's second key on the money path", () => {
  it("a delivered sourcing deal with no attestation stays DELIVERED across three engine passes, with no decision and 0 engine calls", async () => {
    const engine = approving();
    const { job } = await deliveredDeal(doc("docs-honest"));
    for (let i = 0; i < 3; i++) {
      const report = await runEngineOnce(engineDeps(engine));
      expect(report.awaitingInspection).toEqual([job.id]);
      expect(report.evaluated).toEqual([]);
    }
    expect(await stateOf(job)).toBe("DELIVERED");
    expect(await repo.latestDecision(job.id)).toBeNull();
    expect(engine.calls()).toBe(0);
    expect((await repo.listEvents(job.id)).map((e) => e.toState)).not.toContain("EVALUATING");
  });

  it("with no attestation at the cutoff it is held REVIEW_REQUIRED with inspection_missing, and at the ledger deadline it is REFUNDED with no finish ever requested", async () => {
    const engine = approving();
    const { job } = await deliveredDeal(doc("docs-honest"));
    closeTime = CUTOFF;
    await runEngineOnce(engineDeps(engine));
    expect(await stateOf(job)).toBe("REVIEW_REQUIRED");
    expect((await repo.listEvents(job.id)).at(-1)?.reasonCodes).toEqual(["inspection_missing"]);
    await refundAtDeadline(engine);
    expect(await stateOf(job)).toBe("REFUNDED");
    expect(signer.count("finish")).toBe(0);
    expect(engine.calls()).toBe(0);
  });

  it("an attested matching B/L approves and pays $48,000.00", async () => {
    const engine = approving();
    const { dealId, job } = await deliveredDeal(doc("docs-honest"));
    const attestation = await attest(dealId, job, "szxdur 55120");
    const report = await runEngineOnce(engineDeps(engine));
    expect(report.paid).toEqual([job.id]);
    expect(await stateOf(job)).toBe("PAID");
    expect(signer.settled.filter((s) => s.method === "finish")).toHaveLength(1);
    expect((await repo.getEscrow(job.id))?.amount).toEqual({ asset: "TESTUSD", cents: "4800000" });
    const decision = await repo.latestDecision(job.id);
    expect(decision?.outcome).toBe("APPROVE");
    expect(decision?.rules).toMatchObject({
      passed: true,
      inspection: { attestationId: attestation.id, outcome: "attested", blNumber: "szxdur 55120" },
    });
    expect((decision?.rules as { results: { id: string }[] }).results.map((r) => r.id).at(-1)).toBe("attested");
    expect(engine.calls()).toBe(1);
  });

  it("a mismatched B/L declines with rule:attested, 0 engine calls, never paid, refunded at the deadline", async () => {
    const engine = approving();
    const { dealId, job } = await deliveredDeal(doc("docs-honest"));
    await attest(dealId, job, "SZXDUR-55121");
    await runEngineOnce(engineDeps(engine));
    expect(await stateOf(job)).toBe("REJECTED_AWAITING_EXPIRY");
    expect((await repo.latestDecision(job.id))?.reasonCodes).toEqual(["rule:attested"]);
    expect(engine.calls()).toBe(0);
    await refundAtDeadline(engine);
    expect(await stateOf(job)).toBe("REFUNDED");
    expect(signer.count("finish")).toBe(0);
  });

  it("a refused attestation declines with rule:attested and refunds", async () => {
    const engine = approving();
    const { dealId, job } = await deliveredDeal(doc("docs-honest"));
    await attest(dealId, job, "SZXDUR-55120", "refused", "Seal broken, 380 cartons counted");
    await runEngineOnce(engineDeps(engine));
    expect((await repo.latestDecision(job.id))?.reasonCodes).toEqual(["rule:attested"]);
    await refundAtDeadline(engine);
    expect(await stateOf(job)).toBe("REFUNDED");
    expect(signer.count("finish")).toBe(0);
    expect(engine.calls()).toBe(0);
  });

  it("an attestation stored after the cutoff still ends in a refund", async () => {
    const engine = approving();
    const { dealId, job } = await deliveredDeal(doc("docs-honest"));
    closeTime = CUTOFF + 5;
    await attest(dealId, job);
    await runEngineOnce(engineDeps(engine));
    expect(await stateOf(job)).toBe("REVIEW_REQUIRED");
    await refundAtDeadline(engine);
    expect(await stateOf(job)).toBe("REFUNDED");
    expect(signer.count("finish")).toBe(0);
    expect(engine.calls()).toBe(0);
  });

  it('a job whose criteria say inspection "optional" is held trade_terms_invalid', async () => {
    const engine = approving();
    const { job: sample } = await deliveredDeal(doc("docs-honest"));
    const criteria = { ...(sample.criteria as object), inspection: "optional" };
    const job = await repo.createJob({
      ref: `${sample.ref}-X`,
      buyerAddress: sample.buyerAddress,
      sellerAddress: sample.sellerAddress,
      amount: sample.amount,
      sourceText: sample.sourceText,
      criteria,
      criteriaText: sample.criteriaText ?? undefined,
      policyVersion: sample.policyVersion,
      cancelAfterSeconds: baseIntent.deadlineSeconds,
    });
    const escrow = await repo.getEscrow(sample.id);
    if (!escrow) throw new Error("no escrow");
    await repo.attachEscrow({ ...escrow, jobId: job.id, offerSequence: escrow.offerSequence + 1000, createTxHash: "C".repeat(64) });
    let current = job;
    for (const to of ["CREATE_PENDING", "LOCKED", "IN_PROGRESS"] as const) {
      current = await repo.transition(current.id, current.state, to, { actor: "test", reasonCodes: ["test_walk"] });
    }
    await repo.saveDeliverable(job.id, sample.deliverable, sample.deliverableHash ?? "");
    await repo.transition(job.id, "IN_PROGRESS", "DELIVERED", { actor: "test", reasonCodes: ["test_walk"] });
    const after = await evaluateJob({ repo, engine, ledgerCloseTime: async () => closeTime }, job.id);
    expect(after.state).toBe("REVIEW_REQUIRED");
    expect((await repo.listEvents(job.id)).at(-1)?.reasonCodes).toEqual(["trade_terms_invalid"]);
    expect(engine.calls()).toBe(0);
  });

  it("a 4b deal without the flag freezes { kind, intent, quote } exactly and is judged as before", async () => {
    const engine = approving();
    const { job } = await deliveredDeal(doc("docs-honest"), "4b");
    expect(Object.keys(job.criteria as object).sort()).toEqual(["intent", "kind", "quote"]);
    expect(job.criteriaText).toBe(TRADE_CRITERIA);
    const report = await runEngineOnce(engineDeps(engine));
    expect(report.paid).toEqual([job.id]);
    expect(report.awaitingInspection).toEqual([]);
    const rules = (await repo.latestDecision(job.id))?.rules as { results: { id: string }[]; inspection?: unknown };
    expect(rules.results).toHaveLength(12);
    expect(rules.inspection).toBeUndefined();
  });

  it("a sourcing deal's job freezes inspection required and says so in its criteria text", async () => {
    const { job } = await deliveredDeal(doc("docs-honest"));
    expect(job.criteria).toMatchObject({ kind: "trade", inspection: "required" });
    expect(job.criteriaText).toBe(TRADE_CRITERIA_INSPECTED);
    expect(TRADE_CRITERIA_INSPECTED).toBe(`${TRADE_CRITERIA} An independent inspector must attest the bill of lading number before release.`);
  });
});
