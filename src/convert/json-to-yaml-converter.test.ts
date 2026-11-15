import { describe, expect, it } from "vitest";
import {
  MAX_YAML_DEPTH,
  convertJsonYaml,
  jsonToYaml,
  parseYaml,
} from "./json-to-yaml-converter.js";

describe("jsonToYaml", () => {
  it("renders scalars", () => {
    expect(jsonToYaml(null)).toBe("null");
    expect(jsonToYaml(true)).toBe("true");
    expect(jsonToYaml(42)).toBe("42");
    expect(jsonToYaml(-1.5)).toBe("-1.5");
    expect(jsonToYaml("hello")).toBe("hello");
  });

  it("renders nested mappings and sequences with two-space indents", () => {
    const value = { name: "app", tags: ["a", "b"], db: { host: "x", port: 5432 } };
    expect(jsonToYaml(value)).toBe(
      ["name: app", "tags:", "  - a", "  - b", "db:", "  host: x", "  port: 5432"].join("\n"),
    );
  });

  it("renders arrays of objects and arrays of arrays in compact form", () => {
    expect(jsonToYaml([{ a: 1, b: 2 }, { c: 3 }])).toBe("- a: 1\n  b: 2\n- c: 3");
    expect(jsonToYaml([[1, 2], [3]])).toBe("- - 1\n  - 2\n- - 3");
  });

  it("renders empty collections inline", () => {
    expect(jsonToYaml([])).toBe("[]");
    expect(jsonToYaml({})).toBe("{}");
    expect(jsonToYaml({ a: [], b: {} })).toBe("a: []\nb: {}");
    expect(jsonToYaml([[], {}])).toBe("- []\n- {}");
  });

  it("quotes strings that would change meaning as plain YAML", () => {
    const quoted = [
      "",
      " lead",
      "trail ",
      "true",
      "No",
      "off",
      "~",
      "null",
      "123",
      "1.5",
      "1e3",
      "0x1F",
      "- dash",
      "#hash",
      "a: b",
      "end:",
      "a #c",
      "*ref",
      "line\nbreak",
      "@at",
    ];
    for (const s of quoted) {
      expect(jsonToYaml({ k: s })).toBe(`k: ${JSON.stringify(s)}`);
    }
    // Safe strings stay plain, including Cyrillic and URLs.
    expect(jsonToYaml({ k: "Привет мир" })).toBe("k: Привет мир");
    expect(jsonToYaml({ k: "http://x.com/a" })).toBe("k: http://x.com/a");
  });

  it("quotes keys that are not plain identifiers", () => {
    expect(jsonToYaml({ "a b": 1, "1": 2, ok_key: 3 })).toBe('"1": 2\n"a b": 1\nok_key: 3');
  });

  it("quotes date-like strings", () => {
    expect(jsonToYaml({ d: "2024-01-01" })).toBe('d: "2024-01-01"');
  });
});

describe("parseYaml", () => {
  it("returns null for an empty / comment-only document", () => {
    expect(parseYaml("")).toBeNull();
    expect(parseYaml("# just a comment\n---\n")).toBeNull();
  });

  it("parses scalars by YAML 1.2 core rules", () => {
    expect(parseYaml("~")).toBeNull();
    expect(parseYaml("Null")).toBeNull();
    expect(parseYaml("TRUE")).toBe(true);
    expect(parseYaml("false")).toBe(false);
    expect(parseYaml("-17")).toBe(-17);
    expect(parseYaml("0x1F")).toBe(31);
    expect(parseYaml("0o17")).toBe(15);
    expect(parseYaml("1.5e3")).toBe(1500);
    expect(parseYaml(".5")).toBe(0.5);
    expect(parseYaml("yes")).toBe("yes");
    expect(parseYaml("'it''s'")).toBe("it's");
    expect(parseYaml('"tab\\there"')).toBe("tab\there");
  });

  it("parses nested block mappings and sequences", () => {
    const yaml = [
      "# config",
      "name: app # inline comment",
      "url: http://x.com:8080/a#frag",
      "tags:",
      "  - a",
      "  - b",
      "same_indent:",
      "- x",
      "- y",
      "db:",
      "  host: localhost",
      "  port: 5432",
      "items:",
      "  - id: 1",
      "    ok: true",
      "  - id: 2",
      "empty:",
    ].join("\n");
    expect(parseYaml(yaml)).toEqual({
      name: "app",
      url: "http://x.com:8080/a#frag",
      tags: ["a", "b"],
      same_indent: ["x", "y"],
      db: { host: "localhost", port: 5432 },
      items: [{ id: 1, ok: true }, { id: 2 }],
      empty: null,
    });
  });

  it("parses flow collections, including ones spanning lines", () => {
    expect(parseYaml("a: [1, 'two', {k: v}, ]")).toEqual({ a: [1, "two", { k: "v" }] });
    expect(parseYaml("a: {x: 1,\n  y: [2, 3]}")).toEqual({ a: { x: 1, y: [2, 3] } });
    expect(parseYaml("[]")).toEqual([]);
  });

  it("parses literal and folded block scalars with chomping", () => {
    expect(parseYaml("a: |\n  l1\n  l2\nb: 1")).toEqual({ a: "l1\nl2\n", b: 1 });
    expect(parseYaml("a: |-\n  l1\n  l2")).toEqual({ a: "l1\nl2" });
    expect(parseYaml("a: >\n  one\n  two\n\n  three")).toEqual({ a: "one two\nthree\n" });
  });

  it("parses quoted keys and sequence items that start a mapping", () => {
    expect(parseYaml("\"a b\": 1\n'c': 2")).toEqual({ "a b": 1, c: 2 });
    expect(parseYaml("-\n  k: v")).toEqual([{ k: "v" }]);
  });

  it("throws line-numbered errors for unsupported or broken input", () => {
    expect(() => parseYaml("a: 1\n\tb: 2")).toThrow(/Line 2: tabs/);
    expect(() => parseYaml("a: &x 1")).toThrow(/anchors/);
    expect(() => parseYaml("a: !!str 1")).toThrow(/tags/);
    expect(() => parseYaml("a: [1, 2")).toThrow(/Line 1/);
    expect(() => parseYaml("a: 'open")).toThrow(/unterminated/);
    expect(() => parseYaml("? complex\n: v")).toThrow();
    expect(() => parseYaml("a: 1\n  b: 2")).toThrow(/after the document/);
  });

  it("round-trips JSON through YAML", () => {
    const value = {
      s: "Привет: мир",
      n: [1, -2.5, 0],
      nested: { arr: [{ a: "true" }, [null, "x"]], e: {} },
      quote: 'he said "hi"',
    };
    expect(parseYaml(jsonToYaml(value))).toEqual(value);
  });

  it("keeps trailing newlines with |+", () => {
    expect(parseYaml("a: |+\n  x\n\nb: 1")).toEqual({ a: "x\n\n", b: 1 });
  });
});

