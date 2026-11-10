import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { ZodError, z } from "zod";
import { Address } from "@surety/contracts";
import {
  AttestationConflict,
  DealConflict,
  DealTransitionConflict,
  DeliverableConflict,
  InspectionClosed,
  InspectionNotFound,
  InviteConflict,
  NotInvited,
  QuoteConflict,
  SourcingClosed,
  SourcingConflict,
  type SourcingDeps,
  SourcingNotFound,
  SourcingRefused,
  SupplierOut,
  TransitionConflict,
  TransitionError,
  attest,
  commitQuote,
  inspectionOf,
  inspectorQueue,
  inviteSupplier,
  leadDecision,
  leadView,
  negotiatorInbox,
  negotiatorView,
  openSourcing,
  postNegotiatorMessage,
  postSupplierMessage,
  reportOffer,
  selectSupplier,
  settlementDraftFor,
  submitSettlement,
  suggestSupplier,
  supplierOnHold,
  supplierThread,
} from "@surety/workflow";
import type { ApiTokens } from "./config";

// The Surety API: the only door for the buyer's agents, the supplier agents and the UI. One bearer
// token per role and one per supplier, so a token names exactly one caller, and each route lists the
// roles it serves. The negotiator's routes never carry the maximum price. Other suppliers' threads,
// quotes and deals answer 404, exactly like a missing one. The inspector (a person, the second key)
// sees only its queue and its own answers, never the B/L number a supplier submitted.

