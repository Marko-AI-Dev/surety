import { createHash } from "node:crypto";
import {
  type CancelEscrowRequest,
  type CreateEscrowRequest,
  type CreateEscrowResponse,
  type FinishEscrowRequest,
  type HealthResponse,
  type SettleResponse,
  verifyAuthorization,
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
  authorization_invalid: 403,
  authorization_consumed: 409,
  finish_window_closed: 409,
  escrow_not_found: 404,
  escrow_mismatch: 409,
  cancel_not_yet_eligible: 409,
  op_pending: 409,
  op_failed: 409,
  ledger_failure: 502,
  daily_cap_reached: 403,
  open_deal_limit_reached: 403,
  destination_not_ready: 409,
  insufficient_funds: 409,
  asset_not_enabled: 400,
};

export function signerError(code: string): SignerClientError {
  return new SignerClientError(STATUS[code] ?? 500, code, `fake signer: ${code}`);
}

const hashOf = (s: string) => createHash("sha256").update(s).digest("hex").toUpperCase();

// Stands in for the signer over HTTP. Like the real one it replays a completed opId with the same
// response, and it records every call so tests can count the opIds a sweep used.
export class FakeSigner implements SignerClient {
  // Well-formed classic addresses (the authorization schema checks the format); no keys exist for them.
  readonly buyer = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
  readonly service = "rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1";
  // The TESTUSD issuer a real signer would report for a TESTUSD lock.
  readonly issuer = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
  calls: { method: Method; opId: string; req: unknown }[] = [];
  ledgerIndex = 5000;
  private nextSequence = 100;
  private scripts = new Map<string, Outcome[]>();
  private done = new Map<string, CreateEscrowResponse | SettleResponse>();

  // Every settle the fake actually signed, in order: a test counts validated finishes here.
  settled: { method: Method; opId: string }[] = [];

  // With gate set, finish verifies the authorization like the real signer does: after replaying a
  // completed opId, and before signing anything new.
  constructor(
    public closeTime = 800_000_000,
    private readonly gate?: { secret: string; now: () => Date },
  ) {}

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
      ...(req.amountTestUsdCents ? { issuer: this.issuer } : {}),
    };
    this.done.set(req.opId, res);
    return res;
  }

  async finishEscrow(req: FinishEscrowRequest): Promise<SettleResponse> {
    this.take("finish", req.opId, req);
    if (!this.done.has(req.opId) && this.gate) {
      const verdict = verifyAuthorization(req.authorization, this.gate.secret, this.gate.now());
      if (!verdict.ok) throw new SignerClientError(403, "authorization_invalid", `fake signer: ${verdict.reason}`);
    }
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
    this.settled.push({ method, opId });
    return res;
  }

  private take(method: Method, opId: string, req: unknown): void {
    this.calls.push({ method, opId, req });
    const next = this.scripts.get(opId)?.shift();
    if (next instanceof Error) throw next;
  }
}
