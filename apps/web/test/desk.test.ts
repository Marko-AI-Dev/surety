import { describe, expect, it } from "vitest";
import { parseHash } from "../src/App";
import { adminLog, deskStage, reviewOf, threadOf, trackerOf } from "../src/data/desk";
import { recordingOf } from "../src/data/evidence";
import { headline } from "../src/data/livescreen";
import { proxyDecision } from "../src/data/proxy-policy";
import { buildTimeline, timelineBounds, viewAt } from "../src/data/timeline";
import type { SourcingRecord } from "../src/data/types";

// The buyer's desk, read exactly as the screen reads it, from the recorded runs.
const play = (id: string, at?: (b: { start: number; end: number }) => number) => {
  const { record } = recordingOf(id);
  const steps = buildTimeline(record);
  const bounds = timelineBounds(steps);
  return { record, steps, ...bounds, view: viewAt(record, steps, at ? at(bounds) : bounds.end) };
};
const SUNPEAK = (r: SourcingRecord) => r.invites.find((i) => i.name.startsWith("Sunpeak"))?.address ?? "";

// A live record at the moment the Lead has recommended Sunpeak and the buyer has not answered: the
// paid recording with everything after the decision taken away, and the approval the API adds.
function waiting(): SourcingRecord {
  const { record } = recordingOf("paid");
  const supplier = SUNPEAK(record);
  return {
    ...record,
    deals: [],
    job: null,
    verify: null,
    inspection: null,
    create: null,
    finish: null,
    cancel: null,
    events: [],
    approval: { state: "waiting", dealId: "11111111-2222-4333-8444-555555555555", supplier, leadReason: "A week faster for $5 more, and you asked for a balance.", at: record.sourcing.negotiationEndsAt, answeredAt: null },
    buyerNotes: [{ text: "Ask about the warranty.", at: record.messages[2]?.at ?? record.sourcing.negotiationEndsAt }],
  };
}
const viewOf = (record: SourcingRecord) => {
  const steps = buildTimeline(record, { now: Date.parse(record.sourcing.negotiationEndsAt) + 60_000 });
  return viewAt(record, steps, Date.parse(record.sourcing.negotiationEndsAt) + 60_000);
};

describe("where the purchase stands for the buyer", () => {
  it("nothing running is 'ask'; a negotiation is 'working'; then the outcome", () => {
    expect(deskStage(null, null)).toBe("ask");
    const early = play("paid", (b) => b.start + 20_000);
    expect(deskStage(early.record, early.view)).toBe("working");
    expect(deskStage(play("paid").record, play("paid").view)).toBe("done");
    expect(deskStage(play("refused").record, play("refused").view)).toBe("refunded");
  });

  it("a recommendation waiting for the buyer is 'review', and nothing is locked while it waits", () => {
    const record = waiting();
    const view = viewOf(record);
    expect(deskStage(record, view)).toBe("review");
    expect(view).toMatchObject({ locked: false, paid: false, refunded: false });
    expect(headline(record, view).money).toMatchObject({ state: "none", cents: 0 });
    expect(deskStage({ ...record, approval: { ...record.approval!, state: "declined" } }, view)).toBe("declined");
  });
});

describe("the review the Lead brings", () => {
  it("lists every committed quote, marks the Lead's pick and carries its reason", () => {
    const record = waiting();
    const review = reviewOf(record);
    expect(review?.deals.map((d) => [d.name, d.unitCents, d.deliveryDays, d.pick])).toEqual([
      ["Sunpeak Energy Ltd", 11_600, 14, true],
      ["Shenzhen Brightway Solar Co., Ltd", 11_100, 21, false],
    ]);
    expect(review?.pick).toMatchObject({ totalCents: 4_640_000 });
    expect(review?.reason).toBe("A week faster for $5 more, and you asked for a balance.");
    expect(reviewOf(recordingOf("paid").record)).toBeNull();
  });

  it("the price number follows the supplier the Lead recommends, before the buyer answers", () => {
    const record = waiting();
    expect(headline(record, viewOf(record))).toMatchObject({ supplierName: "Sunpeak Energy Ltd", openingBestCents: 12_600, bestNowCents: 11_600 });
  });
});

describe("a conversation as an email thread", () => {
  it("copies the buyer in on every message, and never shows the text of a held one", () => {
    const { record, view } = play("refused");
    const crook = record.invites.find((i) => i.status === "out")?.address ?? "";
    const mails = threadOf(record, view, crook);
    const held = mails.filter((m) => m.held);
    expect(held).toHaveLength(2);
    expect(held.map((m) => m.held?.card)).toEqual(["yellow", "red"]);
    for (const m of held) expect(m.body).toBeNull();
    expect(JSON.stringify(mails)).not.toContain("pre-verified");
    expect(JSON.stringify(mails)).not.toContain("new wallet r");
    const ok = threadOf(record, view, record.invites[0]?.address ?? "");
    expect(ok[0]).toMatchObject({ from: "Your negotiator", mine: true, held: null });
    expect(ok.some((m) => !m.mine && m.body)).toBe(true);
  });
});

