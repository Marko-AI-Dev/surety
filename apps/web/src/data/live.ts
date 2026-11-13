import { recordUpTo, simSteps } from "./livescreen";
import { timelineBounds } from "./timeline";
import type { Inspection, SourcingListItem, SourcingRecord } from "./types";

// Live mode. The operator views poll two read-only routes through the same-origin /api proxy, which
// adds the view token on the server side. The supplier seat calls the supplier routes of docs/api.md
// with the supplier's own token, held in memory only.

export type FetchFn = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(fetchFn: FetchFn, url: string, init?: Parameters<FetchFn>[1]): Promise<T> {
  let res: Awaited<ReturnType<FetchFn>>;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new ApiError(0, "unreachable", "The Surety API is not reachable.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const e = body as { error?: string; message?: string } | null;
    throw new ApiError(res.status, e?.error ?? "error", e?.message ?? `The API answered ${res.status}.`);
  }
  return body as T;
}

export interface LiveSource {
  list(): Promise<SourcingListItem[]>;
  record(id: string): Promise<SourcingRecord>;
  // The newest sourcing's record, or null when there is none yet.
  latest(): Promise<SourcingRecord | null>;
  // The clock the run is on: the wall clock for a real run.
  now(): number;
  // True for the simulated feed, so the screen can never pass it off as live.
  simulated: boolean;
}

export function createLiveSource(fetchFn: FetchFn, base = "/api"): LiveSource {
  const list = () => call<SourcingListItem[]>(fetchFn, `${base}/sourcing`);
  const record = (id: string) => call<SourcingRecord>(fetchFn, `${base}/sourcing/${encodeURIComponent(id)}/record`);
  return {
    list,
    record,
    async latest() {
      const first = (await list())[0];
      return first ? record(first.id) : null;
    },
    now: () => Date.now(),
    simulated: false,
  };
}

// A recorded run fed through the live path at a steady pace, for testing the live screen without a
// backend. It starts a moment before the purchase opens and ends when the run does.
export function createSimSource(recorded: SourcingRecord, opts: { speed?: number; clock?: () => number } = {}): LiveSource {
  const steps = simSteps(recorded);
  const { start, end } = timelineBounds(steps);
  const clock = opts.clock ?? (() => Date.now());
  const speed = opts.speed ?? 6;
  const began = clock();
  const now = () => Math.min(end, start + (clock() - began) * speed);
  const record = async () => {
    const r = recordUpTo(recorded, steps, now());
    if (!r) throw new ApiError(404, "not_found", "no such resource");
    return r;
  };
  return {
    list: async () => (recordUpTo(recorded, steps, now()) ? [{ id: recorded.sourcing.id, ref: recorded.sourcing.ref, state: "OPEN" }] : []),
    record,
    latest: async () => recordUpTo(recorded, steps, now()),
    now,
    simulated: true,
  };
}

