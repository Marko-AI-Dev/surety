// The negotiator's one-call helper for the Surety API (12 Nov 2026). Each Codex step costs about
// 5 seconds of model time, and a round of curl calls took 8 to 10 steps. These three commands do a
// round in three: look at everything, wait for a supplier without polling, act on all suppliers at
// once. The agent still decides and writes every message; this file only fetches and posts.
// Plain Node 24 with no dependencies (types are stripped at run time). Never prints the token.
//
//   node surety.ts look <sourcingId>
//   node surety.ts wait <sourcingId> --since <cursor> [--max <seconds, default 25>]
//   node surety.ts act <sourcingId> <<'EOF'
//   {"messages":[{"supplier":"r...","text":"..."}],"reports":[{"supplier":"r...","unitCents":11800,"quantity":400,"deliveryDays":21,"summary":"..."}]}
//   EOF

export type Priority = "price" | "speed" | "balanced";
export type Push = "gentle" | "firm";
export type Autonomy = "full" | "approve";
export type BuyerNote = { text: string; at: string };

export interface Offer {
  supplier: string;
  unitCents: number;
  deliveryDays: number | null;
  source: "committed" | "reported";
  at: string | null;
}

export interface View {
  id: string;
  ref: string;
  state: string;
  goods: { description: string; quantity: number; targetUnitCents: number };
  incoterm: string;
  port: string;
  priority: Priority;
  latestDeliveryDays: number | null;
  // How hard the buyer wants the push, and what the buyer told its negotiator. Absent before 13 Nov.
  push?: Push;
  buyerNotes?: BuyerNote[];
  // Whether each message waits for the buyer, whether the buyer asked for what there is now, and the
  // messages that wait. Absent before 14 Nov.
  autonomy?: Autonomy;
  wrapUp?: boolean;
  pendingDrafts?: { supplier: string; at: string }[];
  negotiationEndsAt: string;
  secondsLeft: number;
  invites: { address: string; name: string; status: "in" | "out"; committed: boolean }[];
  offers: Offer[];
}

export type Inbox = (
  | { supplier: string; kind: "to_supplier" | "from_supplier"; text: string; at: string; byBuyer?: true }
  | { supplier: string; kind: "from_supplier"; withheld: true; card: string | null; at: string }
)[];

// "buyer": the buyer wrote this message to the supplier themself.
type Line = { from: "you" | "buyer" | "supplier"; text: string } | { from: "supplier"; withheld: true };

export interface SupplierDigest {
  address: string;
  name: string;
  committed: boolean;
  lastReport: { unitCents: number; deliveryDays: number | null } | null;
  bestCompetingOffer: { unitCents: number; deliveryDays: number | null } | null;
  // The latest offer is at or under the target price and within the latest delivery: stop pushing.
  meetsBrief: boolean;
  awaitingReply: boolean;
  // A message of yours to this supplier waits for the buyer: write nothing more to it until it is decided.
  draftWaiting: boolean;
  newMessages: number;
  thread: Line[];
}

export interface Digest {
  ref: string;
  phase: "negotiate" | "final_call" | "closed";
  secondsLeft: number;
  goods: string;
  quantity: number;
  targetUnitCents: number;
  incoterm: string;
  port: string;
  priority: Priority;
  latestDeliveryDays: number | null;
  push: Push;
  autonomy: Autonomy;
  // The buyer asked for what you have: the phase is final_call from then on.
  wrapUp: boolean;
  buyerNotes: BuyerNote[];
  cursor: number;
  suppliers: SupplierDigest[];
}

const FINAL_CALL_SECONDS = 30;
const THREAD_LINES = 6;

const cmp = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

// The best offer from any other supplier for the buyer's priority, ranked the way Surety ranks
// committed quotes (packages/workflow/src/sourcing-rank.ts), among offers that meet the latest delivery.
export function bestOtherOffer(priority: Priority, offers: Offer[], self: string, latestDeliveryDays: number | null): Offer | null {
  const usable = offers.filter((o) => o.supplier !== self && o.deliveryDays !== null && (latestDeliveryDays === null || o.deliveryDays <= latestDeliveryDays));
  if (usable.length === 0) return null;
  const days = (o: Offer) => o.deliveryDays ?? 0;
  const minCents = Math.min(...usable.map((o) => o.unitCents));
  const minDays = Math.min(...usable.map(days));
  const score = (o: Offer) => o.unitCents * minDays + days(o) * minCents;
  const order: Record<Priority, (a: Offer, b: Offer) => number> = {
    price: (a, b) => cmp(a.unitCents, b.unitCents) || cmp(days(a), days(b)),
    speed: (a, b) => cmp(days(a), days(b)) || cmp(a.unitCents, b.unitCents),
    balanced: (a, b) => cmp(score(a), score(b)) || cmp(a.unitCents, b.unitCents),
  };
  return [...usable].sort(order[priority])[0] ?? null;
}

