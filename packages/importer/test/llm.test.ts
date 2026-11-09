import { describe, expect, it } from "vitest";
import { askJson, extractJson } from "../src/llm";
import { scriptedLlm } from "./fakes";

describe("extractJson", () => {
  it("reads plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("reads JSON inside a code fence or surrounding prose", () => {
    expect(extractJson('```json\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('Here you go: {"a": "x}y"} hope that helps')).toEqual({ a: "x}y" });
  });

  it("is undefined when there is no JSON object", () => {
    expect(extractJson("no idea")).toBeUndefined();
    expect(extractJson("{broken")).toBeUndefined();
  });
});

describe("askJson", () => {
  it("sends system and user messages and parses the reply", async () => {
    const { llm, requests } = scriptedLlm(['{"ok":true}']);
    expect(await askJson(llm, { model: "m", system: "S", user: "U" })).toEqual({ ok: true });
    expect(requests[0]).toMatchObject({
      model: "m",
      temperature: 0,
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "U" },
      ],
    });
  });

  it("asks again once when the reply is not JSON", async () => {
    const { llm, requests } = scriptedLlm(["sorry", '{"ok":1}']);
    expect(await askJson(llm, { model: "m", system: "S", user: "U" })).toEqual({ ok: 1 });
    expect(requests).toHaveLength(2);
  });

  it("throws an LlmError after two replies without JSON", async () => {
    const { llm } = scriptedLlm(["no", "still no"]);
    await expect(askJson(llm, { model: "m", system: "S", user: "U" })).rejects.toMatchObject({ name: "LlmError", message: expect.stringMatching(/JSON/) });
  });

  it("attaches an image as a data URI content part", async () => {
    const { llm, requests } = scriptedLlm(['{"name":"mug"}']);
    await askJson(llm, {
      model: "vision",
      system: "S",
      user: "What is this?",
      image: { bytes: new Uint8Array([1, 2, 3]), mime: "image/png" },
    });
    expect(requests[0]!.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      ],
    });
  });
});
