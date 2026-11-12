import { describe, expect, it } from "vitest";
import { buyerFeed, dealStages } from "../src/data/buyer";
import { recordedRun as RECORDED_RUN } from "../src/data/evidence";
import { buildTimeline, timelineBounds, viewAt } from "../src/data/timeline";
import type { SourcingRecord } from "../src/data/types";

const steps = buildTimeline(RECORDED_RUN);
const { start, end } = timelineBounds(steps);
const at = (t: number) => viewAt(RECORDED_RUN, steps, t);
const final = at(end);

describe("the Buy view's negotiation feed", () => {
  it("is empty before the sourcing opens", () => {
    expect(buyerFeed(RECORDED_RUN, at(start))).toEqual([]);
  });

  it("merges the same line sent to every supplier at once into one bubble", () => {
    const feed = buyerFeed(RECORDED_RUN, final);
    const first = feed[0];
    expect(first).toMatchObject({ kind: "negotiator" });
    if (first?.kind !== "negotiator") throw new Error("expected the negotiator's opening line");
    expect(first.to).toHaveLength(4);
    expect(new Set(first.suppliers).size).toBe(4);
    // 12 negotiator messages in the record: 4 openers, 2 counters, 4 closers. Three bubbles.
    expect(feed.filter((i) => i.kind === "negotiator").map((i) => (i.kind === "negotiator" ? i.to.length : 0))).toEqual([4, 2, 4]);
  });

  it("never carries the text of a held message, only that one was held", () => {
    const feed = buyerFeed(RECORDED_RUN, final);
    const held = feed.filter((i) => i.kind === "held");
    expect(held.map((h) => (h.kind === "held" ? [h.card, h.removed] : null))).toEqual([
      ["yellow", false],
      ["red", true],
    ]);
    const text = JSON.stringify(feed);
    for (const m of RECORDED_RUN.messages.filter((m) => m.kind === "from_supplier" && !m.delivered)) expect(text).not.toContain(m.body);
  });

  it("leaves the negotiator's reports to the Lead out, and shows every delivered supplier message", () => {
    const feed = buyerFeed(RECORDED_RUN, final);
    const delivered = RECORDED_RUN.messages.filter((m) => m.kind === "from_supplier" && m.delivered);
    expect(feed.filter((i) => i.kind === "supplier").map((i) => (i.kind === "supplier" ? i.text : ""))).toEqual(delivered.map((m) => m.body));
    for (const r of RECORDED_RUN.messages.filter((m) => m.kind === "report")) expect(JSON.stringify(feed)).not.toContain(r.body);
  });

  it("shows each committed quote, and flags the one over the maximum", () => {
    const quotes = buyerFeed(RECORDED_RUN, final).filter((i) => i.kind === "quote");
    expect(quotes.map((q) => (q.kind === "quote" ? [q.unitCents, q.overMaximum] : null))).toEqual([
      [11_400, false],
      [12_400, true],
    ]);
  });

  it("grows with the run and never reorders", () => {
    let last: string[] = [];
    for (let t = start; t <= end; t += 5_000) {
      const keys = buyerFeed(RECORDED_RUN, at(t)).map((i) => i.key);
      expect(keys.slice(0, last.length)).toEqual(last);
      last = keys;
    }
  });
});

describe("the deal's stages", () => {
  const states = (r: SourcingRecord, t: number) => {
    const s = buildTimeline(r);
    return Object.fromEntries(dealStages(r, viewAt(r, s, t)).map((x) => [x.id, x.state]));
  };

  it("has nine stages in a fixed order, with the inspector between the documents and Surety Verify", () => {
    expect(dealStages(RECORDED_RUN, final).map((s) => s.id)).toEqual([
      "brief",
      "suppliers",
      "negotiation",
      "decision",
      "locked",
      "documents",
      "inspector",
      "verify",
      "settled",
    ]);
  });

  it("starts with nothing done and ends with everything done except the inspector, which the recorded run did not have", () => {
    expect(new Set(Object.values(states(RECORDED_RUN, start)))).toEqual(new Set(["todo", "off"]));
    expect(states(RECORDED_RUN, end)).toEqual({
      brief: "done",
      suppliers: "done",
      negotiation: "done",
      decision: "done",
      locked: "done",
      documents: "done",
      inspector: "off",
      verify: "done",
      settled: "done",
    });
    expect(dealStages(RECORDED_RUN, final).find((s) => s.id === "inspector")?.note).toContain("Not part of this run");
  });

  it("never shows a later stage done before an earlier one", () => {
    const order = ["brief", "suppliers", "negotiation", "decision", "locked", "documents", "verify", "settled"];
    for (let t = start; t <= end; t += 2_000) {
      const s = states(RECORDED_RUN, t);
      const done = order.map((id) => s[id] === "done");
      expect(done.lastIndexOf(true)).toBeLessThan(done.indexOf(false) === -1 ? done.length : done.indexOf(false));
    }
  });

  it("a record with an inspection waits for it, then shows it attested before Surety Verify", () => {
    const attested: SourcingRecord = { ...RECORDED_RUN, inspection: { state: "attested", inspector: "Durban Marine Surveyors" } };
    const s = buildTimeline(attested);
    const kinds = s.map((x) => x.kind);
    expect(kinds.indexOf("inspected")).toBeGreaterThan(kinds.indexOf("documents"));
    expect(kinds.indexOf("inspected")).toBeLessThan(kinds.indexOf("verified"));
    const docsAt = s.find((x) => x.kind === "documents")?.at ?? 0;
    expect(viewAt(attested, s, docsAt).inspection).toBe("waiting");
    expect(dealStages(attested, viewAt(attested, s, docsAt)).find((x) => x.id === "inspector")?.state).toBe("now");
    expect(dealStages(attested, viewAt(attested, s, docsAt)).find((x) => x.id === "verify")?.state).toBe("todo");
    const endAt = timelineBounds(s).end;
    expect(viewAt(attested, s, endAt).inspection).toBe("attested");
    expect(dealStages(attested, viewAt(attested, s, endAt)).find((x) => x.id === "inspector")?.state).toBe("done");
  });

  it("a pending or refused inspection is shown as such, and the recorded run has none", () => {
    const pending: SourcingRecord = { ...RECORDED_RUN, inspection: { state: "pending" } };
    const sp = buildTimeline(pending);
    expect(sp.some((x) => x.kind === "inspected")).toBe(false);
    expect(viewAt(pending, sp, timelineBounds(sp).end).inspection).toBe("waiting");
    const refused: SourcingRecord = { ...RECORDED_RUN, inspection: { state: "refused" } };
    const sr = buildTimeline(refused);
    expect(dealStages(refused, viewAt(refused, sr, timelineBounds(sr).end)).find((x) => x.id === "inspector")?.state).toBe("stopped");
    expect(final.inspection).toBe("none");
  });
});
