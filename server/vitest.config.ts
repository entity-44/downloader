import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Tests share one SQLite file per worker; run files sequentially for determinism.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
