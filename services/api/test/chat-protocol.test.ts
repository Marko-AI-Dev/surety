import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionEngine, EvaluationResult } from "@surety/gate";
import { type SourcingDeps, createMemoryRepo } from "@surety/workflow";
import { BUYER_CHAT_LIMIT } from "../src/chat";
import { TYPING_MS, createApiServer } from "../src/http";
import { FakeSigner } from "../../../packages/workflow/test/fake-signer";
import { SUPPLIER, SUPPLIER_NAME } from "../../../scripts/deal-fixtures";

// The buyer's control of a negotiation: messages that wait for the buyer, messages the buyer writes,
// the negotiator's settings, asking for what the agents have, when the lead should decide, the chat
// with the buyer's own agent, and the supplier's "I am writing" signal. None of it may lock a payment.

const SECOND = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const t = (c: string) => c.repeat(40);
const TOKENS = { lead: t("L"), sourcing: t("S"), negotiator: t("N"), view: t("V"), inspector: t("I") };
const SUPPLIER_TOKENS: Record<string, string> = { [SUPPLIER]: t("A"), [SECOND]: t("B") };
const NAMES: Record<string, string> = { [SUPPLIER]: SUPPLIER_NAME, [SECOND]: "Sunpeak Energy" };

const engine: DecisionEngine = {
  mode: "fixture",
  async evaluate(input): Promise<EvaluationResult> {
    return { status: "ok", mode: "fixture", satisfaction: 0.95, injectionRisk: 0.03, provider: "fixture", model: "fixture", latencyMs: 1, reasonCodes: [], requestId: input.requestId, evaluatedAt: new Date().toISOString(), costUsd: null };
  },
};

let server: Server;
let base: string;
let signer: FakeSigner;
let deps: SourcingDeps;
let asked: { system: string; user: string }[];
let answer: string | Error;
// The API's clock (the typing signal) and the workflow's clock (the decide-by time), moved by hand.
let skewMs: number;

