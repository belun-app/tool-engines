import { describe, expect, it } from "vitest";
import {
  type MarkdownTableOptions,
  generateMarkdownTable,
  isColumnAlign,
  parseTable,
} from "./markdown-table-generator.js";

const opts = (over: Partial<MarkdownTableOptions> = {}): MarkdownTableOptions => ({
  rows: [
    ["Name", "Qty", "Price"],
    ["Apple", "3", "1.50"],
    ["Kiwi", "12", "0.2"],
  ],
  aligns: ["left", "center", "right"],
  pretty: true,
  outerPipes: true,
  escapePipes: true,
  ...over,
});

describe("generateMarkdownTable", () => {
  it("builds a pretty, aligned GFM table", () => {
    const r = generateMarkdownTable(
      opts({
        rows: [
          ["Name", "Quant", "Price"],
          ["Apple", "3", "1.50"],
          ["Kiwi", "12", "0.2"],
        ],
      }),
    );
    expect(r.markdown).toBe(
      [
        "| Name  | Quant | Price |",
        "| :---- | :---: | ----: |",
        "| Apple |   3   |  1.50 |",
        "| Kiwi  |  12   |   0.2 |",
      ].join("\n"),
    );
    expect(r).toMatchObject({ rowCount: 3, columnCount: 3, valid: true });
  });

  it("keeps a narrow centered column aligned in pretty mode", () => {
    const lines = generateMarkdownTable(opts()).markdown.split("\n");
    expect(lines[1]).toHaveLength(lines[0].length);
  });

  it("builds a compact table without outer pipes", () => {
    const r = generateMarkdownTable(opts({ pretty: false, outerPipes: false, aligns: [] }));
    expect(r.markdown).toBe("Name|Qty|Price\n---|---|---\nApple|3|1.50\nKiwi|12|0.2");
    expect(generateMarkdownTable(opts({ pretty: false })).markdown.split("\n")[1]).toBe(
      "|:---|:---:|---:|",
    );
  });

  it("pads/truncates rows to the header width and escapes pipes and newlines", () => {
    const r = generateMarkdownTable(
      opts({
        rows: [["A", "B"], ["x|y"], ["1", "2", "extra"], ["line1\nline2", "  sp  "]],
        aligns: [],
        pretty: false,
      }),
    );
    expect(r.markdown.split("\n")).toEqual([
      "|A|B|",
      "|---|---|",
      "|x\\|y||",
      "|1|2|",
      "|line1<br>line2|sp|",
    ]);
  });

  it("leaves pipes alone when escaping is off", () => {
    const r = generateMarkdownTable(
      opts({ rows: [["a|b"]], aligns: [], pretty: false, escapePipes: false }),
    );
    expect(r.markdown.split("\n")[0]).toBe("|a|b|");
  });

  it("measures width in code points (Cyrillic)", () => {
    const r = generateMarkdownTable(opts({ rows: [["Имя"], ["Анна-Мария"]], aligns: [] }));
    expect(r.markdown.split("\n")[0]).toBe("| Имя        |");
    expect(r.markdown.split("\n")[1]).toBe("| ---------- |");
  });

  it("returns the invalid result for no rows or no columns", () => {
    const invalid = { markdown: "", rowCount: 0, columnCount: 0, valid: false };
    expect(generateMarkdownTable(opts({ rows: [] }))).toEqual(invalid);
    expect(generateMarkdownTable(opts({ rows: [[]] }))).toEqual(invalid);
  });
});

describe("parseTable", () => {
  it("reads a Markdown table with alignments and escaped pipes", () => {
    const r = parseTable("| A | B | C |\n|:--|:-:|--:|\n| 1 | x\\|y | 3 |\n| 4 |");
    expect(r.source).toBe("markdown");
    expect(r.aligns).toEqual(["left", "center", "right"]);
    expect(r.rows).toEqual([
      ["A", "B", "C"],
      ["1", "x|y", "3"],
      ["4", "", ""],
    ]);
  });

  it("round-trips generated Markdown", () => {
    const md = generateMarkdownTable(opts()).markdown;
    const r = parseTable(md);
    expect(r.rows).toEqual(opts().rows);
    expect(r.aligns).toEqual(["left", "center", "right"]);
  });

  it("reads CSV with quotes, escaped quotes and embedded commas", () => {
    const r = parseTable('name,quote\n"Smith, J","He said ""hi"""\nA,');
    expect(r.source).toBe("delimited");
    expect(r.rows).toEqual([
      ["name", "quote"],
      ["Smith, J", 'He said "hi"'],
      ["A", ""],
    ]);
    expect(r.aligns).toEqual(["none", "none"]);
  });

  it("reads TSV when most lines contain tabs", () => {
    expect(parseTable("a\tb\r\nc\td").rows).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("treats pipe lines without a delimiter row as CSV", () => {
    expect(parseTable("a|b\nc|d").source).toBe("delimited");
  });

  it("returns empty for blank input", () => {
    expect(parseTable("  \n\n ")).toEqual({ rows: [], aligns: [], source: "empty" });
  });

  it("keeps an empty first cell in TSV", () => {
    expect(parseTable("A\tB\n\tx").rows[1]).toEqual(["", "x"]);
  });
});

describe("isColumnAlign", () => {
  it("guards the alignment values", () => {
    expect(isColumnAlign("center")).toBe(true);
    expect(isColumnAlign("justify")).toBe(false);
  });
});
