// The demo supplier agents. Each polls the Surety API with its own supplier token, answers the
// negotiator with code-set prices (worded by a cheap model or a template), commits its quote, and once
// its deal's payment is LOCKED submits the pre-filled settlement form. The crook plays its script.
// Run: pnpm suppliers  (needs .env, .env.api, the directory and the API)
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AgentState, type Order, type ThreadItem, initialState, nextMove } from "./negotiate";
import { PERSONAS, type Persona } from "./personas";
import { createWording } from "./wording";

const ROOT = resolve(import.meta.dirname, "../../..");
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);
const POLL_MS = 2_000;

const base = process.env.SUPPLIER_API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? "4200"}`;
const tokens = JSON.parse(process.env.API_SUPPLIER_TOKENS ?? "{}") as Record<string, string>;
const directoryPath = resolve(ROOT, process.env.SUPPLIER_DIRECTORY ?? "fixtures/sourcing/directory.json");
if (!existsSync(directoryPath)) throw new Error(`no supplier directory at ${directoryPath}: run pnpm suppliers:directory`);
const directory = JSON.parse(readFileSync(directoryPath, "utf8")) as { address: string; name: string; persona: string }[];
const stranger = directory.find((e) => e.persona === "lowtide")?.address ?? "";
const useModel = (process.env.SUPPLIER_WORDING ?? "model") === "model";
const wording = createWording({
  apiKey: useModel ? (process.env.OPENROUTER_API_KEY ?? "") : "",
  model: process.env.SUPPLIER_MODEL ?? "openai/gpt-4o-mini",
  maxCalls: 60,
});

interface Agent {
  address: string;
  persona: Persona;
  token: string;
  states: Map<string, AgentState>;
  settled: Set<string>;
}

// SUPPLIER_SKIP=brightway,sunpeak leaves those suppliers to a person on the supplier seat (12 Nov).
const skip = new Set((process.env.SUPPLIER_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const agents: Agent[] = directory.flatMap((e) => {
  if (skip.has(e.persona)) return [];
  const persona = PERSONAS[e.persona as Persona["key"]];
  const token = tokens[e.address];
  return persona && token ? [{ address: e.address, persona: { ...persona, name: e.name }, token, states: new Map(), settled: new Set() }] : [];
});
if (agents.length === 0) throw new Error("no supplier in the directory has a token in API_SUPPLIER_TOKENS");

async function api<T>(agent: Agent, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${agent.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(`${res.status} ${json.error ?? ""}: ${json.message ?? ""}`);
  return json;
}

interface SourcingItem {
  sourcingId: string;
  state: string;
  quantity: number;
  incoterm: Order["incoterm"];
  port: string;
  negotiationEndsAt: string;
  committed: boolean;
}

async function negotiate(agent: Agent): Promise<void> {
  for (const s of await api<SourcingItem[]>(agent, "GET", "/supplier/sourcing")) {
    if (s.state !== "OPEN" || s.committed) continue;
    const state = agent.states.get(s.sourcingId) ?? initialState();
    if (state.committed) continue;
    const thread = await api<ThreadItem[]>(agent, "GET", `/supplier/sourcing/${s.sourcingId}/thread`);
    const secondsLeft = (Date.parse(s.negotiationEndsAt) - Date.now()) / 1000;
    const r = nextMove(agent.persona, state, thread, secondsLeft, { quantity: s.quantity, incoterm: s.incoterm, port: s.port });
    if (!r) continue;
    agent.states.set(s.sourcingId, r.state);
    try {
      if ("commit" in r.move) {
        await api(agent, "POST", `/supplier/sourcing/${s.sourcingId}/quote`, r.move.commit);
        log(`${agent.persona.key}: committed ${r.move.commit.unitCents} cents a panel, ${r.move.commit.deliveryDays} days`);
      } else {
        const text = "say" in r.move ? await wording(agent.persona, r.move.say, thread) : r.move.script.replace("{wallet}", stranger);
        const res = await api<{ delivered: boolean; card: string | null; status: string }>(agent, "POST", `/supplier/sourcing/${s.sourcingId}/messages`, { text });
        log(`${agent.persona.key}: "${text.slice(0, 70)}" -> ${res.delivered ? "delivered" : `held (${res.card ?? "no card"})`}, ${res.status}`);
        if (res.status === "out") agent.states.set(s.sourcingId, { ...r.state, committed: true });
      }
    } catch (e) {
      log(`${agent.persona.key}: ${e instanceof Error ? e.message : String(e)}`);
      if (String(e).includes("supplier_out")) agent.states.set(s.sourcingId, { ...r.state, committed: true });
    }
  }
}

async function settle(agent: Agent): Promise<void> {
  for (const d of await api<{ dealId: string; jobState: string | null }[]>(agent, "GET", "/supplier/deals")) {
    if (d.jobState !== "LOCKED" || agent.settled.has(d.dealId)) continue;
    const draft = await api<{ suggested: { invoiceNumber: string; remarks: { invoice: string; billOfLading: string } } }>(
      agent,
      "GET",
      `/supplier/deals/${d.dealId}/settlement`,
    );
    const form = {
      invoiceNumber: draft.suggested.invoiceNumber,
      blNumber: `SZXDUR-${String(Date.now()).slice(-5)}`,
      vessel: "MSC AURORA V.214E",
      portOfLoading: "Shenzhen (Yantian)",
      remarks: draft.suggested.remarks,
    };
    const job = await api<{ state: string }>(agent, "POST", `/supplier/deals/${d.dealId}/settlement`, form);
    agent.settled.add(d.dealId);
    // The stand-in for the paper the inspector reads at the port: the inspector attests this number.
    log(`${agent.persona.key}: shipped on B/L ${form.blNumber} for deal ${d.dealId}, settlement form confirmed -> ${job.state}`);
  }
}

log(`supplier agents: ${agents.map((a) => a.persona.key).join(", ")} | API ${base} | wording ${useModel ? "model" : "template"}`);
for (;;) {
  for (const agent of agents) {
    try {
      await negotiate(agent);
      await settle(agent);
    } catch (e) {
      log(`${agent.persona.key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
