import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { Client, StreamableHTTPClientTransport, type Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ToolSpec } from "@counter/negotiate";

/** A tool as an MCP server lists it. */
export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** A tool result flattened to what a chat model can read. */
export interface McpCallResult {
  text: string;
  isError: boolean;
  structured?: unknown;
}

/** One connected MCP server, seen through the tools the agent may use. */
export interface McpConnection {
  readonly name: string;
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** Label used in traces, e.g. "counter" or "browser". */
  name: string;
  /** Tools the agent never sees. */
  exclude?: readonly string[];
  /** Rewrites each text result before the agent sees it. */
  transformText?: (text: string) => string | Promise<string>;
  /** Per tool call, default 120 s. */
  callTimeoutMs?: number;
  /** Runs after the client closes. */
  onClose?: () => Promise<void> | void;
}

interface ContentPart {
  type: string;
  text?: string;
  resource?: { uri?: string; text?: string };
  uri?: string;
}

function contentText(parts: readonly ContentPart[] | undefined): string {
  return (parts ?? [])
    .map((p) => {
      switch (p.type) {
        case "text":
          return p.text ?? "";
        case "image":
          return "[image omitted]";
        case "audio":
          return "[audio omitted]";
        case "resource":
          return p.resource?.text ?? `[resource ${p.resource?.uri ?? ""}]`;
        case "resource_link":
          return `[resource ${p.uri ?? ""}]`;
        default:
          return JSON.stringify(p);
      }
    })
    .join("\n");
}

/** Connects an MCP client over any transport. */
export async function connectMcp(transport: Transport, opts: ConnectOptions): Promise<McpConnection> {
  const client = new Client({ name: "counter-agent", version: "0.1.0" });
  await client.connect(transport);
  const excluded = new Set(opts.exclude ?? []);
  const timeout = opts.callTimeoutMs ?? 120_000;

  return {
    name: opts.name,
    async listTools() {
      const out: McpToolInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        for (const t of page.tools) {
          if (excluded.has(t.name)) continue;
          out.push({
            name: t.name,
            ...(t.title ? { title: t.title } : {}),
            ...(t.description ? { description: t.description } : {}),
            inputSchema: t.inputSchema as Record<string, unknown>,
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
      return out;
    },
    async callTool(name, args) {
      if (excluded.has(name)) return { text: `Tool ${name} is not available.`, isError: true };
      const r = (await client.callTool({ name, arguments: args }, { timeout })) as {
        content?: ContentPart[];
        structuredContent?: unknown;
        isError?: boolean;
        toolResult?: unknown;
      };
      let text = r.content ? contentText(r.content) : JSON.stringify(r.toolResult ?? null);
      if (opts.transformText) text = await opts.transformText(text);
      return {
        text,
        isError: r.isError === true,
        ...(r.structuredContent !== undefined ? { structured: r.structuredContent } : {}),
      };
    },
    async close() {
      try {
        await client.close();
      } finally {
        await opts.onClose?.();
      }
    },
  };
}

/** An MCP tool as an OpenAI-style function the model can call. */
export function toFunctionSpec(tool: McpToolInfo): ToolSpec {
  const { $schema: _schema, ...schema } = (tool.inputSchema ?? {}) as Record<string, unknown>;
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? tool.title ?? tool.name,
      parameters: { ...schema, type: "object", properties: (schema.properties as object | undefined) ?? {} },
    },
  };
}

// ---------------------------------------------------------------------------
// Counter

export interface CounterConnectOptions {
  /** Tools to hide. Default: `negotiate`, so the agent pays list prices. */
  exclude?: readonly string[];
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  callTimeoutMs?: number;
}

/** Connects to Counter's MCP server (`/mcp`) over streamable HTTP. */
export function connectCounter(url: string, opts: CounterConnectOptions = {}): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.headers ? { requestInit: { headers: opts.headers } } : {}),
  });
  return connectMcp(transport, {
    name: "counter",
    exclude: opts.exclude ?? ["negotiate"],
    ...(opts.callTimeoutMs ? { callTimeoutMs: opts.callTimeoutMs } : {}),
  });
}

