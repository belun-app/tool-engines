import { describe, expect, it } from "vitest";
import { formatSql, minifySql } from "./sql-formatter.js";

// Expected layouts follow the engine's documented block-indent style: each top-level
// clause on its own line, its arguments one level deeper, AND/OR/JOIN on new argument lines.

describe("formatSql", () => {
  it("lays out a simple SELECT and uppercases keywords", () => {
    const r = formatSql(
      "select id, name from users where age > 18 and active = 1 order by name limit 10",
    );
    expect(r.output).toBe(
      [
        "SELECT",
        "  id,",
        "  name",
        "FROM",
        "  users",
        "WHERE",
        "  age > 18",
        "  AND active = 1",
        "ORDER BY",
        "  name",
        "LIMIT",
        "  10",
      ].join("\n"),
    );
    expect(r.lines).toBe(12);
    expect(r.characters).toBe(r.output.length);
    // SELECT FROM WHERE AND ORDER BY LIMIT
    expect(r.keywords).toBe(6);
    expect(r.valid).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it("indents subqueries and keeps inline parens on one line", () => {
    expect(formatSql("SELECT * FROM (SELECT id FROM t) AS s WHERE x IN (1, 2)").output).toBe(
      [
        "SELECT",
        "  *",
        "FROM",
        "  (",
        "    SELECT",
        "      id",
        "    FROM",
        "      t",
        "  ) AS s",
        "WHERE",
        "  x IN (1, 2)",
      ].join("\n"),
    );
  });

  it("keeps function calls tight and handles GROUP BY / HAVING", () => {
    expect(
      formatSql("SELECT COUNT(*), MAX(price) FROM items GROUP BY cat HAVING COUNT(*) > 1").output,
    ).toBe(
      "SELECT\n  COUNT(*),\n  MAX(price)\nFROM\n  items\nGROUP BY\n  cat\nHAVING\n  COUNT(*) > 1",
    );
  });

  it("handles UPDATE with parameters and doubled-quote string escapes", () => {
    expect(formatSql("UPDATE t SET a = 1, b = 'it''s' WHERE id = $1").output).toBe(
      "UPDATE\n  t\nSET\n  a = 1,\n  b = 'it''s'\nWHERE\n  id = $1",
    );
  });

  it("keeps PostgreSQL casts tight and line comments in place", () => {
    expect(formatSql("select x::int from t -- note\nwhere y = 1").output).toBe(
      "SELECT\n  x::int\nFROM\n  t -- note\nWHERE\n  y = 1",
    );
  });

  it("separates statements with a blank line", () => {
    expect(formatSql("select 1; select 2").output).toBe("SELECT\n  1;\n\nSELECT\n  2");
  });

  it("supports lower/preserve keyword case and custom indent", () => {
    expect(formatSql("SELECT a FROM t", { keywordCase: "lower" }).output).toBe(
      "select\n  a\nfrom\n  t",
    );
    expect(formatSql("SeLeCt a FROM t", { keywordCase: "preserve", indent: "\t" }).output).toBe(
      "SeLeCt\n\ta\nFROM\n\tt",
    );
  });

  it("passes dialect identifiers through untouched", () => {
    expect(formatSql("SELECT `order` FROM `my table`", { dialect: "mysql" }).output).toBe(
      "SELECT\n  `order`\nFROM\n  `my table`",
    );
    expect(formatSql("SELECT [Order Id] FROM [dbo].[T]", { dialect: "sqlserver" }).output).toBe(
      "SELECT\n  [Order Id]\nFROM\n  [dbo].[T]",
    );
    expect(formatSql('SELECT "Name" FROM t').output).toBe('SELECT\n  "Name"\nFROM\n  t');
  });

  it("reports unbalanced parentheses and unterminated literals without throwing", () => {
    expect(formatSql("SELECT (1 FROM t")).toMatchObject({
      valid: false,
      error: "Unbalanced parentheses.",
    });
    expect(formatSql("SELECT 1) FROM t").valid).toBe(false);
    expect(formatSql("SELECT 'abc FROM t").error).toBe("Unterminated string literal.");
    expect(formatSql('SELECT "abc FROM t').error).toBe("Unterminated quoted identifier.");
    expect(formatSql("SELECT 1 /* open").error).toBe("Unterminated block comment.");
  });

  it("returns an empty, valid result for blank input", () => {
    expect(formatSql("  \n ")).toEqual({
      output: "",
      lines: 0,
      characters: 0,
      keywords: 0,
      valid: true,
    });
  });

  it("keeps Unicode inside string literals", () => {
    expect(formatSql("SELECT a FROM t WHERE city = 'Москва 😀'").output).toBe(
      "SELECT\n  a\nFROM\n  t\nWHERE\n  city = 'Москва 😀'",
    );
  });

  it("keeps non-ASCII (Cyrillic) identifiers intact", () => {
    expect(formatSql("SELECT имя FROM пользователи WHERE город = 'Москва'").output).toBe(
      "SELECT\n  имя\nFROM\n  пользователи\nWHERE\n  город = 'Москва'",
    );
  });

  it("puts LEFT OUTER JOIN on its own line as one phrase", () => {
    expect(formatSql("SELECT a FROM t1 LEFT OUTER JOIN t2 ON t1.id = t2.id").output).toBe(
      "SELECT\n  a\nFROM\n  t1\n  LEFT OUTER JOIN t2 ON t1.id = t2.id",
    );
  });

  it("treats backslash literally in standard SQL strings", () => {
    const r = formatSql("SELECT 'C:\\' AS p FROM t");
    expect(r.valid).toBe(true);
    expect(formatSql("SELECT 'C:\\' AS p FROM t", { dialect: "postgresql" }).valid).toBe(true);
  });

  it("still treats backslash as an escape in MySQL and PostgreSQL E-strings", () => {
    expect(formatSql("SELECT 'it\\'s' FROM t", { dialect: "mysql" }).valid).toBe(true);
    expect(formatSql("SELECT E'it\\'s' FROM t", { dialect: "postgresql" }).valid).toBe(true);
  });
});

describe("minifySql", () => {
  it("collapses whitespace and drops comments by default", () => {
    expect(minifySql("SELECT  a ,\n b -- c\nFROM t /* x */ WHERE f ( 1 )")).toMatchObject({
      output: "SELECT a, b FROM t WHERE f(1)",
      lines: 1,
      valid: true,
    });
  });

  it("keeps comments as block comments when asked, preserving keyword case by default", () => {
    expect(minifySql("select  a -- c\nFROM t", { removeComments: false }).output).toBe(
      "select a /*c*/ FROM t",
    );
    expect(minifySql("select a", { keywordCase: "upper" }).output).toBe("SELECT a");
  });

  it("treats # as a comment only in MySQL", () => {
    expect(minifySql("SELECT 1 # note\nFROM t", { dialect: "mysql" }).output).toBe(
      "SELECT 1 FROM t",
    );
  });

  it("returns an empty, valid result for blank input", () => {
    expect(minifySql("").output).toBe("");
  });
});

describe("formatSql on large input", () => {
  it("lays out tens of thousands of lines in linear time", () => {
    const n = 40_000;
    const r = formatSql(`select ${"a,".repeat(n)} x`);
    expect(r.lines).toBe(n + 2);
    expect(r.output.endsWith("  a,\n  x")).toBe(true);
    expect(formatSql(`select ${",".repeat(n)} x`).lines).toBe(n + 1);
  }, 20_000);

  it("trims trailing blanks without rescanning long runs inside a line", () => {
    const spaces = " ".repeat(40_000);
    expect(formatSql(`select '${spaces}x'  -- c${spaces}`).output).toBe(
      `SELECT\n  '${spaces}x' -- c`,
    );
    expect(formatSql(`select '${spaces}\nx' from t`).output).toBe(`SELECT\n  '\nx'\nFROM\n  t`);
  }, 20_000);
});
