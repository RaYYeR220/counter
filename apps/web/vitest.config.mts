import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit and route tests for the web app. Route handlers import "server-only",
// which only resolves inside React Server Components, so tests swap it for a stub.
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
