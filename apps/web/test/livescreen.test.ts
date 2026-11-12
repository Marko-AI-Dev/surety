import { describe, expect, it } from "vitest";
import { recordedRun } from "../src/data/evidence";
import { ApiError, type FetchFn, createInspectorClient, createSimSource, startPurchase } from "../src/data/live";
import { INSPECTOR_ROW, LEAD_ROW, chatRows, headline, recordUpTo } from "../src/data/livescreen";
import { proxyDecision } from "../src/data/proxy-policy";
import { buildTimeline, timelineBounds, viewAt } from "../src/data/timeline";
import type { SourcingRecord } from "../src/data/types";
import { confirmLine } from "../src/views/Inspector";
import { phoneLink } from "../src/views/SeatQr";
import { validateBrief } from "../src/views/Start";

const steps = buildTimeline(recordedRun);
const { start, end } = timelineBounds(steps);
const at = (t: number) => viewAt(recordedRun, steps, t);
const atStep = (id: string) => at(steps.find((s) => s.id === id)?.at ?? Number.NaN);
const COASTLINE = "rJSkQt8iJSgRYDEaeE54uz26SYR5Pehhic";

describe("the three numbers on top", () => {
  it("are empty before anything is offered", () => {
    expect(headline(recordedRun, at(start))).toMatchObject({ openingBestCents: null, bestNowCents: null, movedCents: null, ejected: 0, money: { state: "none", cents: 0, tx: null } });
  });

  it("show the price the negotiation moved: best opening offer against best offer now", () => {
    const h = headline(recordedRun, at(end));
    // Brightway opened at $118 and Sunpeak at $126; Brightway's final price is $114.
    expect(h).toMatchObject({ openingBestCents: 11_800, bestNowCents: 11_400, movedCents: 400, movedTotalCents: 160_000 });
  });

  it("never count a held offer: the crook's $104 was never delivered or reported", () => {
    for (let t = start; t <= end; t += 4_000) {
      const h = headline(recordedRun, at(t));
      expect(h.bestNowCents === null || h.bestNowCents >= 11_400).toBe(true);
    }
  });

  it("count the crook once it is out, and not before", () => {
    const yellow = steps.find((s) => s.title.includes("yellow card"));
    const red = steps.find((s) => s.title.includes("red card"));
    expect(headline(recordedRun, at(yellow?.at ?? 0)).ejected).toBe(0);
    expect(headline(recordedRun, at(red?.at ?? 0)).ejected).toBe(1);
  });

  it("follow the money to its real ledger transaction", () => {
    expect(headline(recordedRun, atStep("locked")).money).toMatchObject({ state: "locked", cents: 4_560_000, tx: { txHash: recordedRun.create?.txHash } });
    expect(headline(recordedRun, atStep("paid")).money).toMatchObject({ state: "paid", cents: 4_560_000, tx: { txHash: recordedRun.finish?.txHash } });
    expect(headline(recordedRun, atStep("paid")).money.tx?.explorer).toContain("testnet.xrpl.org");
  });
});

describe("the conversation list", () => {
  it("has one row per invited supplier, then the Lead's decision and the inspector", () => {
    const rows = chatRows(recordedRun, at(end));
    expect(rows.map((r) => r.kind)).toEqual(["supplier", "supplier", "supplier", "supplier", "lead", "inspector"]);
    expect(rows.at(-2)?.id).toBe(LEAD_ROW);
    expect(rows.at(-1)?.id).toBe(INSPECTOR_ROW);
  });

  it("never shows the text of a held message, at any moment", () => {
    const heldBodies = recordedRun.messages.filter((m) => m.kind === "from_supplier" && !m.delivered).map((m) => m.body);
    for (let t = start; t <= end; t += 2_000) {
      const text = JSON.stringify(chatRows(recordedRun, at(t)));
      for (const body of heldBodies) expect(text).not.toContain(body);
    }
  });

  it("shows the crook as removed with both cards, and what was held, in plain words", () => {
    const row = chatRows(recordedRun, at(end)).find((r) => r.id === COASTLINE);
    expect(row).toMatchObject({ status: "out", cards: { yellow: 1, red: 1 }, held: 2, tone: "stop" });
    expect(row?.last).toBe("Held. It named a wallet that is not this supplier's approved one.");
  });

  it("the Lead's row follows the decision, and the inspector's row says when there is none", () => {
    expect(chatRows(recordedRun, atStep("closed")).find((r) => r.id === LEAD_ROW)?.last).toBe("Choosing among the final prices.");
    expect(chatRows(recordedRun, at(end)).find((r) => r.id === LEAD_ROW)?.last).toBe("Chose Shenzhen Brightway Solar Co., Ltd at $114.00 a unit.");
    expect(chatRows(recordedRun, at(end)).find((r) => r.id === INSPECTOR_ROW)?.last).toBe("Not part of this purchase.");
  });

  it("an inspected run shows the inspector waiting, then its answer", () => {
    const r: SourcingRecord = { ...recordedRun, inspection: { state: "refused", inspector: "Port inspector (demo)", note: "Seal broken" } };
    const s = buildTimeline(r);
    const row = (kind: string) => chatRows(r, viewAt(r, s, s.find((x) => x.kind === kind)?.at ?? 0)).find((x) => x.id === INSPECTOR_ROW);
    expect(row("documents")).toMatchObject({ last: "Has not answered yet.", tone: "money" });
    expect(row("inspected")).toMatchObject({ last: "Did not confirm the shipment.", tone: "stop" });
  });
});

