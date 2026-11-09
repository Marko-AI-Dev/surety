import { beforeEach, describe, expect, it } from "vitest";
import type { CreateEscrowRequest, DealIntent, SupplierQuote } from "@surety/contracts";
import type { SupplierLine } from "@surety/gate";
import {
  type DealsRepo,
  DeliverableConflict,
  type JobsRepo,
  type QuoteDecider,
  createMemoryRepo,
  decideQuote,
  openDeal,
  ruleFollowingDecider,
  submitDocuments,
  submitQuote,
} from "../src/index";
import { FakeSigner, signerError } from "./fake-signer";
import { ATTACKER, SUPPLIER, intent as baseIntent, presets, quote } from "../../../scripts/deal-fixtures";

let repo: JobsRepo & DealsRepo;
let signer: FakeSigner;
let lines: Map<string, SupplierLine>;
let pos = 0;

const readyLine: SupplierLine = { balanceCents: 0n, limitCents: 100_000_000_000n, frozenByIssuer: false };
const alwaysAccept: QuoteDecider = { kind: "stand-in", model: null, decide: async () => ({ outcome: "accept", reason: "Looks fine." }) };

function setPolicy(approvedSuppliers = [SUPPLIER], perDealCents = "10000000") {
  signer.testUsd = {
    issuer: signer.issuer,
    currencyHex: "5445535455534400000000000000000000000000",
    approvedSuppliers,
    policyVersion: 5,
    limits: { perDealCents, dailyCents: "50000000", openDeals: 10 },
  };
}

beforeEach(() => {
  repo = createMemoryRepo();
  signer = new FakeSigner();
  lines = new Map([[SUPPLIER, readyLine]]);
  setPolicy();
});

const deps = (decider: QuoteDecider = ruleFollowingDecider) => ({
  repo,
  signer,
  supplierLine: async (address: string) => lines.get(address) ?? null,
  decider,
});

// The fixture intent, paid from this fake signer's treasury, with a fresh PO number.
function intent(overrides: Partial<DealIntent> = {}): DealIntent {
  pos += 1;
  return { ...baseIntent, buyer: { ...baseIntent.buyer, address: signer.buyer }, poNumber: `PO-DEALS-${pos}`, ...overrides };
}
const overMax: SupplierQuote = { ...quote, unitCents: 13_500, totalCents: 5_400_000 };

async function quoted(q: SupplierQuote = quote, decider?: QuoteDecider) {
  const deal = await openDeal(deps(decider), intent());
  return submitQuote(deps(decider), deal.id, q);
}

describe("openDeal: the Policy step", () => {
  it("the honest intent opens AWAITING_QUOTE", async () => {
    const deal = await openDeal(deps(), intent());
    expect(deal.state).toBe("AWAITING_QUOTE");
    expect((await repo.listDealEvents(deal.id))[0]).toMatchObject({ actor: "policy", reasonCodes: ["policy_passed"] });
  });

  it("the attacker wallet is POLICY_REFUSED with approved_supplier", async () => {
    const deal = await openDeal(deps(), intent({ supplier: { ...baseIntent.supplier, address: ATTACKER } }));
    expect(deal.state).toBe("POLICY_REFUSED");
    expect((await repo.listDealEvents(deal.id))[0]?.reasonCodes).toContain("approved_supplier");
  });

  it("a $150,000 budget is POLICY_REFUSED with budget_within_cap", async () => {
    const deal = await openDeal(deps(), intent({ goods: { ...baseIntent.goods, maxUnitCents: 37_500 } }));
    expect(deal.state).toBe("POLICY_REFUSED");
    expect((await repo.listDealEvents(deal.id))[0]?.reasonCodes).toEqual(["budget_within_cap"]);
  });

  it("a missing trust line is POLICY_REFUSED with supplier_ready", async () => {
    lines.clear();
    const deal = await openDeal(deps(), intent());
    expect((await repo.listDealEvents(deal.id))[0]?.reasonCodes).toEqual(["supplier_ready"]);
  });

  it("rejects an intent that is not the schema, and stores nothing", async () => {
    await expect(openDeal(deps(), { ...intent(), goods: { quantity: -1 } })).rejects.toThrow();
    expect(await repo.listDeals(10)).toEqual([]);
  });
});

