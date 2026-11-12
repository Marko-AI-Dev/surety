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
const ID = "[0-9a-fA-F-]{36}";
const OPERATOR_READS = [
  new RegExp(`^/api/sourcing$`),
  new RegExp(`^/api/sourcing/${ID}$`),
  new RegExp(`^/api/sourcing/${ID}/record$`),
  new RegExp(`^/api/deals/${ID}$`),
  new RegExp(`^/api/operator/quarantine$`),
];

export function proxyDecision(req: ProxyRequest): ProxyDecision {
  const path = req.path.split("?")[0] ?? "";
  if (path === "/api/health") return "pass";
  if (path === "/api/supplier" || path.startsWith("/api/supplier/")) return "pass";
  // The inspector's phone carries the inspector's own token, like a supplier's.
  if (path.startsWith("/api/inspector/")) return "pass";
  const local = req.remoteAddress !== undefined && LOOPBACK.has(req.remoteAddress);
  const forwarded = FORWARDED.some((h) => req.headers[h] !== undefined);
  const read = req.method === "GET" && OPERATOR_READS.some((p) => p.test(path));
  // Starting a purchase is the one thing the operator's screen may ask for besides reading.
  const start = req.method === "POST" && path === "/api/demo/start";
  return local && !forwarded && (read || start) ? "inject" : "refuse";
}
