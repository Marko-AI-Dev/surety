import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
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
