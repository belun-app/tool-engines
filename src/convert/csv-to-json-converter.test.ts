import { describe, expect, it } from "vitest";
import { csvToJson, detectDelimiter } from "./csv-to-json-converter.js";

const parse = (csv: string, opts = {}) => JSON.parse(csvToJson(csv, opts).json);

describe("detectDelimiter", () => {
  it("picks the most frequent candidate on the first non-empty line", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("\n\na;b;c")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter("a|b|c")).toBe("|");
  });

  it("defaults to comma when there is no candidate", () => {
    expect(detectDelimiter("single")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });
});

describe("csvToJson", () => {
  it("returns the empty result for blank input", () => {
    expect(csvToJson("  \n ")).toEqual({
      json: "",
      rows: 0,
      columns: 0,
      delimiter: ",",
      error: "",
    });
  });

  it("maps header rows to objects with typed values", () => {
    const r = csvToJson("name,age,active\nAnn,30,true\nBob,4.5,false");
    expect(r.rows).toBe(2);
    expect(r.columns).toBe(3);
    expect(r.delimiter).toBe(",");
    expect(JSON.parse(r.json)).toEqual([
      { name: "Ann", age: 30, active: true },
      { name: "Bob", age: 4.5, active: false },
    ]);
  });

  it("keeps leading-zero codes, signs and odd numbers as strings", () => {
    expect(parse("code\n007\n+5\n1e3\n.5\n-0.25\n0")).toEqual([
      { code: "007" },
      { code: "+5" },
      { code: "1e3" },
      { code: ".5" },
      { code: -0.25 },
      { code: 0 },
    ]);
  });

  it("keeps everything as text when typed is off", () => {
    expect(parse("a,b\n1,true", { typed: false })).toEqual([{ a: "1", b: "true" }]);
  });

  it("handles RFC 4180 quoting: delimiters, escaped quotes and newlines in cells", () => {
    expect(parse('a,b\n"x, y","say ""hi""\nthere"')).toEqual([{ a: "x, y", b: 'say "hi"\nthere' }]);
  });

  it("accepts CRLF and lone CR line endings and drops blank lines", () => {
    expect(parse("a,b\r\n1,2\r\n\r\n3,4\r5,6\n\n")).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
      { a: 5, b: 6 },
    ]);
  });

  it("fills missing cells with empty strings", () => {
    expect(parse("a,b,c\n1")).toEqual([{ a: 1, b: "", c: "" }]);
  });

  it("returns arrays of rows without a header and counts the widest row", () => {
    const r = csvToJson("1,2\n3,4,5", { header: false });
    expect(r.rows).toBe(2);
    expect(r.columns).toBe(3);
    expect(JSON.parse(r.json)).toEqual([
      [1, 2],
      [3, 4, 5],
    ]);
  });

  it("honours a forced delimiter and Cyrillic headers", () => {
    expect(parse("имя;город\nАня;Минск", { delimiter: ";" })).toEqual([
      { имя: "Аня", город: "Минск" },
    ]);
  });

  it("auto-detects tab-separated input", () => {
    const r = csvToJson("a\tb\n1\t2");
    expect(r.delimiter).toBe("\t");
    expect(JSON.parse(r.json)).toEqual([{ a: 1, b: 2 }]);
  });

  it("pretty-prints by default and compacts on request", () => {
    expect(csvToJson("a\n1").json).toBe('[\n  {\n    "a": 1\n  }\n]');
    expect(csvToJson("a\n1", { pretty: false }).json).toBe('[{"a":1}]');
  });

  it("returns zero rows for a header-only file", () => {
    const r = csvToJson("a,b\n");
    expect(r.rows).toBe(0);
    expect(r.columns).toBe(2);
    expect(r.json).toBe("[]");
  });

  it("does not mangle long numeric IDs", () => {
    expect(csvToJson("id\n12345678901234567890").json).toContain("12345678901234567890");
  });

  it("keeps a __proto__ column as an ordinary key", () => {
    const r = csvToJson("__proto__,constructor,a\nx,y,1", { pretty: false });
    expect(r.json).toBe('[{"__proto__":"x","constructor":"y","a":1}]');
    expect(r.columns).toBe(3);
    expect(({} as { x?: unknown }).x).toBeUndefined();
  });
});
