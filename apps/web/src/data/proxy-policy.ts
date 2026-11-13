// Who may use the dev proxy for what. The proxy holds the operator's read-only view token, which opens
// the buyer's maximum price and every held message. When the dev server is opened to the network so a
// person can play a supplier from a phone, that token must not serve anyone but the operator's own
// browser on this machine. So:
//   - /api/supplier/* and /api/inspector/* are passed through with the caller's own token and never
//     get the view token.
//   - The operator's read routes get the view token only for a GET from this machine itself, and not
//     when the request came through a tunnel or another proxy (those arrive from loopback too, but
//     carry a forwarding header).
//   - Everything else is refused here and never reaches the API.

export type ProxyDecision = "pass" | "inject" | "refuse";

export interface ProxyRequest {
  method: string;
  // The path as the browser sent it, starting with /api.
  path: string;
  remoteAddress: string | undefined;
  headers: Record<string, unknown>;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const FORWARDED = ["x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip", "cf-connecting-ip", "true-client-ip"];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const ID = "[0-9a-fA-F-]{36}";
const OPERATOR_READS = [
  new RegExp(`^/api/sourcing$`),
  new RegExp(`^/api/sourcing/${ID}$`),
  new RegExp(`^/api/sourcing/${ID}/record$`),
  new RegExp(`^/api/deals/${ID}$`),
  new RegExp(`^/api/operator/quarantine$`),
];

const BUYER_ACTIONS: RegExp[] = [
  new RegExp("^/api/demo/start$"),
  new RegExp("^/api/buyer/intake$"),
  new RegExp("^/api/admin/ask$"),
  new RegExp(`^/api/sourcing/${ID}/notes$`),
  new RegExp(`^/api/deals/${ID}/approval$`),
];

export function proxyDecision(req: ProxyRequest): ProxyDecision {
  const path = req.path.split("?")[0] ?? "";
  if (path === "/api/health") return "pass";
  if (path === "/api/supplier" || path.startsWith("/api/supplier/")) return "pass";
  // The inspector's phone carries the inspector's own token, like a supplier's.
  if (path.startsWith("/api/inspector/")) return "pass";
  const local = req.remoteAddress !== undefined && LOOPBACK.has(req.remoteAddress);
  const forwarded = FORWARDED.some((h) => req.headers[h] !== undefined);
  // The operator's screen is opened as localhost on this machine. Any other Host means the request was
  // aimed here under another name (DNS rebinding), so it gets no token.
  const host = String(req.headers.host ?? "");
  const ownHost = LOCAL_HOST.test(host);
  const read = req.method === "GET" && OPERATOR_READS.some((p) => p.test(path));
  // Starting a purchase is the one thing the operator's screen may ask for besides reading. It changes
  // something, so it must also prove it came from this app's own page: another site open in the same
  // browser can post to localhost, but it cannot claim this origin, be same-origin, or send JSON
  // without a preflight.
  const origin = req.headers.origin;
  const fromOwnPage =
    typeof origin === "string" && origin.replace(/^https?:\/\//, "") === host && req.headers["sec-fetch-site"] === "same-origin" && String(req.headers["content-type"] ?? "").startsWith("application/json");
  // The same holds for the buyer's other actions: saying what it needs, a note to its negotiator, the
  // final yes or no on a deal, and a question to the admin assistant. Nothing else may be posted.
  const act = req.method === "POST" && BUYER_ACTIONS.some((p) => p.test(path)) && fromOwnPage;
  return local && !forwarded && ownHost && (read || act) ? "inject" : "refuse";
}
