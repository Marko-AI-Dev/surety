import { describe, expect, it } from "vitest";
import { auditStages, currentStep, dealSteps } from "../src/data/audit";
import { adminLog } from "../src/data/desk";
import { recordingOf } from "../src/data/evidence";
import { buildTimeline, timelineBounds, viewAt } from "../src/data/timeline";
import type { SourcingRecord } from "../src/data/types";

// The deal in the order it happens, read exactly as the buyer's rail and the admin's audit read it.
const play = (id: string, at?: (b: { start: number; end: number }) => number) => {
  const { record } = recordingOf(id);
  const steps = buildTimeline(record);
  const bounds = timelineBounds(steps);
  return { record, ...bounds, view: viewAt(record, steps, at ? at(bounds) : bounds.end) };
};
const viewOf = (record: SourcingRecord) => {
  const at = Date.parse(record.sourcing.negotiationEndsAt) + 60_000;
  return viewAt(record, buildTimeline(record, { now: at }), at);
};
const SUNPEAK = (r: SourcingRecord) => r.invites.find((i) => i.name.startsWith("Sunpeak"))?.address ?? "";
const iso = (r: SourcingRecord, plusMs: number) => new Date(Date.parse(r.sourcing.negotiationEndsAt) + plusMs).toISOString();
function negotiating(extra: Partial<SourcingRecord> = {}): SourcingRecord {
  const { record } = recordingOf("paid");
  return { ...record, sourcing: { ...record.sourcing, state: "OPEN" }, deals: [], job: null, verify: null, inspection: null, create: null, finish: null, cancel: null, events: [], approval: null, ...extra };
}
const states = (r: SourcingRecord) => dealSteps(r, viewOf(r)).map((s) => [s.id, s.state]);

