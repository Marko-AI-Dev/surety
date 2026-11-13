import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // The web app's "@/" (shadcn/ui components), for the tests that import its views.
  resolve: { alias: [{ find: /^@\//, replacement: `${fileURLToPath(new URL("./apps/web/src", import.meta.url))}/` }] },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "services/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    // Database tests need the local Supabase stack; they run with pnpm test:db.
    exclude: [...configDefaults.exclude, "tests/db/**"],
    passWithNoTests: true,
  },
});