// ---------------------------------------------------------------------------
// Playwright

/** The browser server the storefront arm uses, pinned so every run sees the same tools. */
export const PLAYWRIGHT_MCP_PACKAGE = "@playwright/mcp@0.0.83";

export interface PlaywrightOptions {
  /** Where the browser writes page snapshots. A temporary directory by default, removed on close. */
  outputDir?: string;
  /** A Playwright storage-state file (cookies, local storage) to start the isolated session with. */
  storageState?: string;
  headless?: boolean;
  extraArgs?: readonly string[];
  /** Tools to hide. Default: screenshots (the agent reads text) and the Node code runner. */
  exclude?: readonly string[];
  /** Overrides how the server is started. */
  command?: string;
  commandArgs?: readonly string[];
  callTimeoutMs?: number;
}

export const PLAYWRIGHT_DEFAULT_EXCLUDE = ["browser_take_screenshot", "browser_run_code_unsafe"] as const;

/**
 * Command-line flags for the Playwright MCP server: a fresh in-memory profile,
 * no tools contributed by the page itself (WebMCP), and text-only responses.
 */
export function playwrightArgs(opts: { outputDir: string; storageState?: string; headless?: boolean; extraArgs?: readonly string[] }): string[] {
  return [
    ...(opts.headless === false ? [] : ["--headless"]),
    "--isolated",
    "--no-webmcp",
    "--image-responses",
    "omit",
    "--output-dir",
    opts.outputDir,
    ...(opts.storageState ? ["--storage-state", opts.storageState] : []),
    ...(opts.extraArgs ?? []),
  ];
}

const SNAPSHOT_LINK = /^- \[Snapshot\]\(([^)\n]+)\)$/gm;

/**
 * Action tools save the page snapshot to a file and return a link to it.
 * The agent cannot open files, so put the snapshot back inline.
 */
export async function inlineSnapshotLinks(text: string, dir: string): Promise<string> {
  const root = resolve(dir);
  const links = [...text.matchAll(SNAPSHOT_LINK)];
  let out = text;
  for (const m of links) {
    const target = resolve(root, m[1]!.replace(/\\/g, "/"));
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    try {
      const yaml = (await readFile(target, "utf8")).replace(/\s+$/, "");
      out = out.replace(m[0], () => "```yaml\n" + yaml + "\n```");
    } catch {
      // Leave the link as it is.
    }
  }
  return out;
}

function playwrightCli(): { command: string; args: string[] } {
  try {
    const req = createRequire(import.meta.url);
    const cli = join(dirname(req.resolve("@playwright/mcp/package.json")), "cli.js");
    return { command: process.execPath, args: [cli] };
  } catch {
    return { command: process.platform === "win32" ? "npx.cmd" : "npx", args: ["-y", PLAYWRIGHT_MCP_PACKAGE] };
  }
}

/** Starts a headless, isolated Playwright MCP browser over stdio. */
export async function connectPlaywright(opts: PlaywrightOptions = {}): Promise<McpConnection> {
  const ownDir = !opts.outputDir;
  const outputDir = opts.outputDir ?? (await mkdtemp(join(tmpdir(), "counter-browser-")));
  const base = opts.command ? { command: opts.command, args: [...(opts.commandArgs ?? [])] } : playwrightCli();
  const transport = new StdioClientTransport({
    command: base.command,
    args: [
      ...base.args,
      ...playwrightArgs({
        outputDir,
        ...(opts.storageState ? { storageState: opts.storageState } : {}),
        ...(opts.headless !== undefined ? { headless: opts.headless } : {}),
        ...(opts.extraArgs ? { extraArgs: opts.extraArgs } : {}),
      }),
    ],
    cwd: outputDir,
    stderr: "ignore",
  });
  return connectMcp(transport, {
    name: "browser",
    exclude: opts.exclude ?? PLAYWRIGHT_DEFAULT_EXCLUDE,
    transformText: (t) => inlineSnapshotLinks(t, outputDir),
    callTimeoutMs: opts.callTimeoutMs ?? 90_000,
    onClose: async () => {
      if (ownDir) await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    },
  });
}
