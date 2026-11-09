import { describe, it, expect } from "vitest";

describe("package", () => {
  it("loads", async () => {
    await expect(import("../src/index")).resolves.toBeDefined();
  });
});
