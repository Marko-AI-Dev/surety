import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Database tests run against the local Supabase stack (pnpm db:start).
// Only DATABASE_URL is taken from the root .env; nothing else in that file enters the test process.
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = resolve(import.meta.dirname, ".env");
  return (existsSync(file) && parseEnv(readFileSync(file, "utf8")).DATABASE_URL) || "";
}

export default defineConfig({
  test: {
    include: ["tests/db/**/*.db.test.ts"],
    env: { DATABASE_URL: databaseUrl() },
    // One shared database: files must not interleave.
    fileParallelism: false,
  },
});