describe("the six steps of a deal", () => {
  it("are always the same six, in order, numbered from one", () => {
    const { record, view } = play("paid");
    const steps = dealSteps(record, view);
    expect(steps.map((s) => s.id)).toEqual(["brief", "suppliers", "negotiating", "decision", "locked", "settled"]);
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("while the agents negotiate: negotiating is the step in progress and nothing after it has started", () => {
    const r = negotiating();
    expect(states(r)).toEqual([
      ["brief", "done"],
      ["suppliers", "done"],
      ["negotiating", "now"],
      ["decision", "todo"],
      ["locked", "todo"],
      ["settled", "todo"],
    ]);
    const steps = dealSteps(r, viewOf(r));
    expect(currentStep(steps)).toBe("negotiating");
    expect(steps.find((s) => s.id === "locked")?.summary).toBe("Only on your yes");
    expect(steps.find((s) => s.id === "suppliers")?.summary).toBe("2 invited");
  });

  it("a recommendation waits on the buyer, and the payment step still says nothing is locked", () => {
    const base = negotiating();
    const r = negotiating({ approval: { state: "waiting", dealId: "d", supplier: SUNPEAK(base), leadReason: "A week faster.", at: iso(base, 1_000), answeredAt: null } });
    const steps = dealSteps(r, viewOf(r));
    expect(steps.find((s) => s.id === "decision")).toMatchObject({ state: "now", summary: "Waiting for you" });
    expect(steps.find((s) => s.id === "locked")).toMatchObject({ state: "todo", summary: "Only on your yes" });
    expect(currentStep(steps)).toBe("decision");
  });

  it("a no stops at the decision: nothing is locked and nothing is paid", () => {
    const base = negotiating();
    const r = negotiating({ approval: { state: "declined", dealId: "d", supplier: SUNPEAK(base), leadReason: "A week faster.", at: iso(base, 1_000), answeredAt: iso(base, 9_000) } });
    const steps = dealSteps(r, viewOf(r));
    expect(steps.find((s) => s.id === "decision")).toMatchObject({ state: "stopped", summary: "You said no" });
    expect(steps.find((s) => s.id === "locked")).toMatchObject({ state: "todo", summary: "Nothing was locked" });
    expect(steps.find((s) => s.id === "settled")?.state).toBe("todo");
    expect(currentStep(steps)).toBe("decision");
  });

  it("a paid purchase is done at every step; a refunded one stops at the last", () => {
    const paid = play("paid");
    expect(dealSteps(paid.record, paid.view).every((s) => s.state === "done")).toBe(true);
    expect(dealSteps(paid.record, paid.view).at(-1)).toMatchObject({ label: "Checked and paid", summary: "Supplier paid" });
    const refused = play("refused");
    expect(dealSteps(refused.record, refused.view).at(-1)).toMatchObject({ label: "Refunded", state: "stopped", summary: "Money returned to you" });
    expect(dealSteps(refused.record, refused.view).find((s) => s.id === "locked")?.state).toBe("done");
  });

  it("the silent unnamed wallet is not counted among the invited suppliers", () => {
    const { record, view } = play("paid");
    expect(dealSteps(record, view).find((s) => s.id === "suppliers")?.detail).not.toContain("rMAmWT");
  });
});

describe("the admin's audit", () => {
  it("gives every event to exactly one stage, and keeps them in time order inside it", () => {
    const { record, view } = play("paid");
    const stages = auditStages(record, view);
    const all = stages.flatMap((s) => s.events);
    expect(all).toHaveLength(adminLog(record, view).length);
    expect(new Set(all.map((e) => e.key)).size).toBe(all.length);
    for (const s of stages) expect(s.events.map((e) => e.at)).toEqual([...s.events.map((e) => e.at)].sort((a, b) => a - b));
    expect(stages.find((s) => s.id === "negotiating")?.events.length).toBeGreaterThan(5);
  });

  it("carries the ledger proof on the two steps that moved money, and nowhere else", () => {
    const { record, view } = play("paid");
    const stages = auditStages(record, view);
    expect(stages.find((s) => s.id === "locked")?.tx?.txHash).toBe(record.create?.txHash);
    expect(stages.find((s) => s.id === "settled")?.tx?.txHash).toBe(record.finish?.txHash);
    expect(stages.filter((s) => s.tx).map((s) => s.id)).toEqual(["locked", "settled"]);
    const refused = play("refused");
    expect(auditStages(refused.record, refused.view).find((s) => s.id === "settled")?.tx?.txHash).toBe(refused.record.cancel?.txHash);
  });

  it("states the facts an auditor asks for, and never the text of a stopped message", () => {
    const { record, view } = play("refused");
    const stages = auditStages(record, view);
    const facts = (id: string) => stages.find((s) => s.id === id)?.facts ?? [];
    expect(facts("brief").find((f) => f.label === "Price")?.value).toContain("The negotiator never saw the maximum.");
    expect(facts("suppliers").some((f) => f.value === "Invited, then removed by Surety.")).toBe(true);
    expect(facts("settled").some((f) => f.label === "Returned" && f.value.includes("The supplier was not paid."))).toBe(true);
    expect(JSON.stringify(stages)).not.toContain("pre-verified");
    expect(JSON.stringify(stages)).not.toContain("new wallet r");
  });

  it("says who decided: the buyer when there is an approval, and nothing locked before it", () => {
    const { record, view } = play("paid");
    const withYes = { ...record, approval: { state: "approved" as const, dealId: "d", supplier: SUNPEAK(record), leadReason: "A week faster.", at: iso(record, 1_000), answeredAt: iso(record, 9_000) } };
    const decision = auditStages(withYes, view).find((s) => s.id === "decision");
    expect(decision?.facts.find((f) => f.label === "Decided by")?.value).toMatch(/^The buyer said yes at \d\d:\d\d:\d\d\. Nothing was locked before this\.$/);
    expect(decision?.facts.find((f) => f.label === "Recommended by")?.value).toBe("Lead (agent): Sunpeak Energy Ltd. A week faster.");
    expect(decision?.facts.some((f) => f.label === "Other offer" && f.value.includes("Not chosen."))).toBe(true);
    expect(decision?.events.map((e) => e.key)).toEqual(expect.arrayContaining(["approval:asked", "approval:answered"]));
  });
});

describe("the escrow ledger", () => {
  it("groups validated transactions by purchase, with the record's own hashes", async () => {
    const { recordedLedger, liveLedger } = await import("../src/data/ledger");
    const { record } = recordingOf("paid");
    const paid = recordedLedger().find((p) => p.ref === record.sourcing.ref);
    expect(paid).toMatchObject({ state: "paid", cents: Number(record.job?.amount.cents), supplier: "Sunpeak Energy Ltd" });
    expect(paid?.rows.map((r) => [r.kind, r.ledgerType, r.tx.txHash])).toEqual([
      ["lock", "EscrowCreate", record.create?.txHash],
      ["release", "EscrowFinish", record.finish?.txHash],
    ]);
    expect(paid?.rows.every((r) => r.tx.explorer.includes(r.tx.txHash))).toBe(true);
    const refused = recordedLedger().find((p) => p.ref === recordingOf("refused").record.sourcing.ref);
    expect(refused).toMatchObject({ state: "refunded" });
    expect(refused?.rows.map((r) => r.kind)).toEqual(["lock", "refund"]);
    // A purchase with no validated transaction is not listed.
    expect(liveLedger([{ id: "x", ref: "SR-1", state: "OPEN", ledger: { create: null, finish: null, cancel: null } }])).toEqual([]);
  });

  it("never adds purchases up as if they were held at once: settled purchases hold nothing", async () => {
    const { ledgerTotals, recordedLedger } = await import("../src/data/ledger");
    const t = ledgerTotals(recordedLedger());
    expect(t).toMatchObject({ inEscrowCents: 0, inEscrow: 0 });
    expect(t.paid + t.refunded).toBe(recordedLedger().length);
    // A purchase that is locked and not yet settled is the only thing that counts as held.
    const open = ledgerTotals([{ ref: "SR-1", about: "x", when: null, cents: 4_640_000, supplier: "S", state: "in_escrow", rows: [] }]);
    expect(open).toMatchObject({ inEscrowCents: 4_640_000, inEscrow: 1, paidCents: 0, refundedCents: 0 });
  });
});