const lineOf = (m: Inbox[number]): Line =>
  "withheld" in m ? { from: "supplier", withheld: true } : { from: m.kind === "to_supplier" ? (m.byBuyer ? "buyer" : "you") : "supplier", text: m.text };

export function digest(view: View, inbox: Inbox, since: number): Digest {
  // The API sends the sourcing's own state: OPEN while suppliers can be talked to. The final call
  // starts when the buyer asks for what there is, or shortly before the buyer's decide-by time.
  const phase = view.state !== "OPEN" || view.secondsLeft <= 0 ? "closed" : view.wrapUp === true || view.secondsLeft <= FINAL_CALL_SECONDS ? "final_call" : "negotiate";
  const waiting = new Set((view.pendingDrafts ?? []).map((d) => d.supplier));
  const suppliers = view.invites
    .filter((i) => i.status === "in")
    .map((i): SupplierDigest => {
      const mine = inbox.map((m, index) => ({ m, index })).filter(({ m }) => m.supplier === i.address);
      const report = view.offers.find((o) => o.supplier === i.address);
      const other = bestOtherOffer(view.priority, view.offers, i.address, view.latestDeliveryDays);
      // Cite it only when it beats this supplier's own latest offer for the buyer's priority: a worse
      // offer is no leverage, and a supplier told of a faster but dearer quote raises its price.
      // Ranked with the supplier's own offer first, so a tie is not cited either.
      const best = other && report ? (bestOtherOffer(view.priority, [{ ...report, supplier: i.address }, other], "", view.latestDeliveryDays) === other ? other : null) : other;
      return {
        address: i.address,
        name: i.name,
        committed: i.committed,
        lastReport: report ? { unitCents: report.unitCents, deliveryDays: report.deliveryDays } : null,
        bestCompetingOffer: best ? { unitCents: best.unitCents, deliveryDays: best.deliveryDays } : null,
        meetsBrief:
          report !== undefined &&
          report.unitCents <= view.goods.targetUnitCents &&
          report.deliveryDays !== null &&
          (view.latestDeliveryDays === null || report.deliveryDays <= view.latestDeliveryDays),
        awaitingReply: mine.at(-1)?.m.kind === "to_supplier" || waiting.has(i.address),
        draftWaiting: waiting.has(i.address),
        newMessages: mine.filter(({ m, index }) => index >= since && m.kind === "from_supplier").length,
        thread: mine.slice(-THREAD_LINES).map(({ m }) => lineOf(m)),
      };
    });
  return {
    ref: view.ref,
    phase,
    secondsLeft: view.secondsLeft,
    goods: view.goods.description,
    quantity: view.goods.quantity,
    targetUnitCents: view.goods.targetUnitCents,
    incoterm: view.incoterm,
    port: view.port,
    priority: view.priority,
    latestDeliveryDays: view.latestDeliveryDays,
    push: view.push ?? "firm",
    autonomy: view.autonomy ?? "full",
    wrapUp: view.wrapUp === true,
    buyerNotes: view.buyerNotes ?? [],
    cursor: inbox.length,
    suppliers,
  };
}

export interface Actions {
  messages: { supplier: string; text: string }[];
  reports: { supplier: string; unitCents: number; quantity: number; deliveryDays: number; summary: string }[];
}

const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n > 0;

export function parseActions(text: string): Actions {
  let raw: { messages?: unknown; reports?: unknown };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    throw new Error("act reads one JSON object on stdin: not valid JSON");
  }
  const messages = (Array.isArray(raw.messages) ? raw.messages : []) as Actions["messages"];
  const reports = (Array.isArray(raw.reports) ? raw.reports : []) as Actions["reports"];
  if (messages.length + reports.length === 0) throw new Error("act was given nothing to send: pass messages and/or reports");
  for (const m of messages) {
    if (typeof m.supplier !== "string" || typeof m.text !== "string" || m.text.trim() === "") throw new Error("each message needs supplier and text");
    if (m.text.length > 400) throw new Error("a message must be 400 characters or fewer");
  }
  for (const r of reports) {
    if (typeof r.supplier !== "string" || typeof r.summary !== "string") throw new Error("each report needs supplier and summary");
    if (!whole(r.unitCents)) throw new Error("unitCents must be a whole number of cents, such as 11800 for $118.00");
    if (!whole(r.quantity) || !whole(r.deliveryDays)) throw new Error("quantity and deliveryDays must be whole numbers");
  }
  return { messages, reports };
}

