import { defineConfig } from "vitest/config";

// The publish tests boot an in-process Postgres, which takes a few seconds under parallel load.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