beforeEach(async () => {
  signer = new FakeSigner(800_000_000, { secret: "gate-secret-for-api-tests-0123456789abcd", now: () => new Date() });
  signer.testUsd = {
    issuer: signer.issuer,
    currencyHex: "5445535455534400000000000000000000000000",
    approvedSuppliers: [SUPPLIER, SECOND],
    policyVersion: 5,
    limits: { perDealCents: "10000000", dailyCents: "50000000", openDeals: 10 },
  };
  skewMs = 0;
  deps = {
    repo: createMemoryRepo(),
    signer,
    supplierLine: async () => ({ balanceCents: 0n, limitCents: 100_000_000_000n, frozenByIssuer: false }),
    engine,
    directory: (a) => NAMES[a] ?? null,
    now: () => new Date(Date.now() + skewMs),
  };
  asked = [];
  answer = "{}";
  server = createApiServer(
    deps,
    {
      tokens: TOKENS,
      supplierTokens: SUPPLIER_TOKENS,
      chat: async (system: string, user: string) => {
        asked.push({ system, user });
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
    { now: () => Date.now() + skewMs },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const brief = (extra: Record<string, unknown> = {}) => ({
  buyer: { name: "Karoo Solar Imports (Pty) Ltd", address: signer.buyer },
  goods: { description: "Monocrystalline solar panel 550 W", quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000 },
  incoterm: "CIF",
  port: "Durban",
  deadlineSeconds: 300,
  negotiationSeconds: 600,
  latestDeliveryDays: 21,
  ...extra,
});
const quote = (unitCents: number, deliveryDays: number, quoteNumber: string) => ({ quoteNumber, quantity: 400, unitCents, incoterm: "CIF", port: "Durban", deliveryDays, notes: "" });

// An open sourcing with both suppliers invited.
async function opened(extra: Record<string, unknown> = {}) {
  const id = (await call("POST", "/sourcing", TOKENS.lead, brief(extra))).json.id as string;
  for (const address of [SUPPLIER, SECOND]) await call("POST", `/sourcing/${id}/invites`, TOKENS.sourcing, { address });
  return id;
}
const say = (id: string, supplier: string, text: string) => call("POST", `/sourcing/${id}/messages`, TOKENS.negotiator, { supplier, text });
const thread = async (id: string, supplier: string) => ((await call("GET", `/supplier/sourcing/${id}/thread`, SUPPLIER_TOKENS[supplier])).json as { kind: string; text: string }[]).map((m) => m.text);
const record = async (id: string) => (await call("GET", `/sourcing/${id}/record`, TOKENS.view)).json;
const view = async (id: string, token: string) => (await call("GET", `/sourcing/${id}`, token)).json;
const locks = () => signer.count("create");
const OPENING = "Good day. We need 400 panels CIF Durban. What is your best price?";

describe("approve-first: a negotiator's message waits for the buyer", () => {
  it("is held as a draft that no supplier and no agent reads, and the negotiator learns only that it waits", async () => {
    const id = await opened({ autonomy: "approve" });
    const r = await say(id, SUPPLIER, OPENING);
    expect(r).toMatchObject({ status: 200, json: { held: "buyer_review", supplier: SUPPLIER } });
    expect(await thread(id, SUPPLIER)).toEqual([]);
    expect((await call("GET", `/sourcing/${id}/inbox`, TOKENS.negotiator)).json).toEqual([]);
    const rec = await record(id);
    expect(rec.messages).toEqual([]);
    expect(rec.drafts).toMatchObject([{ id: r.json.draftId, supplier: SUPPLIER, text: OPENING }]);
    const nv = await view(id, TOKENS.negotiator);
    expect(nv).toMatchObject({ autonomy: "approve", pendingDrafts: [{ supplier: SUPPLIER }] });
    expect(JSON.stringify(nv.pendingDrafts)).not.toContain("best price");
    // One draft a supplier at a time: writing again returns the one that waits.
    expect((await say(id, SUPPLIER, "Another wording")).json.draftId).toBe(r.json.draftId);
    expect((await record(id)).drafts).toHaveLength(1);
  });

  it("sent as written: the supplier gets it, the record says the buyer approved it, and it cannot be sent twice", async () => {
    const id = await opened({ autonomy: "approve" });
    const { draftId } = (await say(id, SUPPLIER, OPENING)).json;
    expect(await call("POST", `/drafts/${draftId}`, TOKENS.view, { action: "send" })).toMatchObject({ status: 200, json: { state: "sent", supplier: SUPPLIER } });
    expect(await thread(id, SUPPLIER)).toEqual([OPENING]);
    const rec = await record(id);
    expect(rec.drafts).toEqual([]);
    expect(rec.messages).toMatchObject([{ kind: "to_supplier", body: OPENING, by: "negotiator", buyerApproved: true, buyerEdited: false }]);
    expect((await call("POST", `/drafts/${draftId}`, TOKENS.view, { action: "send" })).status).toBe(409);
    expect((await call("POST", `/drafts/${draftId}`, TOKENS.view, { action: "discard" })).status).toBe(409);
    expect(await thread(id, SUPPLIER)).toHaveLength(1);
  });

  it("reworded by the buyer: only the buyer's wording goes out", async () => {
    const id = await opened({ autonomy: "approve" });
    const { draftId } = (await say(id, SUPPLIER, OPENING)).json;
    const mine = "Hello. 400 panels to Durban. Please also tell me about the warranty.";
    expect((await call("POST", `/drafts/${draftId}`, TOKENS.view, { action: "send", text: mine })).status).toBe(200);
    expect(await thread(id, SUPPLIER)).toEqual([mine]);
    expect((await record(id)).messages).toMatchObject([{ body: mine, by: "negotiator", buyerApproved: true, buyerEdited: true }]);
  });

  it("discarded: nothing goes out, and the negotiator may draft again", async () => {
    const id = await opened({ autonomy: "approve" });
    const { draftId } = (await say(id, SUPPLIER, OPENING)).json;
    expect(await call("POST", `/drafts/${draftId}`, TOKENS.view, { action: "discard" })).toMatchObject({ status: 200, json: { state: "discarded" } });
    expect(await thread(id, SUPPLIER)).toEqual([]);
    expect((await view(id, TOKENS.negotiator)).pendingDrafts).toEqual([]);
    const again = (await say(id, SUPPLIER, "A second try")).json;
    expect(again.held).toBe("buyer_review");
    expect(again.draftId).not.toBe(draftId);
  });

  it("a reworded draft still may not name another supplier, and stays waiting when refused", async () => {
    const id = await opened({ autonomy: "approve" });
    const { draftId } = (await say(id, SUPPLIER, OPENING)).json;
    expect((await call("POST", `/drafts/${draftId}`, TOKENS.view, { action: "send", text: "Sunpeak Energy offered us less." })).status).toBe(400);
    expect(await thread(id, SUPPLIER)).toEqual([]);
    expect((await record(id)).drafts).toHaveLength(1);
  });

  it("only the buyer's screen may answer a draft; an unknown draft is 404; a bad answer is 400", async () => {
    const id = await opened({ autonomy: "approve" });
    const { draftId } = (await say(id, SUPPLIER, OPENING)).json;
    for (const token of [TOKENS.lead, TOKENS.negotiator, TOKENS.sourcing, SUPPLIER_TOKENS[SUPPLIER]]) expect((await call("POST", `/drafts/${draftId}`, token, { action: "send" })).status).toBe(403);
    expect((await call("POST", "/drafts/00000000-0000-4000-8000-000000000000", TOKENS.view, { action: "send" })).status).toBe(404);
    expect((await call("POST", `/drafts/${draftId}`, TOKENS.view, { action: "approve" })).status).toBe(400);
    expect((await call("POST", `/drafts/${draftId}`, TOKENS.view, { action: "send", text: "" })).status).toBe(400);
  });

  it("full autonomy, the default: the message goes out as the negotiator writes it", async () => {
    const id = await opened();
    const r = await say(id, SUPPLIER, OPENING);
    expect(r.json.held).toBeUndefined();
    expect(await thread(id, SUPPLIER)).toEqual([OPENING]);
    expect((await record(id)).messages).toMatchObject([{ by: "negotiator", buyerApproved: false, buyerEdited: false }]);
    expect((await view(id, TOKENS.negotiator)).autonomy).toBe("full");
  });
});

describe("the buyer writes to a supplier and changes the negotiator's settings", () => {
  it("the buyer's own message goes out at once in either mode, and the negotiator sees that the buyer wrote it", async () => {
    const id = await opened({ autonomy: "approve" });
    const text = "Hi, this is the buyer. Can you include mounting rails?";
    expect((await call("POST", `/sourcing/${id}/buyer-messages`, TOKENS.view, { supplier: SUPPLIER, text })).status).toBe(200);
    expect(await thread(id, SUPPLIER)).toEqual([text]);
    expect((await call("GET", `/sourcing/${id}/inbox`, TOKENS.negotiator)).json).toMatchObject([{ supplier: SUPPLIER, kind: "to_supplier", text, byBuyer: true }]);
    expect((await record(id)).messages).toMatchObject([{ body: text, by: "buyer" }]);
    expect((await call("POST", `/sourcing/${id}/buyer-messages`, TOKENS.view, { supplier: SECOND, text: `${SUPPLIER_NAME} is cheaper than you.` })).status).toBe(400);
    expect((await call("POST", `/sourcing/${id}/buyer-messages`, TOKENS.negotiator, { supplier: SUPPLIER, text })).status).toBe(403);
    expect((await call("POST", `/sourcing/${id}/buyer-messages`, TOKENS.view, { supplier: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", text })).status).toBe(404);
  });

  it("the buyer switches to approve-first and back while the negotiation runs", async () => {
    const id = await opened();
    expect((await say(id, SUPPLIER, OPENING)).json.held).toBeUndefined();
    expect((await call("POST", `/sourcing/${id}/controls`, TOKENS.view, { autonomy: "approve", push: "gentle" })).json).toMatchObject({ autonomy: "approve", push: "gentle" });
    expect(await view(id, TOKENS.negotiator)).toMatchObject({ autonomy: "approve", push: "gentle" });
    expect((await say(id, SUPPLIER, "Can you do better?")).json.held).toBe("buyer_review");
    expect((await call("POST", `/sourcing/${id}/controls`, TOKENS.view, { autonomy: "full" })).json).toMatchObject({ autonomy: "full", push: "gentle" });
    expect((await say(id, SECOND, OPENING)).json.held).toBeUndefined();
    expect((await call("POST", `/sourcing/${id}/controls`, TOKENS.view, {})).status).toBe(400);
    expect((await call("POST", `/sourcing/${id}/controls`, TOKENS.view, { autonomy: "none" })).status).toBe(400);
    expect((await call("POST", `/sourcing/${id}/controls`, TOKENS.lead, { autonomy: "approve" })).status).toBe(403);
  });
});

describe("when the lead should bring a deal to the buyer", () => {
  it("not while nothing is committed; at once when a committed quote meets the brief", async () => {
    const id = await opened();
    expect((await view(id, TOKENS.lead)).decideNow).toEqual({ ready: false, why: null });
    // Above the target: committed, but the brief is not met.
    await call("POST", `/supplier/sourcing/${id}/quote`, SUPPLIER_TOKENS[SUPPLIER], quote(11_400, 21, "Q-1"));
    expect((await view(id, TOKENS.lead)).decideNow).toEqual({ ready: false, why: null });
    // At the target and inside the delivery time.
    await call("POST", `/supplier/sourcing/${id}/quote`, SUPPLIER_TOKENS[SECOND], quote(11_000, 14, "Q-2"));
    expect((await view(id, TOKENS.lead)).decideNow).toEqual({ ready: true, why: "criteria_met" });
    expect((await record(id)).decideNow).toEqual({ ready: true, why: "criteria_met" });
  });

  it("a price at the target that arrives too late does not meet the brief", async () => {
    const id = await opened();
    await call("POST", `/supplier/sourcing/${id}/quote`, SUPPLIER_TOKENS[SUPPLIER], quote(10_900, 35, "Q-1"));
    expect((await view(id, TOKENS.lead)).decideNow).toEqual({ ready: false, why: null });
  });

  it("the buyer asks for what the agents have: the negotiator is told, and the lead is ready once a quote is committed", async () => {
    const id = await opened();
    expect((await view(id, TOKENS.negotiator)).wrapUp).toBe(false);
    expect((await call("POST", `/sourcing/${id}/wrap-up`, TOKENS.view, {})).json.wrapUpAt).toEqual(expect.any(String));
    expect((await view(id, TOKENS.negotiator)).wrapUp).toBe(true);
    expect((await view(id, TOKENS.lead)).decideNow).toEqual({ ready: false, why: null });
    await call("POST", `/supplier/sourcing/${id}/quote`, SUPPLIER_TOKENS[SUPPLIER], quote(11_400, 21, "Q-1"));
    expect((await view(id, TOKENS.lead)).decideNow).toEqual({ ready: true, why: "buyer_asked" });
    // Asking again keeps the first time, and asking selects and locks nothing.
    const first = (await record(id)).controls.wrapUpAt;
    await call("POST", `/sourcing/${id}/wrap-up`, TOKENS.view, {});
    expect((await record(id)).controls.wrapUpAt).toBe(first);
    expect((await deps.repo.getSourcing(id))?.state).toBe("OPEN");
    expect(locks()).toBe(0);
    expect((await call("POST", `/sourcing/${id}/wrap-up`, TOKENS.negotiator, {})).status).toBe(403);
  });

  it("the buyer's decide-by time is the backstop", async () => {
    const id = await opened();
    skewMs = 601_000;
    expect((await view(id, TOKENS.lead)).decideNow).toEqual({ ready: true, why: "time_over" });
  });

  it("a negotiation may run for up to thirty days, and no longer", async () => {
    expect((await call("POST", "/sourcing", TOKENS.lead, brief({ negotiationSeconds: 30 * 86_400 }))).status).toBe(200);
    expect((await call("POST", "/sourcing", TOKENS.lead, brief({ negotiationSeconds: 30 * 86_400 + 1 }))).status).toBe(400);
  });
});

describe("the buyer's chat with its own agent", () => {
  const chat = (id: string, text: string) => call("POST", `/sourcing/${id}/chat`, TOKENS.view, { text });

  it("a question is answered from the record, and both lines are kept", async () => {
    const id = await opened();
    await call("POST", `/supplier/sourcing/${id}/quote`, SUPPLIER_TOKENS[SUPPLIER], quote(11_400, 21, "Q-1"));
    answer = '{"reply":"Brightway has committed $114.00 a panel in 21 days.","action":"none"}';
    expect((await chat(id, "Where are we?")).json).toEqual({ reply: "Brightway has committed $114.00 a panel in 21 days.", action: "none", done: false });
    expect(asked[0]?.user).toContain("WHERE THE PURCHASE STANDS:");
    expect(asked[0]?.user).toContain("BUYER: Where are we?");
    expect(asked[0]?.system).toContain("You cannot approve a deal, decline a deal or pay");
    expect((await record(id)).chat).toMatchObject([
      { role: "buyer", text: "Where are we?" },
      { role: "agent", text: "Brightway has committed $114.00 a panel in 21 days." },
    ]);
  });

  it("'bring me what you have' is done by code, and the confirmation is code's sentence, not the model's", async () => {
    const id = await opened();
    answer = '{"reply":"Sure, I already locked the payment for you!","action":"wrap_up"}';
    const r = (await chat(id, "Bring me what you have")).json;
    expect(r).toMatchObject({ action: "wrap_up", done: true });
    expect(r.reply).toContain("I have asked the negotiator to get final quotes now.");
    expect(r.reply).not.toContain("locked the payment");
    expect((await view(id, TOKENS.negotiator)).wrapUp).toBe(true);
    expect(locks()).toBe(0);
  });

  it("an instruction for the negotiator is passed on in the buyer's own words", async () => {
    const id = await opened();
    answer = '{"reply":"","action":"note"}';
    expect((await chat(id, "Ask about the warranty")).json).toMatchObject({ action: "note", done: true, reply: "I have passed that to the negotiator." });
    expect((await view(id, TOKENS.negotiator)).buyerNotes).toMatchObject([{ text: "Ask about the warranty" }]);
  });

  it("the buyer can switch the negotiator to approve-first, and back, by saying so", async () => {
    const id = await opened();
    answer = '{"action":"approve_first"}';
    expect((await chat(id, "I want to read every message first")).json).toMatchObject({ action: "approve_first", done: true });
    expect((await say(id, SUPPLIER, OPENING)).json.held).toBe("buyer_review");
    answer = '{"action":"full_autonomy"}';
    expect((await chat(id, "Go ahead on your own")).json).toMatchObject({ action: "full_autonomy", done: true });
    expect((await view(id, TOKENS.negotiator)).autonomy).toBe("full");
  });

  it("the chat can never approve a deal or lock a payment, whatever the model returns", async () => {
    const id = await opened();
    await call("POST", `/supplier/sourcing/${id}/quote`, SUPPLIER_TOKENS[SUPPLIER], quote(11_400, 21, "Q-1"));
    const dealId = (await call("POST", `/sourcing/${id}/select`, TOKENS.lead, { supplier: SUPPLIER })).json.id as string;
    await call("POST", `/deals/${dealId}/decision`, TOKENS.lead, { outcome: "accept", reason: "First in the ranking." });
    for (const out of ['{"reply":"Approved.","action":"approve"}', '{"reply":"Paid.","action":"none"}', '{"action":"wrap_up"}', "not json at all"]) {
      answer = out;
      expect((await chat(id, "Yes, approve it and pay")).status).toBe(200);
    }
    expect(locks()).toBe(0);
    expect((await record(id)).approval).toMatchObject({ state: "waiting" });
    // An action the model made up is not carried out, and one that is no longer possible says so.
    const lines = (await record(id)).chat.filter((l: { role: string }) => l.role === "agent").map((l: { text: string }) => l.text);
    expect(lines[0]).toBe("I could not answer just now. Please try again.");
    expect(lines[2]).toBe("I could not do that: this negotiation is no longer open.");
    expect(lines[3]).toBe("I could not answer just now. Please try again.");
  });

  it("a model that fails gives a plain apology, never an error or a made-up answer", async () => {
    const id = await opened();
    answer = new Error("upstream 500");
    expect((await chat(id, "Where are we?")).json).toEqual({ reply: "I could not answer just now. Please try again.", action: "none", done: false });
  });

  it("is refused for other roles, for an unknown purchase, for empty or over-long text, and after the limit", async () => {
    const id = await opened();
    expect((await call("POST", `/sourcing/${id}/chat`, TOKENS.lead, { text: "hi" })).status).toBe(403);
    expect((await chat("00000000-0000-4000-8000-000000000000", "hi")).status).toBe(404);
    expect((await chat(id, "  ")).status).toBe(400);
    expect((await chat(id, "x".repeat(501))).status).toBe(400);
    for (let i = 0; i < BUYER_CHAT_LIMIT; i++) await deps.repo.addChatLine(id, "buyer", `line ${i}`);
    expect((await chat(id, "one more")).status).toBe(400);
  });
});

describe("a supplier says it is writing", () => {
  it("shows in the record for a short while, only for a supplier in that sourcing", async () => {
    const id = await opened();
    expect((await record(id)).typing).toEqual({});
    expect((await call("POST", `/supplier/sourcing/${id}/typing`, SUPPLIER_TOKENS[SUPPLIER], {})).status).toBe(200);
    expect(Object.keys((await record(id)).typing)).toEqual([SUPPLIER]);
    skewMs = TYPING_MS + 1_000;
    expect((await record(id)).typing).toEqual({});
    expect((await call("POST", `/supplier/sourcing/${id}/typing`, TOKENS.view, {})).status).toBe(403);
    const other = (await call("POST", "/sourcing", TOKENS.lead, brief())).json.id as string;
    expect((await call("POST", `/supplier/sourcing/${other}/typing`, SUPPLIER_TOKENS[SUPPLIER], {})).status).toBe(404);
  });
});

describe("the list of purchases says where each one stands", () => {
  const newest = async () => (await call("GET", "/sourcing", TOKENS.view)).json[0];
  const recommended = async (id: string) => {
    await call("POST", `/supplier/sourcing/${id}/quote`, SUPPLIER_TOKENS[SUPPLIER], quote(11_400, 21, "Q-1"));
    const dealId = (await call("POST", `/sourcing/${id}/select`, TOKENS.lead, { supplier: SUPPLIER })).json.id as string;
    await call("POST", `/deals/${dealId}/decision`, TOKENS.lead, { outcome: "accept", reason: "First in the ranking." });
    return dealId;
  };

  it("negotiating, then waiting for the buyer, then locked, with the supplier and the amount once they are known", async () => {
    const id = await opened();
    expect(await newest()).toMatchObject({ id, stage: "negotiating", supplier: null, totalCents: null });
    const dealId = await recommended(id);
    expect(await newest()).toMatchObject({ stage: "waiting", supplier: SUPPLIER_NAME, totalCents: null });
    await call("POST", `/deals/${dealId}/approval`, TOKENS.view, { outcome: "approve" });
    expect(await newest()).toMatchObject({ stage: "locked", supplier: SUPPLIER_NAME, totalCents: 4_560_000 });
    // The escrow ledger reads its rows from here: a transaction is listed only once the ledger validated it.
    const ledger = (await newest()).ledger;
    expect(ledger).toMatchObject({ finish: null, cancel: null });
    if (ledger.create) expect(ledger.create).toMatchObject({ validated: true, txHash: expect.any(String), explorer: expect.stringContaining(ledger.create.txHash) });
  });

  it("a purchase the buyer turned down says so, and shows no amount", async () => {
    const id = await opened();
    const dealId = await recommended(id);
    await call("POST", `/deals/${dealId}/approval`, TOKENS.view, { outcome: "decline" });
    expect(await newest()).toMatchObject({ id, stage: "declined", supplier: SUPPLIER_NAME, totalCents: null });
    expect(locks()).toBe(0);
  });

  it("never carries the maximum price", async () => {
    await opened();
    expect(JSON.stringify((await call("GET", "/sourcing", TOKENS.lead)).json)).not.toMatch(/maxUnitCents|12000/);
  });
});
