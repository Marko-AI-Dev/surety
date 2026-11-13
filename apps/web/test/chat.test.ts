import { describe, expect, it } from "vitest";
import { type FeedItem, agentStatus, chatFeed, supplierCards } from "../src/data/chat";
import { threadOf } from "../src/data/desk";
import { recordingOf } from "../src/data/evidence";
import { buildTimeline, timelineBounds, viewAt } from "../src/data/timeline";
import type { SourcingRecord } from "../src/data/types";

// The buyer's chat, read exactly as the screen reads it, from the recorded runs.
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
const BRIGHTWAY = (r: SourcingRecord) => r.invites.find((i) => i.name.includes("Brightway"))?.address ?? "";
const texts = (feed: FeedItem[]) => feed.flatMap((i) => ("text" in i ? [i.text] : []));
const iso = (r: SourcingRecord, plusMs: number) => new Date(Date.parse(r.sourcing.negotiationEndsAt) + plusMs).toISOString();

// A live record while the negotiation runs: the paid recording with everything after the chat taken away.
function negotiating(extra: Partial<SourcingRecord> = {}): SourcingRecord {
  const { record } = recordingOf("paid");
  return { ...record, sourcing: { ...record.sourcing, state: "OPEN" }, deals: [], job: null, verify: null, inspection: null, create: null, finish: null, cancel: null, events: [], approval: null, ...extra };
}

describe("the feed: what happened, written by code", () => {
  it("opens with the purchase and who was invited, oldest first, and never names the silent unnamed wallet", () => {
    const { record, view } = play("paid");
    const feed = chatFeed(record, view);
    expect(feed.map((i) => i.at)).toEqual([...feed.map((i) => i.at)].sort((a, b) => a - b));
    expect(feed[0]).toMatchObject({ kind: "update" });
    expect(texts(feed)[0]).toContain("I have opened your purchase: 400 x Monocrystalline solar panel 550 W");
    expect(texts(feed)[0]).toContain("never agree to more than $120.00");
    expect(texts(feed)[1]).toBe("I invited 2 suppliers from your approved list: Shenzhen Brightway Solar Co., Ltd and Sunpeak Energy Ltd.");
    expect(JSON.stringify(feed)).not.toContain("rMAmWT");
  });

  it("says each price once as it moves, with a link to that conversation", () => {
    const { record, view } = play("paid");
    const prices = chatFeed(record, view).filter((i) => i.kind === "update" && i.key.startsWith("price:"));
    expect(prices.length).toBeGreaterThan(1);
    // A supplier is never reported twice in a row at the same price and days.
    const last = new Map<string, string>();
    for (const p of prices) {
      if (p.kind !== "update" || !p.supplier) continue;
      const said = p.text.replace(/ offers | is now at /, " ");
      expect(last.get(p.supplier)).not.toBe(said);
      last.set(p.supplier, said);
    }
    expect(texts(prices)[0]).toMatch(/ offers \$\d+\.\d\d a panel, delivered in \d+ days\.$/);
    expect(texts(prices).some((t) => t.includes(" is now at "))).toBe(true);
    for (const p of prices) expect(p.kind === "update" && p.supplier).toBeTruthy();
  });

  it("a message Surety stopped is said as stopped, with its card, and never with its text", () => {
    const { record, view } = play("refused");
    const feed = chatFeed(record, view);
    const held = feed.filter((i) => i.kind === "update" && i.key.startsWith("held:"));
    expect(held.map((i) => (i.kind === "update" ? i.tone : ""))).toEqual(["held", "stop"]);
    expect(texts(held)[0]).toContain("gave it a yellow card");
    expect(texts(held)[1]).toContain("is out of this purchase");
    expect(JSON.stringify(feed)).not.toContain("pre-verified");
    expect(JSON.stringify(feed)).not.toContain("new wallet r");
  });

  it("nothing in the feed says locked or paid before the buyer's yes", () => {
    const record = negotiating({ approval: { state: "waiting", dealId: "11111111-2222-4333-8444-555555555555", supplier: SUNPEAK(recordingOf("paid").record), leadReason: "A week faster.", at: recordingOf("paid").record.sourcing.negotiationEndsAt, answeredAt: null } });
    const feed = chatFeed(record, viewOf(record));
    expect(feed.at(-1)).toMatchObject({ kind: "review" });
    expect(feed.some((i) => i.kind === "tracker")).toBe(false);
    expect(texts(feed).join(" ")).not.toMatch(/\block(ed)?\b|\bpaid\b/i);
    expect(agentStatus(record, viewOf(record))).toBe("I have a recommendation for you.");
  });

  it("after a yes: the recommendation, the answer and the order, in that order; after a no: nothing moved", () => {
    const { record, view } = play("paid");
    const supplier = SUNPEAK(record);
    const yes = { ...record, approval: { state: "approved" as const, dealId: "d", supplier, leadReason: "A week faster.", at: iso(record, 1_000), answeredAt: iso(record, 9_000) }, chat: [{ role: "buyer" as const, text: "Where is my money now?", at: iso(record, 600_000) }] };
    const feed = chatFeed(yes, view);
    const kinds = feed.map((i) => (i.kind === "update" ? i.key.split(":")[0] : i.kind));
    expect(kinds.slice(kinds.indexOf("recommended"))).toEqual(["recommended", "answer", "tracker", "you"]);
    expect(texts(feed)).toContain("You said yes. Only then could the payment lock.");
    expect(texts(feed).find((t) => t.startsWith("I recommended"))).toBe("I recommended Sunpeak Energy Ltd at $116.00 a panel ($46,400.00 in all): A week faster.");

    const no = negotiating({ approval: { state: "declined", dealId: "d", supplier, leadReason: "A week faster.", at: iso(record, 1_000), answeredAt: iso(record, 9_000) } });
    const declined = chatFeed(no, viewOf(no));
    expect(texts(declined).at(-1)).toBe("You said no. Nothing was locked and nothing was paid.");
    expect(declined.some((i) => i.kind === "tracker")).toBe(false);
  });

  it("carries the buyer's chat with its agent and the messages waiting for the buyer", () => {
    const base = negotiating();
    const record = negotiating({
      chat: [
        { role: "buyer", text: "Ask about the warranty", at: iso(base, -60_000) },
        { role: "agent", text: "I have passed that to the negotiator.", at: iso(base, -59_000) },
      ],
      drafts: [{ id: "d-1", supplier: BRIGHTWAY(base), text: "What warranty do the panels carry?", at: iso(base, 600_000) }],
    });
    const feed = chatFeed(record, viewOf(record));
    expect(feed.filter((i) => i.kind === "you" || i.kind === "agent").map((i) => [i.kind, "text" in i ? i.text : ""])).toEqual([
      ["you", "Ask about the warranty"],
      ["agent", "I have passed that to the negotiator."],
    ]);
    expect(feed.at(-1)).toMatchObject({ kind: "draft", id: "d-1", name: "Shenzhen Brightway Solar Co., Ltd", text: "What warranty do the panels carry?" });
    expect(agentStatus(record, viewOf(record))).toBe("A message is waiting for you.");
    // Without approve-first there are no drafts, and a recording from before the chat has neither.
    expect(chatFeed(base, viewOf(base)).some((i) => i.kind === "draft" || i.kind === "you" || i.kind === "agent")).toBe(false);
  });
});

