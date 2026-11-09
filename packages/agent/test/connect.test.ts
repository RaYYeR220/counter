import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { connectCounter, inlineSnapshotLinks, playwrightArgs, toFunctionSpec } from "../src/index";

describe("toFunctionSpec", () => {
  it("turns an MCP tool into an OpenAI function without the $schema key", () => {
    const spec = toFunctionSpec({
      name: "browser_click",
      description: "Click an element",
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { target: { type: "string" } },
        required: ["target"],
        additionalProperties: false,
      },
    });
    expect(spec).toEqual({
      type: "function",
      function: {
        name: "browser_click",
        description: "Click an element",
        parameters: {
          type: "object",
          properties: { target: { type: "string" } },
          required: ["target"],
          additionalProperties: false,
        },
      },
    });
  });

  it("fills in an empty object schema and a description", () => {
    const spec = toFunctionSpec({ name: "list_shops", title: "List shops", inputSchema: { type: "object" } });
    expect(spec.function.description).toBe("List shops");
    expect(spec.function.parameters).toEqual({ type: "object", properties: {} });
  });
});

describe("connectCounter", () => {
  function counterLike() {
    const server = new McpServer({ name: "counter", version: "test" });
    for (const name of ["search_products", "create_cart", "negotiate", "list_shops"]) {
      server.registerTool(name, { description: name, inputSchema: z.strictObject({}) }, async () => ({
        content: [{ type: "text", text: `${name} ok` }],
      }));
    }
    return server;
  }

  it("connects over streamable HTTP and leaves negotiate out by default", async () => {
    const handler = createMcpHandler(() => counterLike());
    const fetchFn = ((input: string | URL | Request, init?: RequestInit) =>
      handler.fetch(new Request(input, init))) as typeof fetch;
    const conn = await connectCounter("http://counter.test/mcp", { fetch: fetchFn });
    try {
      const names = (await conn.listTools()).map((t) => t.name).sort();
      expect(names).toEqual(["create_cart", "list_shops", "search_products"]);
      const r = await conn.callTool("search_products", {});
      expect(r).toMatchObject({ text: "search_products ok", isError: false });
    } finally {
      await conn.close();
    }
  });

  it("can hide more tools", async () => {
    const handler = createMcpHandler(() => counterLike());
    const fetchFn = ((input: string | URL | Request, init?: RequestInit) =>
      handler.fetch(new Request(input, init))) as typeof fetch;
    const conn = await connectCounter("http://counter.test/mcp", { fetch: fetchFn, exclude: ["negotiate", "list_shops"] });
    try {
      expect((await conn.listTools()).map((t) => t.name).sort()).toEqual(["create_cart", "search_products"]);
    } finally {
      await conn.close();
    }
  });
});

describe("Playwright helpers", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-pw-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("builds a headless, isolated browser without page-provided tools", () => {
    expect(playwrightArgs({ outputDir: "/tmp/run1" })).toEqual([
      "--headless",
      "--isolated",
      "--no-webmcp",
      "--image-responses",
      "omit",
      "--output-dir",
      "/tmp/run1",
    ]);
    expect(playwrightArgs({ outputDir: "/o", storageState: "/s.json", headless: false, extraArgs: ["--browser", "chrome"] })).toEqual([
      "--isolated",
      "--no-webmcp",
      "--image-responses",
      "omit",
      "--output-dir",
      "/o",
      "--storage-state",
      "/s.json",
      "--browser",
      "chrome",
    ]);
  });

  it("inlines a snapshot the browser wrote to a file", async () => {
    writeFileSync(join(dir, "page-1.yml"), '- button "Add to cart" [ref=e5]\n');
    const text = "### Page\n- Page URL: http://shop.test/\n### Snapshot\n- [Snapshot](page-1.yml)";
    const out = await inlineSnapshotLinks(text, dir);
    expect(out).toBe('### Page\n- Page URL: http://shop.test/\n### Snapshot\n```yaml\n- button "Add to cart" [ref=e5]\n```');
  });

  it("resolves Windows-style relative links", async () => {
    writeFileSync(join(dir, "page-2.yml"), "- heading \"Cart\"");
    const out = await inlineSnapshotLinks("- [Snapshot](.\\page-2.yml)", dir);
    expect(out).toBe('```yaml\n- heading "Cart"\n```');
  });

  it("keeps the link when the file cannot be read", async () => {
    const text = "- [Snapshot](missing.yml)";
    expect(await inlineSnapshotLinks(text, dir)).toBe(text);
  });
});
