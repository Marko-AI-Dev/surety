import { describe, expect, it } from "vitest";
import { bestOtherOffer, digest, parseActions, run, type Inbox, type View } from "../agents/paperclip/surety";

const A = "rAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "rBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const C = "rCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

const view = (over: Partial<View> = {}): View => ({
  id: "s-1",
  ref: "SRC-1",
  state: "negotiating",
  goods: { description: "400 solar panels", quantity: 400, targetUnitCents: 10000 },
  incoterm: "CIF",
  port: "Durban",
  priority: "balanced",
  latestDeliveryDays: 30,
  negotiationEndsAt: "2026-11-12T10:05:00.000Z",
  secondsLeft: 120,
  invites: [
    { address: A, name: "Alpha Solar", status: "in", committed: false },
    { address: B, name: "Beta Energy", status: "in", committed: false },
    { address: C, name: "Crook Trading", status: "out", committed: false },
  ],
  offers: [],
  ...over,
});

describe("bestOtherOffer: the competing offer to cite, ranked like Surety ranks quotes", () => {
  const offers = [
    { supplier: A, unitCents: 11600, deliveryDays: 14, source: "reported" as const, at: null },
    { supplier: B, unitCents: 11100, deliveryDays: 21, source: "reported" as const, at: null },
    { supplier: C, unitCents: 9000, deliveryDays: 10, source: "reported" as const, at: null },
  ];

  it("never returns the supplier's own offer", () => {
    expect(bestOtherOffer("price", offers, A, null)?.supplier).not.toBe(A);
  });

  it("price picks the cheapest other offer, speed the fastest, balanced the best of both", () => {
    const two = offers.slice(0, 2);
    expect(bestOtherOffer("price", two, "rX", null)).toMatchObject({ unitCents: 11100, deliveryDays: 21 });
    expect(bestOtherOffer("speed", two, "rX", null)).toMatchObject({ unitCents: 11600, deliveryDays: 14 });
    // 11600 x 14 + 14 x 11100 = 317800 against 11100 x 14 + 21 x 11100 = 388500: A wins on balance.
    expect(bestOtherOffer("balanced", two, "rX", null)).toMatchObject({ unitCents: 11600 });
  });

  it("skips an offer slower than the buyer's latest delivery or without delivery days", () => {
    const slow = [
      { supplier: A, unitCents: 9000, deliveryDays: 40, source: "reported" as const, at: null },
      { supplier: B, unitCents: 9500, deliveryDays: null, source: "reported" as const, at: null },
      { supplier: C, unitCents: 11000, deliveryDays: 20, source: "committed" as const, at: null },
    ];
    expect(bestOtherOffer("price", slow, "rX", 30)).toMatchObject({ unitCents: 11000 });
    expect(bestOtherOffer("price", slow.slice(0, 2), "rX", 30)).toBeNull();
  });
});