describe("submitQuote and decideQuote: the Quote step", () => {
  it("the honest quote accepted by the stand-in locks $48,000.00 TESTUSD to the supplier", async () => {
    const deal = await quoted();
    expect(deal.state).toBe("QUOTE_RECEIVED");
    const { deal: accepted, job } = await decideQuote(deps(), deal.id);
    expect(accepted).toMatchObject({ state: "ACCEPTED", decision: { final: "accept", agent: { outcome: "accept", kind: "stand-in" } } });
    expect(job).toMatchObject({ state: "LOCKED", ref: deal.ref, amount: { asset: "TESTUSD", cents: "4800000" }, sellerAddress: SUPPLIER, policyVersion: "policy-v3-trade" });
    const create = signer.calls.find((c) => c.method === "create")?.req as CreateEscrowRequest;
    expect(create).toMatchObject({ destination: SUPPLIER, amountTestUsdCents: "4800000", cancelAfterSeconds: 300 });
    expect(create.amountDrops).toBeUndefined();
    expect(job?.criteria).toMatchObject({ kind: "trade" });
    expect(job?.sourceText).toContain("PURCHASE ORDER");
  });

  it("quote-over-max is declined by the stand-in as agent_declined and nothing is locked", async () => {
    const deal = await quoted(overMax);
    expect(deal.quoteChecks?.passed).toBe(false);
    const { deal: declined, job } = await decideQuote(deps(), deal.id);
    expect(declined).toMatchObject({ state: "DECLINED", decision: { final: "decline", reasonCodes: ["agent_declined"] } });
    expect(declined.decision?.agent.reason).toContain("unit_price");
    expect(job).toBeNull();
    expect(signer.count("create")).toBe(0);
  });

  it("an always-accept decider on quote-over-max is DECLINED agent_overruled unit_price", async () => {
    const deal = await quoted(overMax, alwaysAccept);
    const { deal: declined } = await decideQuote(deps(alwaysAccept), deal.id);
    expect(declined.decision).toMatchObject({ agent: { outcome: "accept" }, final: "decline", reasonCodes: ["agent_overruled", "unit_price"] });
    expect(signer.count("create")).toBe(0);
  });

  it("the supplier removed from the live policy after the quote is declined: the agent sees the live checks", async () => {
    const deal = await quoted();
    setPolicy([]);
    const { deal: declined } = await decideQuote(deps(), deal.id);
    expect(declined.decision?.reasonCodes).toEqual(["agent_declined"]);
    expect(declined.decision?.agent.reason).toContain("approved_supplier");
  });

  it("the supplier removed while the agent decides is DECLINED agent_overruled approved_supplier", async () => {
    const deal = await quoted();
    const racing: QuoteDecider = {
      kind: "stand-in",
      model: null,
      async decide(input) {
        setPolicy([]);
        return ruleFollowingDecider.decide(input);
      },
    };
    const { deal: declined } = await decideQuote(deps(racing), deal.id);
    expect(declined.decision?.reasonCodes).toEqual(["agent_overruled", "approved_supplier"]);
    expect(signer.count("create")).toBe(0);
  });

  it("decideQuote again on an ACCEPTED deal returns the same job and createEscrow saw one opId", async () => {
    const deal = await quoted();
    const first = await decideQuote(deps(), deal.id);
    const second = await decideQuote(deps(), deal.id);
    expect(second.job?.id).toBe(first.job?.id);
    expect(second.deal.state).toBe("ACCEPTED");
    expect(signer.opIds("create")).toHaveLength(1);
  });

  it("a lock that fails inconclusively leaves the deal ACCEPTED and the next call locks with the same opId", async () => {
    const deal = await quoted();
    const real = signer.createEscrow.bind(signer);
    let failOnce = true;
    signer.createEscrow = async (req) => {
      if (failOnce) {
        failOnce = false;
        await real(req).catch(() => {});
        throw signerError("ledger_failure");
      }
      return real(req);
    };
    await expect(decideQuote(deps(), deal.id)).rejects.toMatchObject({ code: "ledger_failure" });
    expect((await repo.getDeal(deal.id))?.state).toBe("ACCEPTED");
    const { job } = await decideQuote(deps(), deal.id);
    expect(job?.state).toBe("LOCKED");
    expect(signer.opIds("create")).toHaveLength(1);
  });

  it("a deal that has no quote yet cannot be decided", async () => {
    const deal = await openDeal(deps(), intent());
    await expect(decideQuote(deps(), deal.id)).rejects.toThrow(/AWAITING_QUOTE/);
  });
});

describe("submitDocuments: the Settlement step", () => {
  it("submitDocuments delivers the honest documents and the job is DELIVERED", async () => {
    const deal = await quoted();
    await decideQuote(deps(), deal.id);
    const job = await submitDocuments(deps(), deal.id, presets["docs-honest"]);
    expect(job.state).toBe("DELIVERED");
    expect(job.deliverable).toEqual(presets["docs-honest"]);
  });

  it("changed documents after delivery throw DeliverableConflict", async () => {
    const deal = await quoted();
    await decideQuote(deps(), deal.id);
    await submitDocuments(deps(), deal.id, presets["docs-honest"]);
    await expect(submitDocuments(deps(), deal.id, presets["docs-wallet-changed"])).rejects.toBeInstanceOf(DeliverableConflict);
  });

  it("documents for a deal that has not locked are refused", async () => {
    const deal = await quoted();
    await expect(submitDocuments(deps(), deal.id, presets["docs-honest"])).rejects.toThrow(/only after the payment locks/);
  });
});