describe("convertJsonYaml", () => {
  it("returns the empty result for blank input", () => {
    expect(convertJsonYaml("  ", "json-to-yaml")).toEqual({
      output: "",
      error: "",
      outputLines: 0,
      outputCharacters: 0,
    });
  });

  it("converts JSON to YAML and counts lines and characters", () => {
    const r = convertJsonYaml('{"a":1,"b":[true]}', "json-to-yaml");
    expect(r.output).toBe("a: 1\nb:\n  - true");
    expect(r.outputLines).toBe(3);
    expect(r.outputCharacters).toBe(r.output.length);
  });

  it("converts YAML to pretty JSON", () => {
    expect(convertJsonYaml("a: 1\r\nb: x\r\n", "yaml-to-json").output).toBe(
      '{\n  "a": 1,\n  "b": "x"\n}',
    );
  });

  it("returns errors instead of throwing", () => {
    expect(convertJsonYaml("{bad", "json-to-yaml").error).not.toBe("");
    expect(convertJsonYaml("a: [1", "yaml-to-json").error).toMatch(/Line 1/);
  });
});

describe("hostile input", () => {
  it("keeps __proto__ as an ordinary key instead of changing the prototype", () => {
    const block = parseYaml("__proto__:\n  polluted: yes\na: 1") as Record<string, unknown>;
    expect(Object.getPrototypeOf(block)).toBe(Object.prototype);
    expect(Object.keys(block)).toEqual(["__proto__", "a"]);
    expect((block as { polluted?: unknown }).polluted).toBeUndefined();
    expect(JSON.stringify(block)).toBe('{"__proto__":{"polluted":"yes"},"a":1}');

    const flow = parseYaml('{"__proto__": {x: 1}, constructor: 2}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(flow)).toBe(Object.prototype);
    expect(JSON.stringify(flow)).toBe('{"__proto__":{"x":1},"constructor":2}');
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();

    const r = convertJsonYaml("__proto__:\n  polluted: yes", "yaml-to-json");
    expect(r.output).toBe('{\n  "__proto__": {\n    "polluted": "yes"\n  }\n}');
  });

  it("round-trips a __proto__ key from JSON", () => {
    const yaml = convertJsonYaml('{"__proto__":{"a":1}}', "json-to-yaml").output;
    expect(yaml).toBe("__proto__:\n  a: 1");
    expect(JSON.stringify(parseYaml(yaml))).toBe('{"__proto__":{"a":1}}');
  });

  it("reports an error for nesting beyond MAX_YAML_DEPTH instead of overflowing the stack", () => {
    for (const input of [
      "- ".repeat(10000),
      `${"[".repeat(10000)}${"]".repeat(10000)}`,
      `a: ${"{b: ".repeat(5000)}1${"}".repeat(5000)}`,
    ]) {
      expect(() => parseYaml(input)).toThrow(/nesting deeper than 1000 levels/);
      expect(convertJsonYaml(input, "yaml-to-json").error).toMatch(/nesting deeper than 1000/);
    }
    const deepJson = `${"[".repeat(5000)}1${"]".repeat(5000)}`;
    expect(convertJsonYaml(deepJson, "json-to-yaml").error).toMatch(/nesting deeper than 1000/);
  });

  it("parses nesting up to the limit", () => {
    const depth = MAX_YAML_DEPTH - 1;
    const parsed = parseYaml(`${"[".repeat(depth)}1${"]".repeat(depth)}`);
    let v: unknown = parsed;
    let levels = 0;
    while (Array.isArray(v)) {
      v = v[0];
      levels++;
    }
    expect(levels).toBe(depth);
    expect(v).toBe(1);
  });
});