type FetchLike = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface Io {
  fetch: typeof globalThis.fetch | FetchLike;
  env: Record<string, string | undefined>;
  stdin: () => Promise<string>;
  sleep: (ms: number) => Promise<void>;
}

const USAGE = "usage: node surety.ts look <sourcingId> | wait <sourcingId> --since <cursor> [--max <seconds>] | act <sourcingId> < actions.json";
const POLL_MS = 2000;

function flag(argv: string[], name: string): number | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} needs a number`);
  return n;
}

export async function run(argv: string[], io: Io): Promise<string> {
  const [command, id] = argv;
  if (!command || !id || !["look", "wait", "act"].includes(command)) throw new Error(USAGE);
  const base = io.env.SURETY_API_URL;
  const token = io.env.SURETY_API_TOKEN;
  if (!base || !token) throw new Error("SURETY_API_URL and SURETY_API_TOKEN must be set");
  const sid = encodeURIComponent(id);
  const fetchFn = io.fetch as FetchLike;

  const call = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    return { ok: res.ok, status: res.status, json };
  };
  const get = async <T>(path: string): Promise<T> => {
    const r = await call("GET", path);
    if (!r.ok) throw new Error(`GET ${path} failed: ${r.status} ${r.json.error ?? ""} ${r.json.message ?? ""}`.trim());
    return r.json as T;
  };
  const look = async (since: number) => {
    const [view, inbox] = await Promise.all([get<View>(`/sourcing/${sid}`), get<Inbox>(`/sourcing/${sid}/inbox`)]);
    return digest(view, inbox, since);
  };

  if (command === "look") return JSON.stringify(await look(flag(argv, "--since") ?? 0), null, 1);

  if (command === "wait") {
    const since = flag(argv, "--since") ?? 0;
    const max = Math.min(flag(argv, "--max") ?? 25, 120);
    let d = await look(since);
    const startedInFinalCall = d.phase === "final_call";
    const notesAtStart = d.buyerNotes.length;
    const suppliersAtStart = new Set(d.suppliers.map((s) => s.address));
    const draftsAtStart = d.suppliers.filter((s) => s.draftWaiting).length;
    for (let waited = 0; ; waited += POLL_MS / 1000) {
      const woke =
        d.phase === "closed" ? "closed"
        : d.phase === "final_call" && !startedInFinalCall ? "final_call"
        : d.buyerNotes.length > notesAtStart ? "buyer_note"
        : d.suppliers.some((s) => !suppliersAtStart.has(s.address)) ? "supplier_invited"
        : d.suppliers.some((s) => s.newMessages > 0) ? "supplier_replied"
        : d.suppliers.filter((s) => s.draftWaiting).length < draftsAtStart ? "draft_decided"
        : waited >= max ? "timeout"
        : null;
      if (woke) return JSON.stringify({ woke, ...d }, null, 1);
      await io.sleep(POLL_MS);
      d = await look(since);
    }
  }

  const actions = parseActions(await io.stdin());
  const results: { kind: "message" | "report"; supplier: string; ok: boolean; held?: "buyer_review"; error?: string }[] = [];
  for (const m of actions.messages) {
    const r = await call("POST", `/sourcing/${sid}/messages`, m);
    // Held for the buyer: it has not gone out. The buyer may send it, reword it or throw it away.
    const held = (r.json as { held?: string }).held === "buyer_review";
    results.push(r.ok ? { kind: "message", supplier: m.supplier, ok: true, ...(held ? { held: "buyer_review" as const } : {}) } : { kind: "message", supplier: m.supplier, ok: false, error: `${r.json.error ?? r.status}: ${r.json.message ?? ""}`.trim() });
  }
  for (const rep of actions.reports) {
    const r = await call("POST", `/sourcing/${sid}/reports`, rep);
    results.push(r.ok ? { kind: "report", supplier: rep.supplier, ok: true } : { kind: "report", supplier: rep.supplier, ok: false, error: `${r.json.error ?? r.status}: ${r.json.message ?? ""}`.trim() });
  }
  const after = await look(Number.MAX_SAFE_INTEGER);
  return JSON.stringify({ results, after }, null, 1);
}

if (import.meta.main) {
  const stdin = async () => {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  };
  run(process.argv.slice(2), { fetch: globalThis.fetch, env: process.env, stdin, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })
    .then((out) => console.log(out))
    .catch((e: Error) => {
      console.error(e.message);
      process.exit(1);
    });
}
