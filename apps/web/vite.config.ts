import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Replay needs no backend. Live mode goes through this dev proxy: /api is forwarded to the Surety API
// and the read-only view token is added here, on the server side, from the environment. It is never
// sent to the browser and never read from a committed file. A request that already carries its own
// Authorization header (a supplier's token on the supplier seat) is passed through unchanged.
const apiUrl = process.env.SURETY_API_URL ?? "http://127.0.0.1:4200";
const viewToken = process.env.API_TOKEN_VIEW;
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("."),
  base: "./",
  resolve: {
    // The bouncer's code rules run in the browser for practice mode, straight from packages/gate.
    // They use node:crypto (sha256) and Buffer, so both are served by one small shim.
    alias: [{ find: /^node:crypto$/, replacement: here("./src/shims/node-crypto.ts") }],
  },
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
          proxy.on("proxyReq", (proxyReq) => {
            if (!proxyReq.getHeader("authorization") && viewToken) proxyReq.setHeader("authorization", `Bearer ${viewToken}`);
          });
        },
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
