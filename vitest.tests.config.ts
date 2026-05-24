import { defineConfig } from "vitest/config";

// Plain Node Vitest. The span-structure tests don't need the Workers
// runtime — exercising the wrap pattern with real OTel + AI SDK in Node
// avoids the vitest-pool-workers / OTel module-resolution conflict and
// still proves the parent/child link.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 10_000,
  },
});
