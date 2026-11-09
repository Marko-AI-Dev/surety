import type { SourcingListItem, SourcingRecord } from "./types";

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
  };
}

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
