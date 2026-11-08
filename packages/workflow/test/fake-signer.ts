import { createHash } from "node:crypto";
import type {
  CancelEscrowRequest,
  CreateEscrowRequest,
  CreateEscrowResponse,
  FinishEscrowRequest,
  HealthResponse,
  SettleResponse,
} from "@surety/contracts";
import { type SignerClient, SignerClientError } from "@surety/signer-client";

type Method = "create" | "finish" | "cancel";
// A scripted outcome for one call: an error to throw, or "ok" for the default success.
type Outcome = Error | "ok";

// Status codes as the real signer sends them (services/signer/src/errors.ts).
const STATUS: Record<string, number> = {
  bad_request: 400,
  destination_not_allowed: 403,
  amount_over_cap: 403,
  cancel_window_invalid: 400,
  escrow_not_found: 404,
  escrow_mismatch: 409,
  cancel_not_yet_eligible: 409,
  op_pending: 409,
  op_failed: 409,
  ledger_failure: 502,
};

export function signerError(code: string): SignerClientError {
  return new SignerClientError(STATUS[code] ?? 500, code, `fake signer: ${code}`);
}

const hashOf = (s: string) => createHash("sha256").update(s).digest("hex").toUpperCase();

// Stands in for the signer over HTTP. Like the real one it replays a completed opId with the same
// response, and it records every call so tests can count the opIds a sweep used.
export class FakeSigner implements SignerClient {
  readonly buyer = "rFakeBuyerAddressForWorkflowTest1";
  readonly service = "rFakeServiceAddressForWorkflowTst";
  calls: { method: Method; opId: string; req: unknown }[] = [];
  ledgerIndex = 5000;
  private nextSequence = 100;
  private scripts = new Map<string, Outcome[]>();
  private done = new Map<string, CreateEscrowResponse | SettleResponse>();

  constructor(public closeTime = 800_000_000) {}

  // The next calls with this opId get these outcomes, in order; after that, success.
  script(opId: string, ...outcomes: Outcome[]): void {
    this.scripts.set(opId, [...(this.scripts.get(opId) ?? []), ...outcomes]);
  }

  opIds(method: Method): string[] {
    return [...new Set(this.calls.filter((c) => c.method === method).map((c) => c.opId))];
  }

  count(method: Method): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  async health(): Promise<HealthResponse> {
    return { network: "testnet", buyer: this.buyer, service: this.service };
  }

  async createEscrow(req: CreateEscrowRequest): Promise<CreateEscrowResponse> {
    this.take("create", req.opId, req);
    const prior = this.done.get(req.opId);
    if (prior) return prior as CreateEscrowResponse;
    const res: CreateEscrowResponse = {
      opId: req.opId,
      txHash: hashOf(`create:${req.opId}`),
      owner: this.buyer,
      offerSequence: this.nextSequence++,
      condition: `A0258020${hashOf(req.opId)}810120`,
      cancelAfter: this.closeTime + req.cancelAfterSeconds,
      ledgerIndex: ++this.ledgerIndex,
      result: "tesSUCCESS",
    };
    this.done.set(req.opId, res);
    return res;
  }

  async finishEscrow(req: FinishEscrowRequest): Promise<SettleResponse> {
    this.take("finish", req.opId, req);
    return this.settle("finish", req.opId);
  }

  async cancelEscrow(req: CancelEscrowRequest): Promise<SettleResponse> {
    this.take("cancel", req.opId, req);
    return this.settle("cancel", req.opId);
  }

  private settle(method: Method, opId: string): SettleResponse {
    const prior = this.done.get(opId);
    if (prior) return prior as SettleResponse;
    const res: SettleResponse = {
      opId,
      txHash: hashOf(`${method}:${opId}`),
      ledgerIndex: ++this.ledgerIndex,
      result: "tesSUCCESS",
      feeDrops: "12",
    };
    this.done.set(opId, res);
    return res;
  }

  private take(method: Method, opId: string, req: unknown): void {
    this.calls.push({ method, opId, req });
    const next = this.scripts.get(opId)?.shift();
    if (next instanceof Error) throw next;
  }
}