describe("a live run in progress", () => {
  it("has not ended its negotiation until the time is up or the Lead has decided", () => {
    const open: SourcingRecord = { ...recordedRun, sourcing: { ...recordedRun.sourcing, state: "OPEN" }, deals: [], job: null, verify: null, create: null, finish: null };
    const closeAt = Date.parse(recordedRun.sourcing.negotiationEndsAt);
    const during = buildTimeline(open, { now: closeAt - 30_000 });
    expect(during.some((s) => s.kind === "closed")).toBe(false);
    expect(viewAt(open, during, Number.POSITIVE_INFINITY).closed).toBe(false);
    expect(buildTimeline(open, { now: closeAt + 1 }).some((s) => s.kind === "closed")).toBe(true);
    // Decided early: closed whatever the clock says.
    expect(buildTimeline(recordedRun, { now: closeAt - 30_000 }).some((s) => s.kind === "closed")).toBe(true);
  });

  it("uses the record's own event times for the lock and the payout when it has them", () => {
    const base = Date.parse(recordedRun.sourcing.negotiationEndsAt) + 60_000;
    const iso = (ms: number) => new Date(base + ms).toISOString();
    const timed: SourcingRecord = {
      ...recordedRun,
      events: [
        { at: iso(0), actor: "deal-agent", from: "CREATE_PENDING", to: "LOCKED", reasonCodes: [] },
        { at: iso(5_000), actor: "seller", from: "IN_PROGRESS", to: "DELIVERED", reasonCodes: [] },
        { at: iso(9_000), actor: "gate", from: "EVALUATING", to: "APPROVED", reasonCodes: [] },
        { at: iso(15_000), actor: "gate", from: "FINISH_PENDING", to: "PAID", reasonCodes: [] },
      ],
    };
    const s = buildTimeline(timed);
    const step = (kind: string) => s.find((x) => x.kind === kind);
    expect(step("locked")).toMatchObject({ at: base, timed: true });
    expect(step("documents")).toMatchObject({ at: base + 5_000, timed: true });
    expect(step("verified")).toMatchObject({ at: base + 9_000, timed: true });
    expect(step("paid")).toMatchObject({ at: base + 15_000, timed: true });
    // The recorded run of 9 Nov has no event log: those steps stay untimed, in order.
    expect(steps.find((x) => x.kind === "locked")?.timed).toBe(false);
  });
});

describe("the simulated feed (testing only)", () => {
  it("is empty before the purchase opens and equals the recorded run at the end", () => {
    expect(recordUpTo(recordedRun, steps, start)).toBeNull();
    const last = recordUpTo(recordedRun, steps, end);
    expect(last?.messages).toEqual(recordedRun.messages);
    expect(last).toMatchObject({ job: { state: "PAID" }, finish: { txHash: recordedRun.finish?.txHash }, checks: recordedRun.checks });
  });

  it("never shows a later fact early: no quote, deal, lock or payout before its step", () => {
    for (let t = start; t <= end; t += 3_000) {
      const r = recordUpTo(recordedRun, steps, t);
      if (!r) continue;
      const v = at(t);
      expect(r.messages).toHaveLength(v.messages.length);
      expect(r.invites.filter((i) => i.quote).length).toBe(v.invites.filter((i) => i.quote).length);
      expect((r.deals ?? []).length).toBe(v.decisions.length);
      expect(Boolean(r.create)).toBe(v.locked);
      expect(Boolean(r.finish)).toBe(v.paid);
      expect(Boolean(r.verify)).toBe(v.verified);
      // The partial record, read the way the live screen reads it, gives the same picture.
      const live = viewAt(r, buildTimeline(r, { now: t }), Number.POSITIVE_INFINITY);
      expect({ locked: live.locked, paid: live.paid, closed: live.closed, messages: live.messages.length, out: live.invites.filter((i) => i.status === "out").length }).toEqual({
        locked: v.locked,
        paid: v.paid,
        closed: v.closed,
        messages: v.messages.length,
        out: v.invites.filter((i) => i.status === "out").length,
      });
    }
  });

  it("is marked simulated and runs on its own clock", async () => {
    let wall = 1_000;
    const sim = createSimSource(recordedRun, { speed: 10, clock: () => wall });
    expect(sim.simulated).toBe(true);
    expect(await sim.latest()).toBeNull();
    wall += 10_000;
    const mid = await sim.latest();
    expect(mid?.sourcing.state).toBe("OPEN");
    expect(sim.now()).toBe(start + 100_000);
    wall += 10 * 60_000;
    expect((await sim.latest())?.job?.state).toBe("PAID");
    expect(sim.now()).toBe(end);
  });
});