describe("digest: one compact picture of the negotiation", () => {
  const inbox: Inbox = [
    { supplier: A, kind: "to_supplier", text: "Best price for 400?", at: "t1" },
    { supplier: B, kind: "to_supplier", text: "Best price for 400?", at: "t1" },
    { supplier: A, kind: "from_supplier", text: "$118 in 21 days", at: "t2" },
    { supplier: C, kind: "from_supplier", withheld: true, card: "red", at: "t3" },
  ];
  const offers = [{ supplier: A, unitCents: 11800, deliveryDays: 21, source: "reported" as const, at: "t2" }];

  it("lists only suppliers still in, with who is waiting for a reply and what is new", () => {
    const d = digest(view({ offers }), inbox, 2);
    expect(d.cursor).toBe(4);
    expect(d.suppliers.map((s) => s.address)).toEqual([A, B]);
    const [a, b] = d.suppliers;
    expect(a).toMatchObject({ name: "Alpha Solar", lastReport: { unitCents: 11800, deliveryDays: 21 }, awaitingReply: false, newMessages: 1 });
    expect(a?.thread.at(-1)).toEqual({ from: "supplier", text: "$118 in 21 days" });
    expect(b).toMatchObject({ awaitingReply: true, newMessages: 0, lastReport: null });
  });

  it("gives each supplier the best competing offer from the others, without their names", () => {
    const d = digest(view({ offers }), inbox, 0);
    expect(d.suppliers[1]?.bestCompetingOffer).toEqual({ unitCents: 11800, deliveryDays: 21 });
    expect(d.suppliers[0]?.bestCompetingOffer).toBeNull();
    expect(JSON.stringify(d.suppliers[1]?.bestCompetingOffer)).not.toMatch(/Alpha|rA/);
  });

  it("flags a supplier whose latest offer already meets the buyer's target price and latest delivery (the good-enough rule)", () => {
    const meets = [
      { supplier: A, unitCents: 10000, deliveryDays: 21, source: "reported" as const, at: null },
      { supplier: B, unitCents: 10000, deliveryDays: 40, source: "reported" as const, at: null },
    ];
    const d = digest(view({ offers: meets }), [], 0);
    expect(d.suppliers.map((s) => s.meetsBrief)).toEqual([true, false]);
    expect(digest(view({ offers: [{ ...meets[0]!, unitCents: 10100 }] }), [], 0).suppliers[0]?.meetsBrief).toBe(false);
    expect(digest(view(), [], 0).suppliers[0]?.meetsBrief).toBe(false);
  });

  it("shows a withheld message as withheld, never with text", () => {
    const d = digest(view({ invites: [{ address: C, name: "Crook Trading", status: "in", committed: false }] }), inbox, 0);
    expect(d.suppliers[0]?.thread).toEqual([{ from: "supplier", withheld: true }]);
  });

  it("says what phase the negotiation is in", () => {
    expect(digest(view({ secondsLeft: 120 }), [], 0).phase).toBe("negotiate");
    expect(digest(view({ secondsLeft: 25 }), [], 0).phase).toBe("final_call");
    expect(digest(view({ secondsLeft: 0 }), [], 0).phase).toBe("closed");
    expect(digest(view({ state: "selected" as View["state"], secondsLeft: 50 }), [], 0).phase).toBe("closed");
  });

  it("carries how hard the buyer wants the push and the buyer's notes (13 Nov)", () => {
    const d = digest(view({ push: "gentle", buyerNotes: [{ text: "Sunpeak is a friend, go easy", at: "t9" }] }), [], 0);
    expect(d).toMatchObject({ push: "gentle", buyerNotes: [{ text: "Sunpeak is a friend, go easy", at: "t9" }] });
    // An API from before 13 Nov sends neither: firm, and no notes.
    expect(digest(view(), [], 0)).toMatchObject({ push: "firm", buyerNotes: [] });
  });

  it("carries the brief's facts the negotiator needs, and never a maximum", () => {
    const d = digest(view(), [], 0);
    expect(d).toMatchObject({ ref: "SRC-1", quantity: 400, targetUnitCents: 10000, priority: "balanced", latestDeliveryDays: 30, incoterm: "CIF", port: "Durban" });
    expect(JSON.stringify(d)).not.toMatch(/max/i);
  });
});

describe("parseActions: one batch of messages and reports", () => {
  it("accepts messages and reports", () => {
    const a = parseActions(JSON.stringify({ messages: [{ supplier: A, text: "Can you beat $111?" }], reports: [{ supplier: A, unitCents: 11800, quantity: 400, deliveryDays: 21, summary: "Quoted $118 in 21 days" }] }));
    expect(a.messages).toHaveLength(1);
    expect(a.reports).toHaveLength(1);
  });

  it("rejects bad JSON, a message over 400 characters and a price that is not whole cents", () => {
    expect(() => parseActions("{nope")).toThrow(/JSON/);
    expect(() => parseActions(JSON.stringify({ messages: [{ supplier: A, text: "x".repeat(401) }] }))).toThrow(/400/);
    expect(() => parseActions(JSON.stringify({ reports: [{ supplier: A, unitCents: 118.5, quantity: 400, deliveryDays: 21, summary: "s" }] }))).toThrow(/cents/);
    expect(() => parseActions(JSON.stringify({}))).toThrow(/nothing/);
  });
});