describe("the supplier conversations the buyer can open", () => {
  it("lists the named suppliers with one line each, and leaves out the silent unnamed wallet", () => {
    const { record, view } = play("paid");
    const cards = supplierCards(record, view, view.t);
    expect(cards.map((c) => c.name)).toEqual(["Shenzhen Brightway Solar Co., Ltd", "Sunpeak Energy Ltd"]);
    expect(cards.every((c) => c.state === "final" && c.line.startsWith("Final price $"))).toBe(true);
    const out = supplierCards(play("refused").record, play("refused").view, play("refused").view.t).find((c) => c.state === "out");
    expect(out).toMatchObject({ line: "Removed by Surety", tone: "stop" });
  });

  it("says when a supplier is writing, when a message waits for the buyer, and when a reply is awaited", () => {
    const base = negotiating();
    const early = (r: SourcingRecord) => {
      const steps = buildTimeline(r);
      const first = steps.find((s) => s.kind === "message")?.at ?? 0;
      return viewAt(r, steps, first);
    };
    const now = Date.parse(base.sourcing.negotiationEndsAt);
    const brightway = BRIGHTWAY(base);
    const first = base.messages.find((m) => m.kind === "to_supplier")?.supplier ?? "";
    const stateOf = (r: SourcingRecord, address: string) => supplierCards(r, early(r), now).find((c) => c.address === address)?.state;
    expect(stateOf(base, first)).toBe("waiting_for_reply");
    expect(stateOf(negotiating({ typing: { [first]: new Date(now - 5_000).toISOString() } }), first)).toBe("typing");
    // The signal is stale after 20 seconds.
    expect(stateOf(negotiating({ typing: { [first]: new Date(now - 25_000).toISOString() } }), first)).toBe("waiting_for_reply");
    const waiting = negotiating({ drafts: [{ id: "d-1", supplier: brightway, text: "x", at: iso(base, 0) }], typing: { [brightway]: new Date(now).toISOString() } });
    expect(supplierCards(waiting, early(waiting), now).find((c) => c.address === brightway)).toMatchObject({ state: "waiting_for_you", line: "A message is waiting for you", tone: "held" });
  });
});

describe("a supplier's thread says who wrote each message on the buyer's side", () => {
  it("marks a message the buyer wrote and one the buyer reworded", () => {
    const base = negotiating();
    const supplier = base.messages.find((m) => m.kind === "to_supplier")?.supplier ?? "";
    let seen = 0;
    const record = negotiating({
      messages: base.messages.map((m) => {
        if (m.kind !== "to_supplier" || m.supplier !== supplier) return m;
        seen++;
        return seen === 1 ? { ...m, by: "buyer" as const } : seen === 2 ? { ...m, by: "negotiator" as const, buyerApproved: true, buyerEdited: true } : m;
      }),
    });
    const mine = threadOf(record, viewOf(record), supplier).filter((m) => m.mine);
    expect(mine[0]).toMatchObject({ from: "You", byBuyer: true, buyerEdited: false });
    expect(mine[1]).toMatchObject({ from: "Your negotiator", byBuyer: false, buyerEdited: true });
    expect(chatFeed(record, viewOf(record)).some((i) => i.kind === "update" && i.text.startsWith("You wrote to "))).toBe(true);
  });
});