describe("the phone pages", () => {
  it("the proxy passes the inspector's routes with the inspector's own token, from anywhere, and never adds the view token", () => {
    const req = (path: string, method = "GET", remoteAddress = "192.168.1.23") => proxyDecision({ method, path, remoteAddress, headers: { host: "192.168.1.23:5173" } });
    expect(req("/api/inspector/deals")).toBe("pass");
    expect(req("/api/inspector/deals/fb7d0b49-1432-40a9-9ee9-dc81d1e7c9a1/attestation", "POST")).toBe("pass");
    expect(req("/api/inspectorx/deals")).toBe("refuse");
  });

  it("starting a purchase needs this machine and this app's own page", () => {
    const own = { host: "localhost:5173", origin: "http://localhost:5173", "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const req = (remoteAddress: string, headers: Record<string, unknown> = own, method = "POST") => proxyDecision({ method, path: "/api/demo/start", remoteAddress, headers });
    expect(req("127.0.0.1")).toBe("inject");
    expect(req("192.168.1.23")).toBe("refuse");
    expect(req("127.0.0.1", { ...own, "x-forwarded-for": "203.0.113.9" })).toBe("refuse");
    expect(req("127.0.0.1", own, "GET")).toBe("refuse");
    // Another site open in the operator's browser posting to localhost: wrong origin, cross-site, or a form post.
    expect(req("127.0.0.1", { ...own, origin: "https://evil.example" })).toBe("refuse");
    expect(req("127.0.0.1", { ...own, "sec-fetch-site": "cross-site" })).toBe("refuse");
    expect(req("127.0.0.1", { ...own, "content-type": "text/plain" })).toBe("refuse");
    expect(req("127.0.0.1", { host: "localhost:5173", "content-type": "application/json" })).toBe("refuse");
    expect(req("127.0.0.1", { ...own, host: "evil.example:5173", origin: "http://evil.example:5173" })).toBe("refuse");
  });

  it("the inspector client sends the token in a header and the form as the API documents it", async () => {
    const calls: { url: string; init?: Parameters<FetchFn>[1] }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => (url.endsWith("/deals") ? [] : { state: "attested", blNumber: "SZXDUR-77290" }) };
    };
    const c = createInspectorClient(fetchFn, "inspector-token");
    await c.queue();
    await c.attest("deal-1", { blNumber: "SZXDUR-77290", outcome: "attested", note: "400 cartons counted" });
    expect(calls[0]).toMatchObject({ url: "/api/inspector/deals", init: { headers: { authorization: "Bearer inspector-token" } } });
    expect(calls[1]?.url).toBe("/api/inspector/deals/deal-1/attestation");
    expect(calls[1]?.url).not.toContain("inspector-token");
    expect(JSON.parse(calls[1]?.init?.body ?? "{}")).toEqual({ blNumber: "SZXDUR-77290", outcome: "attested", note: "400 cartons counted" });
  });

  it("reads the number back before it is sent", () => {
    expect(confirmLine(" SZXDUR-77290 ", "attested")).toBe("You read SZXDUR-77290 and the shipment is in order. Send?");
    expect(confirmLine("SZXDUR-77290", "refused")).toBe("You read SZXDUR-77290 and you are refusing this shipment. Send?");
  });

  it("puts a token after the # of a phone link, never in the query or the path", () => {
    expect(phoneLink("http://192.168.1.23:5173/", "supplier", "")).toBe("http://192.168.1.23:5173/#/supplier");
    const link = phoneLink("http://192.168.1.23:5173/#/control", "inspector", " tok/en ");
    expect(link).toBe("http://192.168.1.23:5173/#/inspector?t=tok%2Fen");
    expect(new URL(link).search).toBe("");
    expect(new URL(link).pathname).toBe("/");
  });

  it("start: a brief is checked before it is sent, and a missing backend route is an ApiError the screen can explain", async () => {
    const ok = { quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000, priority: "balanced" as const, latestDeliveryDays: 30, negotiationSeconds: 180 };
    expect(validateBrief(ok)).toBeNull();
    expect(validateBrief({ ...ok, targetUnitCents: 13_000 })).toContain("cannot be above");
    expect(validateBrief({ ...ok, latestDeliveryDays: 0 })).toContain("1 and 365");
    expect(validateBrief({ ...ok, quantity: 0 })).not.toBeNull();
    const missing: FetchFn = async () => ({ ok: false, status: 404, json: async () => ({ error: "not_found", message: "no such resource" }) });
    await expect(startPurchase(missing, ok)).rejects.toBeInstanceOf(ApiError);
  });
});