describe("run: the command line, against a fake Surety API", () => {
  function fakeApi(views: View[], inboxes: Inbox[]) {
    const calls: { method: string; path: string; body?: unknown; auth?: string }[] = [];
    let i = 0;
    const fetch = async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      const path = url.replace("http://api", "");
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(init.body) : undefined, auth: init?.headers?.authorization });
      const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
      if (method === "GET" && path === "/sourcing/s-1") return ok(views[Math.min(i, views.length - 1)]);
      if (method === "GET" && path === "/sourcing/s-1/inbox") return ok(inboxes[Math.min(i++, inboxes.length - 1)]);
      if (method === "POST" && path === "/sourcing/s-1/messages") {
        const text = (JSON.parse(init!.body!) as { text: string }).text;
        return /Alpha/.test(text) ? ok({ error: "refused", message: "names another invited supplier" }, 400) : ok({ id: "m" });
      }
      if (method === "POST" && path === "/sourcing/s-1/reports") return ok({ id: "r" });
      return ok({ error: "not_found" }, 404);
    };
    return { calls, fetch };
  }
  const env = { SURETY_API_URL: "http://api", SURETY_API_TOKEN: "tok" };
  const io = (fetch: unknown, stdin = "") => ({ fetch: fetch as typeof globalThis.fetch, env, stdin: async () => stdin, sleep: async () => {} });

  it("look prints the digest and sends the token, never prints it", async () => {
    const api = fakeApi([view()], [[]]);
    const out = await run(["look", "s-1"], io(api.fetch));
    expect(JSON.parse(out)).toMatchObject({ ref: "SRC-1", cursor: 0, phase: "negotiate" });
    expect(api.calls.every((c) => c.auth === "Bearer tok")).toBe(true);
    expect(out).not.toMatch(/tok\b/);
  });

  it("wait returns as soon as a supplier writes after the cursor", async () => {
    const reply: Inbox = [{ supplier: A, kind: "from_supplier", text: "$118", at: "t" }];
    const api = fakeApi([view()], [[], [], reply]);
    const out = JSON.parse(await run(["wait", "s-1", "--since", "0"], io(api.fetch)));
    expect(out).toMatchObject({ cursor: 1, woke: "supplier_replied" });
  });

  it("wait ignores the negotiator's own messages", async () => {
    const own: Inbox = [{ supplier: A, kind: "to_supplier", text: "hi", at: "t" }];
    const api = fakeApi([view()], [own, own, own]);
    const out = JSON.parse(await run(["wait", "s-1", "--since", "0", "--max", "4"], io(api.fetch)));
    expect(out.woke).toBe("timeout");
  });

  it("wait wakes when the buyer sends a note during the wait", async () => {
    const note = { text: "Push harder on delivery", at: "t" };
    const api = fakeApi([view({ buyerNotes: [] }), view({ buyerNotes: [note] })], [[], []]);
    const out = JSON.parse(await run(["wait", "s-1", "--since", "0"], io(api.fetch)));
    expect(out).toMatchObject({ woke: "buyer_note", buyerNotes: [note] });
  });

  it("wait wakes for the final call and for the close", async () => {
    let api = fakeApi([view({ secondsLeft: 40 }), view({ secondsLeft: 28 })], [[], []]);
    expect(JSON.parse(await run(["wait", "s-1", "--since", "0"], io(api.fetch))).woke).toBe("final_call");
    api = fakeApi([view({ secondsLeft: 0 })], [[]]);
    expect(JSON.parse(await run(["wait", "s-1", "--since", "0"], io(api.fetch))).woke).toBe("closed");
  });

  it("act sends every message and report in one call and reports each result", async () => {
    const api = fakeApi([view()], [[]]);
    const batch = { messages: [{ supplier: A, text: "Can you beat $111 in 21 days?" }, { supplier: B, text: "Alpha offered less" }], reports: [{ supplier: A, unitCents: 11800, quantity: 400, deliveryDays: 21, summary: "$118, 21 days" }] };
    const out = JSON.parse(await run(["act", "s-1"], io(api.fetch, JSON.stringify(batch))));
    expect(out.results).toEqual([
      { kind: "message", supplier: A, ok: true },
      { kind: "message", supplier: B, ok: false, error: "refused: names another invited supplier" },
      { kind: "report", supplier: A, ok: true },
    ]);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(3);
    expect(out.after).toMatchObject({ ref: "SRC-1" });
  });

  it("refuses to run without the API address or token, and explains usage", async () => {
    await expect(run(["look", "s-1"], { ...io(fakeApi([], []).fetch), env: {} })).rejects.toThrow(/SURETY_API_URL/);
    await expect(run([], io(fakeApi([], []).fetch))).rejects.toThrow(/usage/i);
  });
});