describe("the tracker after the payment locks", () => {
  it("paid: every step done, the inspector's shipping number shown, and delivery marked as not tracked", () => {
    const { record, view } = play("paid");
    const locked = view.trail.find((s) => s.kind === "locked")?.at ?? 0;
    const t = trackerOf(record, view, locked + 7 * 86_400_000);
    expect(t?.steps.map((s) => [s.id, s.state])).toEqual([
      ["locked", "done"],
      ["paperwork", "done"],
      ["inspector", "done"],
      ["check", "done"],
      ["paid", "done"],
      ["delivery", "todo"],
    ]);
    expect(t).toMatchObject({ supplier: "Sunpeak Energy Ltd", totalCents: 4_640_000, blNumber: "SZXDUR-77290", deliveryDays: 14 });
    expect(t?.progress).toBeCloseTo(0.5, 2);
    expect(t?.steps.find((s) => s.id === "delivery")?.notTracked).toBe(true);
    expect(t?.steps.find((s) => s.id === "locked")?.tx?.txHash).toBe(record.create?.txHash);
    expect(t?.steps.find((s) => s.id === "paid")?.tx?.txHash).toBe(record.finish?.txHash);
  });

  it("refused: the inspector's step is stopped, the money is back, and there is no delivery step", () => {
    const { record, view } = play("refused");
    const t = trackerOf(record, view, view.t);
    expect(t?.steps.find((s) => s.id === "inspector")).toMatchObject({ state: "stopped" });
    expect(t?.steps.find((s) => s.id === "paid")).toMatchObject({ label: "Money returned to you", tx: { txHash: record.cancel?.txHash } });
    expect(t?.steps.some((s) => s.id === "delivery")).toBe(false);
    expect(t?.blNumber).toBeNull();
  });

  it("there is no tracker before the payment locks", () => {
    const record = waiting();
    expect(trackerOf(record, viewOf(record), Date.now())).toBeNull();
  });
});

describe("the admin log", () => {
  it("tells the whole purchase oldest first, with both ledger links and who did what", () => {
    const { record, view } = play("paid");
    const log = adminLog(record, view);
    expect(log.map((e) => e.at)).toEqual([...log.map((e) => e.at)].sort((a, b) => a - b));
    expect(log.filter((e) => e.tx).map((e) => e.tx?.txHash)).toEqual([record.create?.txHash, record.finish?.txHash]);
    expect(log.some((e) => e.who === "Negotiator (agent)" && e.what.startsWith("Wrote to "))).toBe(true);
    expect(log.some((e) => e.who === "Inspector (a person)")).toBe(true);
    expect(log.some((e) => e.who === "Surety's signer" && e.tone === "ok")).toBe(true);
  });

  it("a stopped message is logged as stopped, with its card, and never with its text", () => {
    const { record, view } = play("refused");
    const stopped = adminLog(record, view).filter((e) => e.who === "Surety's bouncer");
    expect(stopped.map((e) => e.tone)).toEqual(["held", "stop"]);
    expect(stopped[0]?.what).toContain("yellow card");
    expect(JSON.stringify(stopped)).not.toContain("pre-verified");
  });

  it("carries the buyer's notes, the Lead's recommendation and the buyer's answer", () => {
    const record = waiting();
    const log = adminLog({ ...record, approval: { ...record.approval!, state: "approved", answeredAt: new Date(Date.parse(record.approval!.at) + 5_000).toISOString() } }, viewOf(record));
    expect(log.some((e) => e.who === "You" && e.what.includes("Ask about the warranty."))).toBe(true);
    expect(log.some((e) => e.who === "Lead (agent)" && e.what.includes("asked for your yes"))).toBe(true);
    expect(log.at(-1)).toMatchObject({ who: "You", what: "Said yes. Only then could the payment lock." });
  });
});

describe("the menu and the proxy", () => {
  it("has two places; old links land in the admin; the phone pages keep their own links and tokens", () => {
    expect(parseHash("")).toMatchObject({ route: "desk" });
    expect(parseHash("#/")).toMatchObject({ route: "desk" });
    expect(parseHash("#/admin")).toMatchObject({ route: "admin", tab: "log" });
    expect(parseHash("#/admin/ask")).toMatchObject({ route: "admin", tab: "ask" });
    expect(parseHash("#/control")).toMatchObject({ route: "admin", tab: "control" });
    expect(parseHash("#/attack")).toMatchObject({ route: "admin", tab: "attacks" });
    expect(parseHash("#/supplier?t=abc")).toMatchObject({ route: "supplier", token: "abc" });
    expect(parseHash("#/inspector?t=xyz")).toMatchObject({ route: "inspector", token: "xyz" });
    expect(parseHash("#/nonsense")).toMatchObject({ route: "desk" });
  });

  it("the buyer's actions get the token only from this app's own page on this machine, and nothing else may be posted", () => {
    const own = { host: "localhost:5173", origin: "http://localhost:5173", "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const id = "11111111-2222-4333-8444-555555555555";
    const post = (path: string, headers: Record<string, unknown> = own, remoteAddress = "127.0.0.1") => proxyDecision({ method: "POST", path, remoteAddress, headers });
    for (const path of ["/api/demo/start", "/api/buyer/intake", "/api/admin/ask", `/api/sourcing/${id}/notes`, `/api/deals/${id}/approval`]) {
      expect(post(path)).toBe("inject");
      expect(post(path, own, "192.168.1.20")).toBe("refuse");
      expect(post(path, { ...own, origin: "http://evil.example" })).toBe("refuse");
      expect(post(path, { ...own, "sec-fetch-site": "cross-site" })).toBe("refuse");
      expect(post(path, { ...own, "content-type": "text/plain" })).toBe("refuse");
      expect(post(path, { ...own, host: "evil.example" })).toBe("refuse");
      expect(post(path, { ...own, "x-forwarded-for": "1.2.3.4" })).toBe("refuse");
    }
    for (const path of [`/api/deals/${id}/decision`, "/api/sourcing", `/api/sourcing/${id}/select`, `/api/sourcing/${id}/messages`, `/api/deals/not-an-id/approval`]) expect(post(path)).toBe("refuse");
  });
});
