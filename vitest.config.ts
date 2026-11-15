import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    pool: "threads",
    maxWorkers: 2,
    // The engines are pure, so test files can share a worker. Mocks, stubbed globals and
    // env vars are restored automatically; tests that use fake timers restore real ones.
    isolate: false,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    watch: false,
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text-summary", "json-summary", "html"],
    },
  },
});
