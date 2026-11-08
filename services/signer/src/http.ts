import http from "node:http";
import { SIG_HEADER, TS_HEADER, verifyRequest } from "@surety/contracts";
import type { SignerConfig } from "./config";
import { SignerError } from "./errors";
import type { Signer } from "./signer";

const MAX_BODY_BYTES = 16 * 1024;

// The signer's only door. Four routes, all HMAC-authenticated. No route accepts a raw transaction.
export function createHttpServer(
  signer: Signer,
  config: Pick<SignerConfig, "hmacSecret">,
  opts: { log?: (line: string) => void } = {},
): http.Server {
  const routes: Record<string, (body: unknown) => Promise<unknown>> = {
    "GET /health": () => signer.health(),
    "POST /escrows/create": (b) => signer.createEscrow(b),
    "POST /escrows/finish": (b) => signer.finishEscrow(b),
    "POST /escrows/cancel": (b) => signer.cancelEscrow(b),
  };

  return http.createServer((req, res) => {
    const method = req.method ?? "GET";
    let path: string;
    try {
      path = new URL(req.url ?? "/", "http://signer.local").pathname;
    } catch {
      // Node accepts some targets the URL parser rejects; never let one take the signer down.
      req.resume();
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_request", message: "invalid request target" }));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    const reply = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      opts.log?.(`${new Date().toISOString()} ${method} ${path} ${status}`);
    };
    const fail = (status: number, error: string, message: string) => reply(status, { error, message });

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });

    req.on("end", async () => {
      if (tooLarge) return fail(400, "bad_request", "request body exceeds 16 KB");
      const body = Buffer.concat(chunks).toString("utf8");
      const ts = req.headers[TS_HEADER];
      const sig = req.headers[SIG_HEADER];
      const authentic = verifyRequest(
        config.hmacSecret,
        typeof ts === "string" ? ts : undefined,
        typeof sig === "string" ? sig : undefined,
        method,
        path,
        body,
        Date.now(),
      );
      if (!authentic) return fail(401, "unauthenticated", "missing or invalid request signature");

      const handler = routes[`${method} ${path}`];
      if (!handler) return fail(404, "not_found", "no such operation");

      let parsed: unknown;
      if (method === "POST") {
        try {
          parsed = JSON.parse(body);
        } catch {
          return fail(400, "bad_request", "body is not valid JSON");
        }
      }

      try {
        reply(200, await handler(parsed));
      } catch (e) {
        if (e instanceof SignerError) return fail(e.status, e.code, e.message);
        opts.log?.(`${new Date().toISOString()} ${method} ${path} unexpected ${(e as Error)?.name ?? "error"}`);
        return fail(500, "internal_error", "internal error");
      }
    });
  });
}
