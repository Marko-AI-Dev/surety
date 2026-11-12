import { describe, expect, it } from "vitest";
import { dealStages } from "../src/data/buyer";
import { RECORDINGS, recordingOf } from "../src/data/evidence";
import { INSPECTOR_ROW, chatRows, headline, recordUpTo } from "../src/data/livescreen";
import { liveLine, statusLine } from "../src/data/plain";
import { buildTimeline, timelineBounds, viewAt } from "../src/data/timeline";

// Every recorded run the app can play back, read exactly as the screen reads it.
const play = (id: string) => {
  const { record } = recordingOf(id);
  const steps = buildTimeline(record);
  const { start, end } = timelineBounds(steps);
  const view = viewAt(record, steps, end);
  return { record, steps, start, end, view, stages: Object.fromEntries(dealStages(record, view).map((s) => [s.id, s.state])), status: statusLine(record, view) };
};

describe("the recorded runs", () => {
  it("offers four, and the default is a paid purchase with the inspector's second key", () => {
    expect(RECORDINGS.map((r) => r.id)).toEqual(["paid", "refused", "expired", "first"]);
    expect(recordingOf("nonsense").id).toBe("paid");
    expect(RECORDINGS[0]?.record.inspection?.state).toBe("attested");
  });

  it("paid: the inspector confirmed, then the check passed, then the money was released", () => {
    const p = play("paid");
    expect(p.view).toMatchObject({ paid: true, refunded: false, inspection: "attested" });
    expect(p.stages).toMatchObject({ inspector: "done", verify: "done", settled: "done" });
    const order = p.steps.map((s) => s.kind);
    expect(order.indexOf("inspected")).toBeLessThan(order.indexOf("verified"));
    expect(order.indexOf("verified")).toBeLessThan(order.indexOf("paid"));
    expect(p.status.now).toBe("Done. Sunpeak Energy Ltd was paid $46,400.00.");
    // This run carries an event log, so the lock and the payout have real times.
    expect(p.steps.find((s) => s.kind === "locked")?.timed).toBe(true);
    expect(p.steps.find((s) => s.kind === "paid")?.timed).toBe(true);
    expect(headline(p.record, p.view).money).toMatchObject({ state: "paid", cents: 4_640_000 });
  });

  it("paid: the price number follows the supplier that won, not the cheapest opening offer (live test, 12 Nov)", () => {
    const p = play("paid");
    // Brightway opened lowest at $118, but the Lead chose Sunpeak, which came from $126 to $116.
    expect(headline(p.record, p.view)).toMatchObject({ supplierName: "Sunpeak Energy Ltd", chosen: true, openingBestCents: 12_600, bestNowCents: 11_600, movedCents: 1_000, movedTotalCents: 400_000 });
    // Before the choice it follows one supplier too: the name and both prices belong together.
    const early = headline(p.record, viewAt(p.record, p.steps, (p.steps.find((x) => x.kind === "locked")?.at ?? 0) - 1));
    expect(early.supplierName).not.toBeNull();
  });

  it("the live banner only says a purchase is happening when one is", () => {
    const p = play("paid");
    expect(liveLine(null)).toBe("No purchase is running. Start one below.");
    expect(liveLine(viewAt(p.record, p.steps, p.start))).toContain("happening now");
    expect(liveLine(p.view)).toContain("has finished");
  });

  it("refused: the inspector's refusal stops the payment and the buyer is refunded, in plain words", () => {
    const r = play("refused");
    expect(r.view).toMatchObject({ paid: false, refunded: true, inspection: "refused" });
    expect(r.stages).toMatchObject({ inspector: "stopped", verify: "stopped", settled: "stopped" });
    expect(r.status).toMatchObject({ now: "Refunded. $44,400.00 is back in your treasury.", tone: "stop" });
    expect(r.status.detail).toBe("The inspector did not confirm the shipment, so the ledger returned the money at the deadline.");
    expect(chatRows(r.record, r.view).find((x) => x.id === INSPECTOR_ROW)).toMatchObject({ last: "Did not confirm the shipment.", tone: "stop" });
    expect(headline(r.record, r.view).money).toMatchObject({ state: "refunded", tx: { txHash: r.record.cancel?.txHash } });
  });

  it("expired: with no answer in time nothing is paid, and the screen says why", () => {
    const e = play("expired");
    expect(e.view).toMatchObject({ paid: false, refunded: true, locked: true });
    expect(e.stages.settled).toBe("stopped");
    expect(e.status.now).toBe("Refunded. $47,200.00 is back in your treasury.");
    expect(e.status.detail).not.toContain("did not pass");
  });

  it("no recording ever shows money paid before its lock, or a later fact early", () => {
    for (const rec of RECORDINGS) {
      const { record, steps, start, end } = play(rec.id);
      let wasLocked = false;
      for (let t = start; t <= end; t += 5_000) {
        const v = viewAt(record, steps, t);
        if (v.paid) expect(wasLocked).toBe(true);
        wasLocked = wasLocked || v.locked;
        const partial = recordUpTo(record, steps, t);
        if (partial) {
          expect(Boolean(partial.finish)).toBe(v.paid);
          expect(Boolean(partial.cancel)).toBe(v.refunded);
          expect(partial.messages.length).toBe(v.messages.length);
        }
      }
    }
  });
});
