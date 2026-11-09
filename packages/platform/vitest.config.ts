import { defineConfig } from "vitest/config";

// Each test file boots its own in-process Postgres, which takes a few seconds under parallel load.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
