import { describe, expect, it } from "vitest";
import { formatJSON, minifyJSON, validateJSON } from "./json-formatter.js";

describe("formatJSON", () => {
  it("pretty-prints with 2 spaces by default", () => {
    expect(formatJSON('{"a":1,"b":[true,null]}')).toEqual({
      formatted: '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
      error: null,
      isValid: true,
    });
  });

  it("honours a custom indent", () => {
    expect(formatJSON('{"a":1}', 4).formatted).toBe('{\n    "a": 1\n}');
    expect(formatJSON('{"a":1}', 0).formatted).toBe('{"a":1}');
  });

  it("formats scalars and keeps Unicode", () => {
    expect(formatJSON("42").formatted).toBe("42");
    expect(formatJSON('"привет 😀"').formatted).toBe('"привет 😀"');
  });

  it("reports invalid JSON instead of throwing", () => {
    for (const bad of ["", "{", "{'a':1}", "[1,]", "undefined", "{a:1}"]) {
      const r = formatJSON(bad);
      expect(r.isValid).toBe(false);
      expect(r.formatted).toBeNull();
      expect(typeof r.error).toBe("string");
    }
  });
});

describe("minifyJSON", () => {
  it("removes all insignificant whitespace", () => {
    expect(minifyJSON('{\n  "a" : [ 1, 2 ],\n  "b": "x y"\n}').formatted).toBe(
      '{"a":[1,2],"b":"x y"}',
    );
  });

  it("reports invalid JSON", () => {
    expect(minifyJSON("nope").isValid).toBe(false);
  });
});

describe("validateJSON", () => {
  it("validates", () => {
    expect(validateJSON("[]")).toEqual({ isValid: true, error: null });
    expect(validateJSON("[").isValid).toBe(false);
  });
});

describe("data is never changed", () => {
  it("copies number lexemes verbatim", () => {
    const input = '{"big":12345678901234567890,"f":1.0,"huge":1e400,"neg":-0,"e":2.50E-3}';
    expect(minifyJSON(input).formatted).toBe(input);
    expect(formatJSON(input).formatted).toBe(
      '{\n  "big": 12345678901234567890,\n  "f": 1.0,\n  "huge": 1e400,\n  "neg": -0,\n  "e": 2.50E-3\n}',
    );
  });

  it("keeps duplicate keys and their order", () => {
    expect(minifyJSON('{ "b": 1, "a": 2, "b": 3 }').formatted).toBe('{"b":1,"a":2,"b":3}');
    expect(formatJSON('{"a":1,"a":2}').formatted).toBe('{\n  "a": 1,\n  "a": 2\n}');
  });

  it("keeps string escapes as written", () => {
    const input = String.raw`["\u00e9","\/","a\"b","\\",""]`;
    expect(minifyJSON(input).formatted).toBe(input);
    expect(formatJSON(String.raw`[ "\u00e9" ]`).formatted).toBe(String.raw`[
  "\u00e9"
]`);
  });

  it("keeps structural characters inside strings", () => {
    const input = '{"k":"a, b: [c] {d}"}';
    expect(minifyJSON(` ${input} `).formatted).toBe(input);
  });

  it("matches the JSON.stringify layout for ordinary JSON", () => {
    const value = { a: [], b: {}, c: [1, { d: [true, false, null] }], e: "x", f: [[]] };
    const text = JSON.stringify(value);
    for (const indent of [0, 1, 2, 4, 10, 20]) {
      expect(formatJSON(text, indent).formatted).toBe(JSON.stringify(value, null, indent));
    }
    expect(formatJSON(text, "\t").formatted).toBe(JSON.stringify(value, null, "\t"));
  });

  it("accepts every JSON whitespace character between tokens", () => {
    expect(minifyJSON('\t{\r\n "a"\t:\n[ 1 ,\r2 ] }\n').formatted).toBe('{"a":[1,2]}');
  });

  it("handles deep nesting without recursion", () => {
    const nest = (depth: number) => `${"[".repeat(depth)}1${"]".repeat(depth)}`;
    const deep = nest(10000);
    expect(minifyJSON(` ${deep.split("").join(" ")} `).formatted).toBe(deep);
    // Pretty output grows with the square of the depth (indentation), so keep it smaller.
    const input = nest(500);
    const pretty = formatJSON(input).formatted ?? "";
    expect(pretty.split("\n")).toHaveLength(2 * 500 + 1);
    expect(minifyJSON(pretty).formatted).toBe(input);
  });
});
