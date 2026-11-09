import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DealIntent, canonicalJson, sha256Hex } from "@surety/contracts";
import { renderPurchaseOrder } from "@surety/gate";
import {
  type DealsRepo,
  DealConflict,
  DealTransitionConflict,
  type JobsRepo,
  type NewJob,
  type QuoteDecision,
  QuoteConflict,
} from "../src/index";
import { intent as baseIntent, quote } from "../../../scripts/deal-fixtures";

// One behavioural suite for every DealsRepo implementation: in-memory (pnpm test) and Postgres (pnpm test:db).

let pos = 0;
export function newIntent(overrides: Partial<DealIntent> = {}): DealIntent {
  pos += 1;
  return { ...baseIntent, poNumber: `PO-T${Date.now() % 1_000_000_000}-${pos}`, ...overrides };
}

const hashOf = (v: unknown) => sha256Hex(canonicalJson(v));
const opened = { actor: "policy", reasonCodes: ["policy_passed"] };
const quoted = { actor: "supplier", reasonCodes: ["quote_received"] };
const checks = { passed: true, results: [{ id: "quantity", status: "pass" as const }] };

export const acceptDecision: QuoteDecision = {
  agent: { outcome: "accept", reason: "Every check passes.", kind: "stand-in", model: null },
  final: "accept",
  reasonCodes: ["agent_accepted"],
};
const declineDecision: QuoteDecision = {
  agent: { outcome: "decline", reason: "Unit price above the maximum.", kind: "stand-in", model: null },
  final: "decline",
  reasonCodes: ["agent_declined"],
};

export function dealJob(intent: DealIntent): NewJob {
  return {
    ref: intent.poNumber,
    buyerAddress: intent.buyer.address,
    sellerAddress: quote.supplierAddress,
    amount: { asset: "TESTUSD", cents: String(quote.totalCents) },
    sourceText: renderPurchaseOrder(intent, quote),
    criteria: { kind: "trade", intent, quote },
    criteriaText: "Pay when the documents match the order.",
    policyVersion: "policy-v3-trade",
    cancelAfterSeconds: intent.deadlineSeconds,
  };
}