// What the start screen sends to POST /demo/start (docs/api.md). The API adds the rest of the order.
export interface StartBrief {
  quantity: number;
  targetUnitCents: number;
  maxUnitCents: number;
  priority: "price" | "speed" | "balanced";
  latestDeliveryDays: number;
  negotiationSeconds: number;
  push?: "gentle" | "firm";
}
export function startPurchase(fetchFn: FetchFn, brief: StartBrief, base = "/api"): Promise<unknown> {
  return call<unknown>(fetchFn, `${base}/demo/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(brief) });
}

// The buyer's screen: plain words in, the numbers of a purchase out (POST /buyer/intake).
export type Draft = Partial<Omit<StartBrief, "negotiationSeconds">>;
export type DraftField = keyof Draft;
export interface IntakeAnswer {
  draft: Draft;
  question: { field: DraftField; ask: string } | null;
  ready: boolean;
  readBy: "code" | "code and model";
}
const post = <T>(fetchFn: FetchFn, url: string, body: unknown) =>
  call<T>(fetchFn, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
export const readNeed = (fetchFn: FetchFn, body: { text: string; draft?: Draft; field?: DraftField }, base = "/api") => post<IntakeAnswer>(fetchFn, `${base}/buyer/intake`, body);
// A note from the buyer to its own negotiator (POST /sourcing/:id/notes).
export const sendNote = (fetchFn: FetchFn, sourcingId: string, text: string, base = "/api") => post<{ text: string }>(fetchFn, `${base}/sourcing/${sourcingId}/notes`, { text });
// The buyer's final yes or no (POST /deals/:id/approval). Only a yes can lock the payment.
export const answerDeal = (fetchFn: FetchFn, dealId: string, outcome: "approve" | "decline", reason?: string, base = "/api") =>
  post<{ deal: { state: string }; job: { state: string } | null }>(fetchFn, `${base}/deals/${dealId}/approval`, reason ? { outcome, reason } : { outcome });
// The admin assistant (POST /admin/ask): answers from the records only.
export const askAdmin = (fetchFn: FetchFn, question: string, base = "/api") => post<{ answer: string; basedOn: string[] }>(fetchFn, `${base}/admin/ask`, { question });

export interface SupplierSourcing {
  sourcingId: string;
  ref: string;
  state: string;
  goods: string;
  quantity: number;
  incoterm: string;
  port: string;
  negotiationEndsAt: string;
  committed: boolean;
  // Phase 4d: this supplier's own committed price and delivery time.
  committedQuote?: { unitCents: number; deliveryDays: number | null } | null;
  dealId: string | null;
}
export interface ThreadItem {
  kind: "to_supplier" | "from_supplier";
  text: string;
  delivered?: boolean;
  card?: "yellow" | "red" | null;
  at: string;
}
export interface SupplierDeal {
  dealId: string;
  ref: string;
  sourcingId: string;
  state: string;
  jobState: string | null;
}
export interface QuoteForm {
  quoteNumber: string;
  quantity: number;
  unitCents: number;
  incoterm: string;
  port: string;
  // Phase 4d: required by the API, 1 to 365.
  deliveryDays: number;
  notes: string;
}
export interface SettlementForm {
  invoiceNumber: string;
  blNumber: string;
  vessel: string;
  portOfLoading: string;
  remarks: { invoice: string; billOfLading: string };
}

// The supplier's own routes. The token goes in the Authorization header, never in a URL.
export function createSupplierClient(fetchFn: FetchFn, token: string, base = "/api") {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const get = <T>(path: string) => call<T>(fetchFn, `${base}${path}`, { headers });
  const post = <T>(path: string, body: unknown) => call<T>(fetchFn, `${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return {
    sourcings: () => get<SupplierSourcing[]>("/supplier/sourcing"),
    thread: (id: string) => get<ThreadItem[]>(`/supplier/sourcing/${id}/thread`),
    send: (id: string, text: string) =>
      post<{ delivered: boolean; card: "yellow" | "red" | null; status: "in" | "out" }>(`/supplier/sourcing/${id}/messages`, { text }),
    quote: (id: string, form: QuoteForm) => post<unknown>(`/supplier/sourcing/${id}/quote`, form),
    deals: () => get<SupplierDeal[]>("/supplier/deals"),
    settlementDraft: (dealId: string) =>
      get<{ fixed: unknown; suggested: { invoiceNumber: string; remarks: { invoice: string; billOfLading: string } } }>(
        `/supplier/deals/${dealId}/settlement`,
      ),
    settle: (dealId: string, form: SettlementForm) => post<{ id: string; state: string }>(`/supplier/deals/${dealId}/settlement`, form),
  };
}

export type SupplierClient = ReturnType<typeof createSupplierClient>;

// The inspector's two routes (Phase 4d). The queue never carries the supplier's B/L number, so the
// inspector's reading is its own.
export interface InspectorDeal {
  dealId: string;
  poNumber: string;
  goods: string;
  quantity: number;
  incoterm: string;
  port: string;
  supplierName: string;
  jobState: string | null;
}
export interface AttestationForm {
  blNumber: string;
  outcome: "attested" | "refused";
  note: string;
}
export function createInspectorClient(fetchFn: FetchFn, token: string, base = "/api") {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    queue: () => call<InspectorDeal[]>(fetchFn, `${base}/inspector/deals`, { headers }),
    attest: (dealId: string, form: AttestationForm) =>
      call<Inspection>(fetchFn, `${base}/inspector/deals/${encodeURIComponent(dealId)}/attestation`, { method: "POST", headers, body: JSON.stringify(form) }),
  };
}
export type InspectorClient = ReturnType<typeof createInspectorClient>;
