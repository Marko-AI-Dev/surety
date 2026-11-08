import {
  type CancelEscrowRequest,
  type CreateEscrowRequest,
  type CreateEscrowResponse,
  type FinishEscrowRequest,
  type HealthResponse,
  SIG_HEADER,
  type SettleResponse,
  TS_HEADER,
  signRequest,
} from "@surety/contracts";

export class SignerClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SignerClientError";
  }
}

export interface SignerClient {
  health(): Promise<HealthResponse>;
  createEscrow(req: CreateEscrowRequest): Promise<CreateEscrowResponse>;
  finishEscrow(req: FinishEscrowRequest): Promise<SettleResponse>;
  cancelEscrow(req: CancelEscrowRequest): Promise<SettleResponse>;
}

export function createSignerClient(opts: { url: string; hmacSecret: string }): SignerClient {
  const base = opts.url.replace(/\/$/, "");

  async function call<T>(method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const ts = String(Date.now());
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        [TS_HEADER]: ts,
        [SIG_HEADER]: signRequest(opts.hmacSecret, ts, method, path, body),
      },
      body: method === "POST" ? body : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new SignerClientError(res.status, String(json.error ?? "unknown"), String(json.message ?? text));
    }
    return json as T;
  }

  return {
    health: () => call<HealthResponse>("GET", "/health"),
    createEscrow: (req) => call<CreateEscrowResponse>("POST", "/escrows/create", req),
    finishEscrow: (req) => call<SettleResponse>("POST", "/escrows/finish", req),
    cancelEscrow: (req) => call<SettleResponse>("POST", "/escrows/cancel", req),
  };
}
