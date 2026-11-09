import { describe, expect, it } from "vitest";
import { shorten, stripReasoning } from "../src/index";

describe("shorten", () => {
  it("leaves text within the limit alone", () => {
    expect(shorten("short page", 100)).toBe("short page");
  });

  it("keeps the head and the tail of a long output and says how much is gone", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `- row ${i}`);
    const text = lines.join("\n");
    const out = shorten(text, 3000);

    expect(out.length).toBeLessThanOrEqual(3100);
    expect(out.startsWith("- row 0\n")).toBe(true);
    expect(out.endsWith("- row 1999")).toBe(true);
    const omitted = Number(/\[\.\.\. (\d+) characters omitted \.\.\.\]/.exec(out)![1]);
    const kept = out.replace(/\n?\[\.\.\. \d+ characters omitted \.\.\.\]\n?/, "\n");
    expect(kept.length + omitted).toBe(text.length);
  });

  it("keeps most of the budget for the tail", () => {
    const text = "H".repeat(10_000) + "T".repeat(10_000);
    const out = shorten(text, 4000);
    const tail = out.split("characters omitted ...]\n")[1]!;
    expect(tail.length).toBeGreaterThan(2500);
  });

  it("cuts at line breaks so no line is half shown", () => {
    const text = Array.from({ length: 500 }, (_, i) => `line-${i}-${"y".repeat(i % 37)}`).join("\n");
    const original = new Set(text.split("\n"));
    const out = shorten(text, 2000);
    for (const line of out.split("\n")) {
      if (/characters omitted/.test(line)) continue;
      expect(original.has(line)).toBe(true);
    }
  });

  it("still shortens a single enormous line", () => {
    const out = shorten("z".repeat(100_000), 1000);
    expect(out.length).toBeLessThanOrEqual(1100);
  });
});

describe("stripReasoning", () => {
  it("drops think blocks and trims", () => {
    expect(stripReasoning("<think>\nhmm\n</think>\n\nBought it.")).toBe("Bought it.");
    expect(stripReasoning("Plain answer")).toBe("Plain answer");
    expect(stripReasoning(null)).toBe("");
  });

  it("drops an unterminated think block", () => {
    expect(stripReasoning("<think>still thinking")).toBe("");
  });
});
