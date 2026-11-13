import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SourcingBriefSchema } from "@surety/contracts";
import type { DecisionEngine } from "@surety/gate";
import { type SourcingDeps, createMemoryRepo } from "@surety/workflow";
import { loadApiConfig } from "../src/config";
import { type LeadTask, createPaperclipStarter, demoBrief, leadTask } from "../src/demo-start";
import { START_WINDOW_MS, createApiServer } from "../src/http";
import { FakeSigner } from "../../../packages/workflow/test/fake-signer";

const t = (c: string) => c.repeat(40);
const TOKENS = { lead: t("L"), sourcing: t("S"), negotiator: t("N"), view: t("V"), inspector: t("I") };
const SUPPLIER = "rMzXuRSTGEhVpvhXa9CyFVU86o4Q3nzJ4U";
const START = { quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000, priority: "balanced", latestDeliveryDays: 30, negotiationSeconds: 180 };

// The start route never screens anything, so the decision model must never be asked.
const engine: DecisionEngine = {
  mode: "fixture",
  evaluate: async () => {
    throw new Error("the start route asked the decision model");
  },
};

let server: Server;
let base: string;
let signer: FakeSigner;
let deps: SourcingDeps;
let tasks: LeadTask[];
let now: number;
let failNext: boolean;

async function listen(withStart: boolean) {
  server = createApiServer(
    deps,
    {
      tokens: TOKENS,
      supplierTokens: { [SUPPLIER]: t("A") },
      ...(withStart
        ? {
            start: async (task: LeadTask) => {
              if (failNext) {
                failNext = false;
                throw new Error("wsl is not running");
              }
              tasks.push(task);
            },
          }
        : {}),
    },
    { now: () => now },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  signer = new FakeSigner(800_000_000, { secret: "gate-secret-for-api-tests-0123456789abcd", now: () => new Date() });
  deps = { repo: createMemoryRepo(), signer, supplierLine: async () => null, engine, directory: () => null };
  tasks = [];
  now = Date.parse("2026-11-12T08:00:00.000Z");
  failNext = false;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function post(path: string, token: string, body: unknown) {
  const res = await fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("POST /demo/start", () => {
  it("is 404 when the API has no start command configured", async () => {
    await listen(false);
    expect(await post("/demo/start", TOKENS.view, START)).toMatchObject({ status: 404, json: { error: "not_found" } });
  });

  it("hands the Lead one task carrying the brief, and opens no sourcing itself", async () => {
    await listen(true);
    expect(await post("/demo/start", TOKENS.view, START)).toEqual({ status: 200, json: { started: true } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Purchase: 400 x Monocrystalline solar panel 550 W");
    // The last line of the task is the exact body the Lead posts, and Surety would accept it.
    const body = SourcingBriefSchema.parse(JSON.parse(tasks[0]?.description.split("\n").at(-1) ?? ""));
    expect(body).toMatchObject({
      buyer: { address: signer.buyer },
      goods: { quantity: 400, targetUnitCents: 11_000, maxUnitCents: 12_000 },
      incoterm: "CIF",
      port: "Durban",
      deadlineSeconds: 420,
      negotiationSeconds: 180,
      priority: "balanced",
      latestDeliveryDays: 30,
    });
    expect(await deps.repo.listSourcings(20)).toEqual([]);
  });

  it("is for the view token only", async () => {
    await listen(true);
    for (const token of [TOKENS.lead, TOKENS.sourcing, TOKENS.negotiator, TOKENS.inspector, t("A")]) {
      expect((await post("/demo/start", token, START)).status).toBe(403);
    }
    expect((await post("/demo/start", t("x"), START)).status).toBe(401);
    expect(tasks).toEqual([]);
  });

  it("refuses a brief Surety would refuse, an extra field or a missing one, and hands over nothing", async () => {
    await listen(true);
    const bad = [
      { ...START, targetUnitCents: 12_500 },
      { ...START, quantity: 0 },
      { ...START, quantity: 1.5 },
      { ...START, priority: "cheapest" },
      { ...START, negotiationSeconds: 10 },
      { ...START, latestDeliveryDays: 400 },
      { ...START, buyer: { name: "Someone else", address: SUPPLIER } },
      { ...START, deadlineSeconds: 60 },
      { quantity: 400 },
      "start",
    ];
    for (const body of bad) expect(await post("/demo/start", TOKENS.view, body)).toMatchObject({ status: 400, json: { error: "bad_request" } });
    expect(tasks).toEqual([]);
  });

  it("a second start inside the window is 409; after the window it goes through", async () => {
    await listen(true);
    expect((await post("/demo/start", TOKENS.view, START)).status).toBe(200);
    now += START_WINDOW_MS - 1;
    expect(await post("/demo/start", TOKENS.view, START)).toMatchObject({ status: 409, json: { error: "conflict" } });
    now += 1;
    expect((await post("/demo/start", TOKENS.view, START)).status).toBe(200);
    expect(tasks).toHaveLength(2);
  });

  it("is 409 while a purchase is open", async () => {
    await listen(true);
    const brief = demoBrief(START as never, signer.buyer, 420);
    await deps.repo.createSourcing("SRC-TEST-1", brief, new Date(now + 180_000));
    expect(await post("/demo/start", TOKENS.view, START)).toMatchObject({ status: 409, json: { error: "conflict", message: "a purchase is already open" } });
    expect(tasks).toEqual([]);
  });

  it("when the agent team cannot be reached it is 502, says nothing about why, and the next try is not blocked", async () => {
    await listen(true);
    failNext = true;
    const failed = await post("/demo/start", TOKENS.view, START);
    expect(failed).toEqual({ status: 502, json: { error: "start_failed", message: "the agent team could not be reached" } });
    expect((await post("/demo/start", TOKENS.view, START)).status).toBe(200);
    expect(tasks).toHaveLength(1);
  });
});

describe("the Lead's task", () => {
  const brief = demoBrief(START as never, "rHVVH877c6yuRMFuqVarsh8v3PkvxdCgk5", 420);

  it("states every number the Lead's instructions ask for, in cents and dollars", () => {
    const d = leadTask(brief).description;
    for (const line of [
      "- Quantity: 400",
      "- Target unit price: 11000 cents ($110.00)",
      "- Maximum unit price: 12000 cents ($120.00). Never reveal this to anyone.",
      "- Incoterm and port: CIF Durban",
      "- Refund deadline: 420 seconds",
      "- Decide-by time: 180 seconds (the latest; decide as soon as Surety says to)",
      "- Priority: balanced",
      "- Latest delivery: 30 days",
    ]) {
      expect(d).toContain(line);
    }
  });

  it("goes to Paperclip on stdin: nothing from the brief is on the command line", async () => {
    const calls: { file: string; args: string[]; input: string }[] = [];
    const start = createPaperclipStarter({
      companyId: "a5420cfe-19a3-4b7d-99a2-8e7999c2e9f8",
      leadAgentId: "11111111-2222-4333-8444-555555555555",
      run: async (file, args, input) => void calls.push({ file, args, input }),
    });
    const task = leadTask(brief);
    await start(task);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("wsl");
    const line = calls[0]?.args.join(" ") ?? "";
    expect(line).toContain("paperclipai issue create -C a5420cfe-19a3-4b7d-99a2-8e7999c2e9f8 --assignee-agent-id 11111111-2222-4333-8444-555555555555");
    expect(line).not.toContain("12000");
    expect(line).not.toContain("Monocrystalline");
    expect(calls[0]?.input).toBe(`${task.title}\n${task.description}\n`);
  });
});

describe("the start settings", () => {
  const env = {
    DATABASE_URL: "postgres://u:p@127.0.0.1:57722/postgres",
    SIGNER_URL: "http://127.0.0.1:4100",
    SIGNER_HMAC_SECRET: "h".repeat(40),
    XRPL_WS_URL: "wss://s.altnet.rippletest.net:51233",
    OPENROUTER_API_KEY: "sk-or-v1-test",
    API_TOKEN_LEAD: t("a"),
    API_TOKEN_SOURCING: t("b"),
    API_TOKEN_NEGOTIATOR: t("c"),
    API_TOKEN_VIEW: t("d"),
    API_TOKEN_INSPECTOR: t("f"),
    API_SUPPLIER_TOKENS: JSON.stringify({ [SUPPLIER]: t("e") }),
  };
  const ids = { PAPERCLIP_COMPANY_ID: "a5420cfe-19a3-4b7d-99a2-8e7999c2e9f8", PAPERCLIP_LEAD_AGENT_ID: "11111111-2222-4333-8444-555555555555" };

  it("is off unless both Paperclip ids are set, and refuses one without the other or anything that is not a UUID", () => {
    expect(loadApiConfig(env).demoStart).toBeNull();
    expect(loadApiConfig({ ...env, ...ids }).demoStart).toEqual({ companyId: ids.PAPERCLIP_COMPANY_ID, leadAgentId: ids.PAPERCLIP_LEAD_AGENT_ID, deadlineSeconds: 420 });
    expect(loadApiConfig({ ...env, ...ids, API_DEMO_DEADLINE_SECONDS: "600" }).demoStart?.deadlineSeconds).toBe(600);
    expect(() => loadApiConfig({ ...env, PAPERCLIP_COMPANY_ID: ids.PAPERCLIP_COMPANY_ID })).toThrow(/PAPERCLIP_COMPANY_ID and PAPERCLIP_LEAD_AGENT_ID/);
    expect(() => loadApiConfig({ ...env, ...ids, PAPERCLIP_LEAD_AGENT_ID: "x; rm -rf ~" })).toThrow(/each a UUID/);
    expect(() => loadApiConfig({ ...env, ...ids, API_DEMO_DEADLINE_SECONDS: "5" })).toThrow(/API_DEMO_DEADLINE_SECONDS/);
  });
});
