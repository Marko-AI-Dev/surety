import { describe, expect, it } from "vitest";
import { recordedRun } from "../src/data/evidence";
import { GLOSSARY, HOW_IT_WORKS, statusLine, verdictPlain } from "../src/data/plain";
import { buildTimeline, timelineBounds, viewAt } from "../src/data/timeline";
import type { SourcingRecord } from "../src/data/types";

const steps = buildTimeline(recordedRun);
const { start, end } = timelineBounds(steps);
const atStep = (id: string) => viewAt(recordedRun, steps, steps.find((s) => s.id === id)?.at ?? Number.NaN);
const line = (id: string) => statusLine(recordedRun, atStep(id));

describe("the one sentence that says what is happening", () => {
  it("says nothing has started before the purchase opens", () => {
    expect(statusLine(recordedRun, viewAt(recordedRun, steps, start)).now).toBe("Nothing has started yet.");
  });

  it("says the money has not moved at every moment before the lock", () => {
    const lockAt = steps.find((s) => s.kind === "locked")?.at ?? 0;
    for (const s of steps.filter((x) => x.at < lockAt && x.kind !== "decision")) {
      const l = statusLine(recordedRun, viewAt(recordedRun, steps, s.at));
      expect(`${l.now} ${l.detail}`).toContain("Your money has not moved.");
    }
  });

  it("names the removal of the crook while the negotiation is still running", () => {
    const redCard = steps.find((s) => s.kind === "message" && s.title.includes("red card"));
    const l = statusLine(recordedRun, viewAt(recordedRun, steps, redCard?.at ?? 0));
    expect(l.now).toBe("Your agents are negotiating with 4 suppliers.");
    expect(l.detail).toBe("1 supplier was removed for trying to manipulate them. Your money has not moved.");
  });

  it("follows the money: chosen, locked, checked, paid", () => {
    expect(line("closed").now).toBe("The negotiation is over. Your Lead agent is choosing a supplier.");
    expect(line("closed").detail).toBe("2 suppliers submitted a final price. Your money has not moved.");
    expect(atStep(`decision:${recordedRun.deals?.[0]?.id}`).accepted).not.toBeNull();
    expect(statusLine(recordedRun, atStep(`decision:${recordedRun.deals?.[0]?.id}`)).now).toBe("Your Lead agent chose Shenzhen Brightway Solar Co., Ltd at $114.00 a unit.");
    expect(line("locked")).toMatchObject({ now: "$45,600.00 is locked on the ledger for Shenzhen Brightway Solar Co., Ltd.", tone: "money" });
    expect(line("documents").now).toBe("Checking Shenzhen Brightway Solar Co., Ltd's paperwork against your order.");
    expect(line("verified").now).toBe("The paperwork passed. $45,600.00 is being released to Shenzhen Brightway Solar Co., Ltd.");
    expect(line("paid")).toMatchObject({ now: "Done. Shenzhen Brightway Solar Co., Ltd was paid $45,600.00.", tone: "ok" });
  });

  it("a failed check and a refund are said as plainly as a payment", () => {
    const failed: SourcingRecord = {
      ...recordedRun,
      verify: { outcome: "DECLINE", satisfaction: null, injectionRisk: null, reasonCodes: ["rule:pay_to"], policyVersion: "policy-v4-trade" },
      finish: null,
      cancel: { ...(recordedRun.create as NonNullable<SourcingRecord["create"]>) },
    };
    const s = buildTimeline(failed);
    const at = (kind: string) => viewAt(failed, s, s.find((x) => x.kind === kind)?.at ?? Number.NaN);
    expect(statusLine(failed, at("verified"))).toMatchObject({ now: "The paperwork did not pass.", tone: "stop" });
    expect(statusLine(failed, at("refunded"))).toMatchObject({ now: "Refunded. $45,600.00 is back in your treasury.", tone: "stop" });
  });

  it("a record with an inspection says it is waiting for the inspector", () => {
    const pending: SourcingRecord = { ...recordedRun, inspection: { state: "pending" } };
    const s = buildTimeline(pending);
    expect(statusLine(pending, viewAt(pending, s, s.find((x) => x.kind === "documents")?.at ?? 0)).now).toBe("Waiting for the inspector to confirm the shipment.");
  });

  it("never uses our own jargon in the sentence a newcomer reads first", () => {
    for (let t = start; t <= end; t += 3_000) {
      const l = statusLine(recordedRun, viewAt(recordedRun, steps, t));
      expect(`${l.now} ${l.detail}`).not.toMatch(/escrow|XRPL|bouncer|Verify|tesSUCCESS|policy|quote|TESTUSD/i);
    }
  });
});

describe("what the bouncer did with a message, in a sentence", () => {
  const final = viewAt(recordedRun, steps, end);
  const from = final.messages.filter((m) => m.kind === "from_supplier");

  it("delivered, steered and wrong-wallet messages each get their own plain line", () => {
    const lines = from.map((m) => verdictPlain(m).text);
    expect(lines.filter((t) => t === "Delivered to the Negotiator.")).toHaveLength(4);
    expect(lines).toContain("Held. It tried to tell the buyer's agent what to do.");
    expect(lines).toContain("Held. It named a wallet that is not this supplier's approved one.");
  });

  it("a held message is never described as delivered", () => {
    for (const m of from) expect(verdictPlain(m).tone === "ok").toBe(m.delivered);
  });
});

describe("the explanations", () => {
  it("every term and every step is a short, complete sentence without a dash", () => {
    for (const t of [...Object.values(GLOSSARY).map((g) => g.means), ...HOW_IT_WORKS.map((h) => h.text)]) {
      expect(t.length).toBeLessThan(220);
      expect(t.endsWith(".")).toBe(true);
      expect(t).not.toMatch(/—|--/);
    }
    expect(HOW_IT_WORKS).toHaveLength(5);
  });
});