const MAX_BODY_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Role = "lead" | "sourcing" | "negotiator" | "view" | "inspector" | "supplier";
interface Caller {
  role: Role;
  supplier?: string;
}
interface Ctx {
  caller: Caller;
  id: string;
  body: unknown;
}
interface Route {
  method: "GET" | "POST";
  pattern: RegExp;
  roles: Role[];
  handle: (ctx: Ctx) => Promise<unknown>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const SupplierBody = z.object({ supplier: Address }).strict();
const AddressBody = z.object({ address: Address }).strict();
const MessageBody = z.object({ supplier: Address, text: z.unknown() }).strict();
const TextBody = z.object({ text: z.unknown() }).strict();

function statusOf(e: unknown): [number, string, string] {
  if (e instanceof HttpError) return [e.status, e.code, e.message];
  if (e instanceof ZodError) return [400, "bad_request", e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")];
  if (e instanceof SourcingRefused) return [400, "refused", e.message];
  if (e instanceof NotInvited || e instanceof SourcingNotFound || e instanceof InspectionNotFound) return [404, "not_found", "no such resource"];
  if (e instanceof SupplierOut) return [403, "supplier_out", e.message];
  if (e instanceof SourcingClosed || e instanceof InspectionClosed) return [409, "closed", e.message];
  if (
    e instanceof QuoteConflict ||
    e instanceof AttestationConflict ||
    e instanceof InviteConflict ||
    e instanceof SourcingConflict ||
    e instanceof DealConflict ||
    e instanceof DealTransitionConflict ||
    e instanceof DeliverableConflict ||
    e instanceof TransitionConflict ||
    e instanceof TransitionError
  ) {
    return [409, "conflict", e.message];
  }
  return [500, "internal_error", "internal error"];
}

export function createApiServer(
  deps: SourcingDeps,
  config: { tokens: ApiTokens; supplierTokens: Record<string, string>; inspectorName?: string },
  opts: { log?: (line: string) => void } = {},
): http.Server {
  // Tokens are compared as SHA-256 digests with timingSafeEqual: equal length, constant time.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const known: { d: Buffer; caller: Caller }[] = [
    ...(Object.entries(config.tokens) as [Exclude<Role, "supplier">, string][]).map(([role, t]) => ({ d: digest(t), caller: { role } })),
    ...Object.entries(config.supplierTokens).map(([supplier, t]) => ({ d: digest(t), caller: { role: "supplier" as const, supplier } })),
  ];
  function authenticate(header: string | undefined): Caller | null {
    const m = /^Bearer (\S+)$/.exec(header ?? "");
    if (!m?.[1]) return null;
    const d = digest(m[1]);
    let found: Caller | null = null;
    for (const k of known) if (timingSafeEqual(d, k.d)) found = k.caller;
    return found;
  }
  const supplierOf = (c: Caller) => {
    if (!c.supplier) throw new HttpError(403, "forbidden", "a supplier token is required");
    return c.supplier;
  };

  const routes: Route[] = [
    { method: "POST", pattern: /^\/sourcing$/, roles: ["lead"], handle: ({ body }) => openSourcing(deps, body) },
    {
      method: "GET",
      pattern: /^\/sourcing\/([^/]+)$/,
      roles: ["lead", "view", "sourcing", "negotiator"],
      handle: ({ caller, id }) => (caller.role === "lead" || caller.role === "view" ? leadView(deps, id) : negotiatorView(deps, id)),
    },
    {
      method: "GET",
      pattern: /^\/suppliers$/,
      roles: ["lead", "sourcing"],
      handle: async () => {
        const approved = (await deps.signer.health()).testUsd?.approvedSuppliers ?? [];
        return Promise.all(
          approved.map(async (address) => ({ address, name: deps.directory(address) ?? address, onHold: await supplierOnHold(deps, address) })),
        );
      },
    },
    {
      method: "POST",
      pattern: /^\/sourcing\/([^/]+)\/invites$/,
      roles: ["sourcing"],
      handle: ({ id, body }) => inviteSupplier(deps, id, AddressBody.parse(body).address),
    },
    { method: "POST", pattern: /^\/sourcing\/([^/]+)\/suggestions$/, roles: ["sourcing"], handle: ({ id, body }) => suggestSupplier(deps, id, body) },
    { method: "GET", pattern: /^\/sourcing\/([^/]+)\/inbox$/, roles: ["negotiator"], handle: ({ id }) => negotiatorInbox(deps, id) },
    {
      method: "POST",
      pattern: /^\/sourcing\/([^/]+)\/messages$/,
      roles: ["negotiator"],
      handle: ({ id, body }) => {
        const b = MessageBody.parse(body);
        return postNegotiatorMessage(deps, id, b.supplier, b.text);
      },
    },
    { method: "POST", pattern: /^\/sourcing\/([^/]+)\/reports$/, roles: ["negotiator"], handle: ({ id, body }) => reportOffer(deps, id, body) },
    {
      method: "POST",
      pattern: /^\/sourcing\/([^/]+)\/select$/,
      roles: ["lead"],
      handle: ({ id, body }) => selectSupplier(deps, id, SupplierBody.parse(body).supplier),
    },
    { method: "POST", pattern: /^\/deals\/([^/]+)\/decision$/, roles: ["lead"], handle: ({ id, body }) => leadDecision(deps, id, body, "lead") },
    {
      method: "GET",
      pattern: /^\/deals\/([^/]+)$/,
      roles: ["lead", "view"],
      handle: async ({ id }) => {
        const deal = await deps.repo.getDeal(id);
        if (!deal) throw new HttpError(404, "not_found", "no such resource");
        const job = deal.jobId ? await deps.repo.getJob(deal.jobId) : null;
        return {
          deal,
          events: await deps.repo.listDealEvents(deal.id),
          job: job && { id: job.id, ref: job.ref, state: job.state, amount: job.amount, sellerAddress: job.sellerAddress },
          decision: job ? await deps.repo.latestDecision(job.id) : null,
          inspection: await inspectionOf(deps, deal.id),
        };
      },
    },
    { method: "GET", pattern: /^\/operator\/quarantine$/, roles: ["view"], handle: () => deps.repo.listQuarantined(50) },
    { method: "GET", pattern: /^\/inspector\/deals$/, roles: ["inspector"], handle: () => inspectorQueue(deps) },
    {
      method: "POST",
      pattern: /^\/inspector\/deals\/([^/]+)\/attestation$/,
      roles: ["inspector"],
      handle: ({ id, body }) => attest(deps, id, body, config.inspectorName ?? "Port inspector (demo)"),
    },
    {
      method: "GET",
      pattern: /^\/supplier\/sourcing$/,
      roles: ["supplier"],
      handle: async ({ caller }) => {
        const invites = await deps.repo.listInvitesFor(supplierOf(caller));
        const out = [];
        for (const i of invites) {
          const s = await deps.repo.getSourcing(i.sourcingId);
          if (!s) continue;
          out.push({
            sourcingId: s.id,
            ref: s.ref,
            state: s.state,
            goods: s.brief.goods.description,
            quantity: s.brief.goods.quantity,
            incoterm: s.brief.incoterm,
            port: s.brief.port,
            negotiationEndsAt: s.negotiationEndsAt,
            committed: i.quote !== null,
            dealId: i.dealId,
          });
        }
        return out;
      },
    },
    {
      method: "GET",
      pattern: /^\/supplier\/sourcing\/([^/]+)\/thread$/,
      roles: ["supplier"],
      handle: ({ caller, id }) => supplierThread(deps, id, supplierOf(caller)),
    },
    {
      method: "POST",
      pattern: /^\/supplier\/sourcing\/([^/]+)\/messages$/,
      roles: ["supplier"],
      handle: ({ caller, id, body }) => postSupplierMessage(deps, id, supplierOf(caller), TextBody.parse(body).text),
    },
    {
      method: "POST",
      pattern: /^\/supplier\/sourcing\/([^/]+)\/quote$/,
      roles: ["supplier"],
      handle: ({ caller, id, body }) => commitQuote(deps, id, supplierOf(caller), body),
    },
    {
      method: "GET",
      pattern: /^\/supplier\/deals$/,
      roles: ["supplier"],
      handle: async ({ caller }) => {
        const out = [];
        for (const i of await deps.repo.listInvitesFor(supplierOf(caller))) {
          if (!i.dealId) continue;
          const deal = await deps.repo.getDeal(i.dealId);
          if (!deal) continue;
          const job = deal.jobId ? await deps.repo.getJob(deal.jobId) : null;
          out.push({ dealId: deal.id, ref: deal.ref, sourcingId: i.sourcingId, state: deal.state, jobState: job?.state ?? null });
        }
        return out;
      },
    },
    {
      method: "GET",
      pattern: /^\/supplier\/deals\/([^/]+)\/settlement$/,
      roles: ["supplier"],
      handle: ({ caller, id }) => settlementDraftFor(deps, id, supplierOf(caller)),
    },
    {
      method: "POST",
      pattern: /^\/supplier\/deals\/([^/]+)\/settlement$/,
      roles: ["supplier"],
      handle: async ({ caller, id, body }) => {
        const job = await submitSettlement(deps, id, supplierOf(caller), body);
        return { id: job.id, state: job.state, deliverableHash: job.deliverableHash };
      },
    },
  ];

  return http.createServer((req, res) => {
    const method = req.method ?? "GET";
    let path = "/";
    try {
      path = new URL(req.url ?? "/", "http://api.local").pathname;
    } catch {
      path = "";
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    const reply = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      opts.log?.(`${new Date().toISOString()} ${method} ${path} ${status}`);
    };
    const fail = (status: number, error: string, message: string) => reply(status, { error, message });

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on("end", async () => {
      if (!path) return fail(400, "bad_request", "invalid request target");
      if (method === "GET" && path === "/health") return reply(200, { ok: true });
      if (tooLarge) return fail(400, "bad_request", "request body exceeds 16 KB");
      const caller = authenticate(req.headers.authorization);
      if (!caller) return fail(401, "unauthenticated", "missing or invalid bearer token");

      let match: { route: Route; id: string } | null = null;
      for (const route of routes) {
        const m = route.method === method ? route.pattern.exec(path) : null;
        if (m) {
          match = { route, id: m[1] ?? "" };
          break;
        }
      }
      if (!match) return fail(404, "not_found", "no such resource");
      if (!match.route.roles.includes(caller.role)) return fail(403, "forbidden", "this token may not use this route");
      if (match.id && !UUID.test(match.id)) return fail(404, "not_found", "no such resource");

      let body: unknown;
      if (method === "POST") {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return fail(400, "bad_request", "body is not valid JSON");
        }
      }
      try {
        reply(200, await match.route.handle({ caller, id: match.id, body }));
      } catch (e) {
        const [status, code, message] = statusOf(e);
        if (status === 500) opts.log?.(`${new Date().toISOString()} ${method} ${path} unexpected ${(e as Error)?.name ?? "error"}`);
        fail(status, code, message);
      }
    });
  });
}
