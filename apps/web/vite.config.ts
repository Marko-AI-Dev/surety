import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { proxyDecision } from "./src/data/proxy-policy";

// Replay needs no backend. Live mode goes through this dev proxy: /api is forwarded to the Surety API
// and the read-only view token is added here, on the server side, from the environment. It is never
// sent to the browser and never read from a committed file. Supplier routes pass through with the
// supplier's own token and never receive the view token.
const apiUrl = process.env.SURETY_API_URL ?? "http://127.0.0.1:4200";
const viewToken = process.env.API_TOKEN_VIEW;
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("."),
  base: "./",
  resolve: {
    // The bouncer's code rules run in the browser for practice mode, straight from packages/gate.
    // They use node:crypto (sha256) and Buffer, so both are served by one small shim.
    alias: [
      { find: /^node:crypto$/, replacement: here("./src/shims/node-crypto.ts") },
      // shadcn/ui components import each other through "@/".
      { find: /^@\//, replacement: `${here("./src")}/` },
    ],
  },
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: "automatic" } },
  server: {
    port: 5173,
    fs: { allow: [here("../..")] },
    proxy: {
      "/api": {
        target: apiUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        configure: (proxy) => {
          // See src/data/proxy-policy.ts: the view token serves only this machine's own browser, on
          // the operator's read routes. A phone on the network reaches /api/supplier/* and nothing else.
          proxy.on("proxyReq", (proxyReq, req, res) => {
            const decision = proxyDecision({
              method: req.method ?? "GET",
              // By now the rewrite above has removed the /api prefix from req.url; the policy reads
              // the path as the browser sent it.
              path: `/api${(req.url ?? "").replace(/^\/api(?=\/|$)/, "")}`,
              remoteAddress: req.socket.remoteAddress,
              headers: req.headers,
            });
            if (decision === "inject") {
              // Always replace whatever the browser sent. With no token set, the API answers 401.
              proxyReq.removeHeader("authorization");
              if (viewToken) proxyReq.setHeader("authorization", `Bearer ${viewToken}`);
            } else if (decision === "refuse") {
              proxyReq.destroy();
              if (!res.headersSent) {
                res.writeHead(403, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: "forbidden", message: "the operator's routes are served to this machine only" }));
              }
            }
          });
        },
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
