import { afterEach, describe, expect, it } from "vitest";
import { runAgent, type McpConnection } from "../src/index";
import { answer, call, connectFake, fakeShopServer, scriptedModel, tools } from "./helpers";

const open: McpConnection[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

const base = { model: "m", system: "s", task: "t", maxSteps: 20 };

describe("repeated failures", () => {
  it("warns after the second identical failure and stops at the third", async () => {
    const c = await connectFake(fakeShopServer());
    open.push(c);
    const { model, requests } = scriptedModel([
      tools(call("boom", {})),
      tools(call("boom", {})),
      tools(call("boom", {})),
      answer("unreachable"),
    ]);
    const out = await runAgent({ ...base, llm: model, mcp: [c] });
    expect(out.stoppedBy).toBe("repeated_failure");
    expect(out.steps).toHaveLength(3);
    const toolMsgs = requests[2]!.messages.filter((m) => m.role === "tool");
    expect(String(toolMsgs.at(-1)!.content)).toContain("failed 2 times with the same error");
  });

  it("does not count failures separated by a success", async () => {
    const c = await connectFake(fakeShopServer());
    open.push(c);
    const { model } = scriptedModel([
      tools(call("boom", {})),
      tools(call("boom", {})),
      tools(call("search", { query: "mug" })),
      tools(call("boom", {})),
      answer("done"),
    ]);
    const out = await runAgent({ ...base, llm: model, mcp: [c] });
    expect(out.stoppedBy).toBe("answer");
    expect(out.steps).toHaveLength(4);
  });
});
