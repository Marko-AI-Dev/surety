import { beforeEach, describe, expect, it } from "vitest";
import type { TradeDocuments, TradeFields } from "@surety/contracts";
import {
  type DecisionEngine,
  type DocumentReader,
  type EvaluationResult,
  POLICY_V1,
  parseTradeDocuments,
  parserReader,
} from "@surety/gate";
import {
  type DealsRepo,
  type Job,
  type InspectionRepo,
  type JobsRepo,
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

const CLOSE = 800_000_000;
const GATE_SECRET = "gate-secret-for-trade-tests-0123456789abcdef";

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

type Answer = [number, number] | "unavailable";

// Scripted answers in order, counting the asks and keeping every input.
function scripted(...answers: Answer[]) {
  const inputs: Parameters<DecisionEngine["evaluate"]>[0][] = [];
  const engine: DecisionEngine & { inputs: typeof inputs } = {
    mode: "fixture",
    inputs,
    async evaluate(input): Promise<EvaluationResult> {
      inputs.push(input);
      const a = answers.shift();
      const common = {
        mode: "fixture" as const,
        provider: "fixture",
        model: "fixture",
        latencyMs: 1,
        requestId: input.requestId,
        evaluatedAt: new Date().toISOString(),
        costUsd: null,
      };
      if (a === undefined || a === "unavailable") {
        return { ...common, status: "unavailable", satisfaction: null, injectionRisk: null, reasonCodes: ["fixture_unavailable"] };
      }
      return { ...common, status: "ok", satisfaction: a[0], injectionRisk: a[1], reasonCodes: [] };
    },
  };
  return engine;
}

function countingReader(inner: DocumentReader = parserReader) {
  let calls = 0;
  const reader: DocumentReader & { calls: () => number } = {
    kind: inner.kind,
    model: inner.model,
    calls: () => calls,
    read(docs) {
      calls += 1;
      return inner.read(docs);
    },
  };
  return reader;
}

// A locked deal with these documents delivered. Each deal gets its own PO number, stamped into the
// invoice in place of the fixture's PO-2026-0412.
async function deliveredDeal(docs: TradeDocuments): Promise<Job> {
  pos += 1;
  const po = `PO-TRADE-${pos}`;
  const deps = { repo, signer, supplierLine: async () => ({ balanceCents: 0n, limitCents: 100_000_000_000n, frozenByIssuer: false }), decider: ruleFollowingDecider };
  const deal = await openDeal(deps, { ...baseIntent, buyer: { ...baseIntent.buyer, address: signer.buyer }, poNumber: po });
  await submitQuote(deps, deal.id, quote);
  await decideQuote(deps, deal.id);
  return submitDocuments(deps, deal.id, { ...docs, commercialInvoice: docs.commercialInvoice.replace("PO number: PO-2026-0412", `PO number: ${po}`) });
}

function evaluate(job: Job, engine: DecisionEngine, extra: Partial<Parameters<typeof evaluateJob>[0]> = {}) {
  return evaluateJob({ repo, engine, ledgerCloseTime: async () => closeTime, ...extra }, job.id);
}

const doc = (name: string) => presets[name] as TradeDocuments;
const decisionOf = async (job: Job) => repo.latestDecision(job.id);

describe("evaluateJob for a deal: Surety Verify", () => {
  it("honest documents are APPROVED with one ask, the trade questions and the deal's evidence", async () => {
    const engine = scripted([0.95, 0.02]);
    const job = await deliveredDeal(doc("docs-honest"));
    const after = await evaluate(job, engine);
    expect(after.state).toBe("APPROVED");
    expect(engine.inputs).toHaveLength(1);
    const { notes: _notes, ...terms } = quote;
    expect(engine.inputs[0]?.state.accepted_quote).toEqual(terms);
    expect(engine.inputs[0]).toMatchObject({
      questionSet: "trade",
      policyVersion: "policy-v4-trade",
      state: {
        purchase_order: job.sourceText,
        commercial_invoice: (job.deliverable as TradeDocuments).commercialInvoice,
        bill_of_lading: doc("docs-honest").billOfLading,
      },
    });
    const decision = await decisionOf(job);
    expect(decision).toMatchObject({ outcome: "APPROVE", policyVersion: "policy-v4-trade", samples: null });
    expect(decision?.rules).toMatchObject({ passed: true, reader: { kind: "parser", model: null } });
  });

  it("docs-wallet-changed is REJECTED_AWAITING_EXPIRY rule:pay_to and the engine is never called", async () => {
    const engine = scripted([0.95, 0.02]);
    const after = await evaluate(await deliveredDeal(doc("docs-wallet-changed")), engine);
    expect(after.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect((await decisionOf(after))?.reasonCodes).toEqual(["rule:pay_to"]);
    expect(engine.inputs).toHaveLength(0);
  });

  it("docs-second-pay-to is declined rule:parse and the reader is never called", async () => {
    const reader = countingReader();
    const engine = scripted([0.95, 0.02]);
    const after = await evaluate(await deliveredDeal(doc("docs-second-pay-to")), engine, { reader });
    expect(after.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect((await decisionOf(after))?.reasonCodes).toEqual(["rule:parse"]);
    expect(reader.calls()).toBe(0);
    expect(engine.inputs).toHaveLength(0);
  });

  it("docs-hidden-instruction scored injection 0.9 is declined injection_risk", async () => {
    const after = await evaluate(await deliveredDeal(doc("docs-hidden-instruction")), scripted([0.05, 0.9]));
    expect(after.state).toBe("REJECTED_AWAITING_EXPIRY");
    expect((await decisionOf(after))?.reasonCodes).toEqual(["injection_risk"]);
  });

  it("a borderline 0.72 then 0.66 and 0.69 is REVIEW_REQUIRED with three samples recorded", async () => {
    const after = await evaluate(await deliveredDeal(doc("docs-honest")), scripted([0.72, 0.02], [0.66, 0.03], [0.69, 0.01]));
    expect(after.state).toBe("REVIEW_REQUIRED");
    const samples = [
      { satisfaction: 0.72, injectionRisk: 0.02 },
      { satisfaction: 0.66, injectionRisk: 0.03 },
      { satisfaction: 0.69, injectionRisk: 0.01 },
    ];
    expect(await decisionOf(after)).toMatchObject({ outcome: "ESCALATE", satisfaction: 0.69, samples });
    expect((await repo.listEvents(after.id)).at(-1)?.detail).toMatchObject({ samples });
  });

  it("0.68 then 0.74 and 0.76 is APPROVED with samples", async () => {
    const after = await evaluate(await deliveredDeal(doc("docs-honest")), scripted([0.68, 0.02], [0.74, 0.02], [0.76, 0.02]));
    expect(after.state).toBe("APPROVED");
    expect((await decisionOf(after))?.samples).toHaveLength(3);
  });

  it("an unavailable reader is REVIEW_REQUIRED reader_<reason> and the model is never asked", async () => {
    const down: DocumentReader = { kind: "agent", model: "test-reader", read: async () => ({ status: "unavailable", reason: "timeout" }) };
    const engine = scripted([0.95, 0.02]);
    const after = await evaluate(await deliveredDeal(doc("docs-honest")), engine, { reader: down });
    expect(after.state).toBe("REVIEW_REQUIRED");
    expect(await decisionOf(after)).toMatchObject({ outcome: "UNAVAILABLE", reasonCodes: ["reader_timeout"] });
    expect(engine.inputs).toHaveLength(0);
  });

  it("a reader that misreads is declined rule:reader_agrees", async () => {
    const misreading: DocumentReader = {
      kind: "agent",
      model: "test-reader",
      async read(docs) {
        const f = parseTradeDocuments(docs) as TradeFields;
        return { status: "ok", fields: { ...f, invoice: { ...f.invoice, totalCents: 1 } } };
      },
    };
    const after = await evaluate(await deliveredDeal(doc("docs-honest")), scripted([0.95, 0.02]), { reader: misreading });
    expect((await decisionOf(after))?.reasonCodes).toEqual(["rule:reader_agrees"]);
  });

  it("deps.policy does not override a deal's frozen policy", async () => {
    const after = await evaluate(await deliveredDeal(doc("docs-honest")), scripted([0.85, 0.02]), { policy: POLICY_V1 });
    expect(after.state).toBe("APPROVED");
    expect((await decisionOf(after))?.policyVersion).toBe("policy-v4-trade");
  });

  it("the honest deal is PAID end to end through runEngineOnce with the fake signer", async () => {
    const job = await deliveredDeal(doc("docs-honest"));
    const report = await runEngineOnce({ repo, signer, engine: scripted([0.95, 0.02]), gateSecret: GATE_SECRET, ledgerCloseTime: async () => closeTime });
    expect(report.paid).toEqual([job.id]);
    expect((await repo.getJob(job.id))?.state).toBe("PAID");
  });
});