export function describeDealsRepo(name: string, make: () => Promise<JobsRepo & DealsRepo>): void {
  describe(`DealsRepo contract: ${name}`, () => {
    let repo: JobsRepo & DealsRepo;

    beforeEach(async () => {
      repo = await make();
    });

    afterEach(async () => {
      await repo.close();
    });

    const quotedDeal = async (intent = newIntent()) => {
      const deal = await repo.createDeal(intent, "AWAITING_QUOTE", opened);
      return repo.saveQuote(deal.id, quote, hashOf(quote), checks, quoted);
    };

    it("createDeal writes the deal and its first event", async () => {
      const intent = newIntent();
      const deal = await repo.createDeal(intent, "AWAITING_QUOTE", opened);
      expect(deal).toMatchObject({
        ref: intent.poNumber,
        intent,
        intentHash: hashOf(intent),
        quote: null,
        quoteHash: null,
        quoteChecks: null,
        decision: null,
        state: "AWAITING_QUOTE",
        jobId: null,
        version: 0,
      });
      expect(await repo.getDeal(deal.id)).toEqual(deal);
      const events = await repo.listDealEvents(deal.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ dealId: deal.id, fromState: null, toState: "AWAITING_QUOTE", actor: "policy", reasonCodes: ["policy_passed"] });
    });

    it("a refused intent is stored as POLICY_REFUSED with its reasons", async () => {
      const deal = await repo.createDeal(newIntent(), "POLICY_REFUSED", { actor: "policy", reasonCodes: ["approved_supplier"], detail: { x: 1 } });
      expect(deal.state).toBe("POLICY_REFUSED");
      expect((await repo.listDealEvents(deal.id))[0]).toMatchObject({ toState: "POLICY_REFUSED", reasonCodes: ["approved_supplier"], detail: { x: 1 } });
    });

    it("a duplicate PO number is DealConflict", async () => {
      const intent = newIntent();
      await repo.createDeal(intent, "AWAITING_QUOTE", opened);
      await expect(repo.createDeal(intent, "AWAITING_QUOTE", opened)).rejects.toBeInstanceOf(DealConflict);
    });

    it("saveQuote is idempotent by hash and refuses a changed quote", async () => {
      const deal = await quotedDeal();
      expect(deal).toMatchObject({ state: "QUOTE_RECEIVED", quote, quoteHash: hashOf(quote), quoteChecks: checks, version: 1 });
      expect(await repo.saveQuote(deal.id, quote, hashOf(quote), checks, quoted)).toEqual(deal);
      const changed = { ...quote, unitCents: 11_000, totalCents: 4_400_000 };
      await expect(repo.saveQuote(deal.id, changed, hashOf(changed), checks, quoted)).rejects.toBeInstanceOf(QuoteConflict);
      expect((await repo.listDealEvents(deal.id)).map((e) => e.toState)).toEqual(["AWAITING_QUOTE", "QUOTE_RECEIVED"]);
    });

    it("a quote for a refused deal is DealTransitionConflict", async () => {
      const deal = await repo.createDeal(newIntent(), "POLICY_REFUSED", opened);
      await expect(repo.saveQuote(deal.id, quote, hashOf(quote), checks, quoted)).rejects.toBeInstanceOf(DealTransitionConflict);
    });

    it("acceptDeal creates the TESTUSD job and links it in one step", async () => {
      const intent = newIntent();
      const deal = await quotedDeal(intent);
      const { deal: accepted, job } = await repo.acceptDeal(deal.id, acceptDecision, dealJob(intent), { actor: "deal-agent", reasonCodes: ["agent_accepted"] });
      expect(accepted).toMatchObject({ state: "ACCEPTED", jobId: job.id, decision: acceptDecision, version: 2 });
      expect(job).toMatchObject({ ref: intent.poNumber, state: "DRAFT", amount: { asset: "TESTUSD", cents: "4800000" }, sellerAddress: quote.supplierAddress });
      expect(await repo.getJob(job.id)).toEqual(job);
      expect(await repo.getDealByJob(job.id)).toEqual(accepted);
      expect((await repo.listDealEvents(deal.id)).at(-1)).toMatchObject({ fromState: "QUOTE_RECEIVED", toState: "ACCEPTED", actor: "deal-agent" });
    });

    it("acceptDeal twice returns the same job and creates one job row", async () => {
      const intent = newIntent();
      const deal = await quotedDeal(intent);
      const first = await repo.acceptDeal(deal.id, acceptDecision, dealJob(intent), { actor: "deal-agent", reasonCodes: [] });
      const second = await repo.acceptDeal(deal.id, acceptDecision, dealJob(intent), { actor: "deal-agent", reasonCodes: [] });
      expect(second).toEqual(first);
      expect(await repo.listJobsInStates(["DRAFT"])).toEqual(expect.arrayContaining([first.job]));
      expect((await repo.listJobsInStates(["DRAFT"])).filter((j) => j.ref === intent.poNumber)).toHaveLength(1);
    });

    it("declineDeal records the decision; acceptDeal on DECLINED is DealTransitionConflict", async () => {
      const intent = newIntent();
      const deal = await quotedDeal(intent);
      const declined = await repo.declineDeal(deal.id, declineDecision, { actor: "deal-agent", reasonCodes: ["agent_declined"] });
      expect(declined).toMatchObject({ state: "DECLINED", decision: declineDecision, jobId: null });
      await expect(repo.acceptDeal(deal.id, acceptDecision, dealJob(intent), { actor: "deal-agent", reasonCodes: [] })).rejects.toBeInstanceOf(
        DealTransitionConflict,
      );
      await expect(repo.declineDeal(deal.id, declineDecision, { actor: "deal-agent", reasonCodes: [] })).rejects.toBeInstanceOf(DealTransitionConflict);
    });

    it("listDeals is newest first", async () => {
      const a = await repo.createDeal(newIntent(), "AWAITING_QUOTE", opened);
      const b = await repo.createDeal(newIntent(), "AWAITING_QUOTE", opened);
      const ids = (await repo.listDeals(50)).map((d) => d.id);
      expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
      expect(await repo.listDeals(1)).toHaveLength(1);
    });

    it("an unknown deal reads as null", async () => {
      expect(await repo.getDeal("00000000-0000-4000-8000-000000000000")).toBeNull();
      expect(await repo.getDealByJob("00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });
}
