import {
  type CancelEscrowRequest,
  type CreateEscrowRequest,
  type CreateEscrowResponse,
  type FinishEscrowRequest,
  type HealthResponse,
  type PolicyView,
  SIG_HEADER,
  type SettleResponse,
  TS_HEADER,
  type UpdatePolicyRequest,
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

function caller(url: string, secret: string) {
  const base = url.replace(/\/$/, "");
  return async function call<T>(method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const ts = String(Date.now());
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        [TS_HEADER]: ts,
        [SIG_HEADER]: signRequest(secret, ts, method, path, body),
      },
      body: method === "POST" ? body : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new SignerClientError(res.status, String(json.error ?? "unknown"), String(json.message ?? text));
    }
    return json as T;
  };
}

export function createSignerClient(opts: { url: string; hmacSecret: string }): SignerClient {
  const call = caller(opts.url, opts.hmacSecret);
  return {
    health: () => call<HealthResponse>("GET", "/health"),
    createEscrow: (req) => call<CreateEscrowResponse>("POST", "/escrows/create", req),
    finishEscrow: (req) => call<SettleResponse>("POST", "/escrows/finish", req),
    cancelEscrow: (req) => call<SettleResponse>("POST", "/escrows/cancel", req),
  };
}

export interface OperatorClient {
  updatePolicy(req: UpdatePolicyRequest): Promise<PolicyView>;
}

// For the operator only (the Control room's server side, operator scripts). Never for the worker or agents.
export function createOperatorClient(opts: { url: string; operatorSecret: string }): OperatorClient {
  const call = caller(opts.url, opts.operatorSecret);
  return { updatePolicy: (req) => call<PolicyView>("POST", "/operator/policy", req) };
}
