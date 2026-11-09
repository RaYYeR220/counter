import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv";

describe("parseCsv", () => {
  it("reads a header and rows", () => {
    expect(parseCsv("sku,name,price\nA1,Mug,34\nA2,Bowl,28\n")).toEqual({
      headers: ["sku", "name", "price"],
      rows: [
        ["A1", "Mug", "34"],
        ["A2", "Bowl", "28"],
      ],
    });
  });

  it("keeps commas, doubled quotes and line breaks inside quoted fields", () => {
    const csv = 'name,description,price\n"Mug, speckled","Holds ""12 oz""\nDishwasher safe",34\n';
    expect(parseCsv(csv).rows).toEqual([["Mug, speckled", 'Holds "12 oz"\nDishwasher safe', "34"]]);
  });

  it("handles CRLF, a byte order mark and a missing final newline", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n3,4")).toEqual({
      headers: ["a", "b"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    });
  });

  it("skips blank lines and pads short rows", () => {
    expect(parseCsv("a,b,c\n\n1,2\n").rows).toEqual([["1", "2", ""]]);
  });

  it("detects semicolon and tab delimiters from the header", () => {
    expect(parseCsv("a;b\n1,5;2\n").rows).toEqual([["1,5", "2"]]);
    expect(parseCsv("a\tb\nx y\tz\n").rows).toEqual([["x y", "z"]]);
  });

  it("trims header names", () => {
    expect(parseCsv(" sku , Option1 Value \nA,B").headers).toEqual(["sku", "Option1 Value"]);
  });

  it("throws on an unterminated quote", () => {
    expect(() => parseCsv('a,b\n"open,2\n')).toThrow(/quote/);
  });
});
