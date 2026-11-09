// Throwaway spike tool for the Phase 4c Paperclip stage-speed test (docs/research/07-paperclip-test.md).
// A tiny HTTP server a Paperclip agent in WSL calls: GET /ping?nonce=<n>, then POST /pong {"nonce":"<n>"}.
// Every request is logged with an ISO timestamp so the latency from task assignment can be measured.
// No secrets, no ledger, nothing else. Run: pnpm probe:paperclip
import http from "node:http";
import { networkInterfaces } from "node:os";

const PORT = 4299;
const log = (line: string) => console.log(`${new Date().toISOString()}  ${line}`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://probe.local");
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => {
    if (chunks.reduce((n, b) => n + b.length, 0) < 4096) chunks.push(c);
  });
  req.on("end", () => {
    let nonce = url.searchParams.get("nonce") ?? "";
    if (req.method === "POST") {
      try {
        nonce = String((JSON.parse(Buffer.concat(chunks).toString("utf8")) as { nonce?: unknown }).nonce ?? "");
      } catch {
        nonce = "(unreadable body)";
      }
    }
    log(`${req.method} ${url.pathname} nonce=${nonce} from=${req.socket.remoteAddress}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4")
    .map((a) => a?.address);
  log(`probe listening on 0.0.0.0:${PORT}`);
  for (const a of addresses) log(`  try http://${a}:${PORT}/ping?nonce=test`);
});
