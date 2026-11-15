/**
 * Client-side SQL formatter and minifier.
 *
 * A small hand-written tokenizer splits SQL into words, strings, comments, numbers,
 * operators, and punctuation, then a printer lays those tokens out in a block-indent
 * style (top-level clauses on their own line, arguments indented beneath). Nothing here
 * parses a full grammar — it works purely on token shape, which is why it stays dialect
 * tolerant: MySQL back-ticks, SQL Server [brackets], and PostgreSQL casts all pass through
 * untouched.
 */

export type SqlDialect = "standard" | "mysql" | "postgresql" | "sqlserver";
export type KeywordCase = "upper" | "lower" | "preserve";

export interface SqlFormatOptions {
  dialect?: SqlDialect;
  /** Indentation string per level. Defaults to two spaces. */
  indent?: string;
  keywordCase?: KeywordCase;
  /** Remove comments when minifying. Ignored by formatSql. */
  removeComments?: boolean;
}

export interface SqlResult {
  output: string;
  lines: number;
  characters: number;
  keywords: number;
  valid: boolean;
  error?: string;
}

type TokenType =
  | "word"
  | "number"
  | "string"
  | "ident" // quoted identifier: "x", `x`, [x]
  | "op"
  | "punct"
  | "comment-line"
  | "comment-block"
  | "param";

interface Token {
  type: TokenType;
  text: string;
  /** Uppercase canonical form for keyword matching (word tokens only). */
  canon: string;
  keyword: boolean;
}

/* ------------------------------------------------------------------ *
 * Keyword tables
 * ------------------------------------------------------------------ */

// Clauses that begin a new logical line at the current indent, with their
// arguments printed one level deeper.
const TOP_LEVEL = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "HAVING",
  "ORDER BY",
  "LIMIT",
  "OFFSET",
  "VALUES",
  "SET",
  "RETURNING",
  "UNION",
  "UNION ALL",
  "EXCEPT",
  "INTERSECT",
  "MINUS",
  "INSERT INTO",
  "UPDATE",
  "DELETE FROM",
  "WITH",
  "INTO",
]);

// Words that start a new line at the argument indent without deepening it.
const NEWLINE_KW = new Set([
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "CROSS JOIN",
  "LEFT OUTER JOIN",
  "RIGHT OUTER JOIN",
  "FULL OUTER JOIN",
  "AND",
  "OR",
]);

// Two- and three-word phrases collapsed into a single keyword token before printing.
const PHRASES = [
  "LEFT OUTER JOIN",
  "RIGHT OUTER JOIN",
  "FULL OUTER JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "CROSS JOIN",
  "UNION ALL",
  "GROUP BY",
  "ORDER BY",
  "PARTITION BY",
  "INSERT INTO",
  "DELETE FROM",
];

// General keyword vocabulary used only for letter-casing. Includes the phrase
// words so their standalone forms are also cased.
const KEYWORDS = new Set([
  ...TOP_LEVEL,
  ...NEWLINE_KW,
  "ALL",
  "ALTER",
  "AS",
  "ASC",
  "BEGIN",
  "BETWEEN",
  "BY",
  "CASE",
  "CAST",
  "COLUMN",
  "COMMIT",
  "CONSTRAINT",
  "CREATE",
  "CROSS",
  "CURRENT",
  "DATABASE",
  "DEFAULT",
  "DELETE",
  "DESC",
  "DISTINCT",
  "DROP",
  "ELSE",
  "END",
  "EXISTS",
  "FALSE",
  "FETCH",
  "FOR",
  "FOREIGN",
  "FULL",
  "FUNCTION",
  "GRANT",
  "GROUP",
  "IF",
  "ILIKE",
  "IN",
  "INDEX",
  "INNER",
  "INSERT",
  "INTO",
  "IS",
  "JOIN",
  "KEY",
  "LEFT",
  "LIKE",
  "NATURAL",
  "NOT",
  "NULL",
  "NULLS",
  "ON",
  "ORDER",
  "OUTER",
  "OVER",
  "PARTITION",
  "PRIMARY",
  "PROCEDURE",
  "REFERENCES",
  "REPLACE",
  "RIGHT",
  "ROLLBACK",
  "SELECT",
  "TABLE",
  "THEN",
  "TRUE",
  "UNION",
  "UNIQUE",
  "USING",
  "VALUES",
  "VIEW",
  "WHEN",
  "WHERE",
  "WINDOW",
  "AS",
]);

/* ------------------------------------------------------------------ *
 * Tokenizer
 * ------------------------------------------------------------------ */

const OP_CHARS = new Set("+-*/%=<>!|&^~:".split(""));
const PUNCT = new Set([",", ";", "(", ")", ".", "[", "]"]);

function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
}

// Letters of any script: Cyrillic (and other non-ASCII) identifiers are valid in
// PostgreSQL, MySQL and SQL Server and must stay one token.
function isWordStart(c: string): boolean {
  return /[\p{L}_]/u.test(c);
}

function isWordPart(c: string): boolean {
  return /[\p{L}\p{M}\p{N}_$]/u.test(c);
}

interface TokenizeResult {
  tokens: Token[];
  error?: string;
}

function tokenize(sql: string, dialect: SqlDialect): TokenizeResult {
  const tokens: Token[] = [];
  const n = sql.length;
  let i = 0;
  let error: string | undefined;

  const push = (type: TokenType, text: string) => {
    const canon = type === "word" ? text.toUpperCase() : "";
    tokens.push({ type, text, canon, keyword: false });
  };

  while (i < n) {
    const c = sql[i];

    if (isSpace(c)) {
      i++;
      continue;
    }

    // Line comments: -- always, and # for MySQL.
    if ((c === "-" && sql[i + 1] === "-") || (c === "#" && dialect === "mysql")) {
      let j = i;
      while (j < n && sql[j] !== "\n") j++;
      push("comment-line", sql.slice(i, j).trimEnd());
      i = j;
      continue;
    }

    // Block comments.
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) {
        error = "Unterminated block comment.";
        push("comment-block", sql.slice(i));
        break;
      }
      push("comment-block", sql.slice(i, end + 2));
      i = end + 2;
      continue;
    }

    // Single-quoted string with the '' escape. A backslash escapes only in MySQL and in
    // PostgreSQL E'...' strings; standard SQL, ordinary PostgreSQL strings
    // (standard_conforming_strings) and SQL Server read it literally, so 'C:\' is complete.
    if (c === "'") {
      const backslashEscapes =
        dialect === "mysql" ||
        (dialect === "postgresql" &&
          /^[eE]$/.test(sql[i - 1] ?? "") &&
          !isWordPart(sql[i - 2] ?? ""));
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === "\\" && backslashEscapes) {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (!closed) error = "Unterminated string literal.";
      push("string", sql.slice(i, j));
      i = j;
      continue;
    }

    // Double-quoted identifier (or string in some dialects — treated as identifier).
    if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (!closed) error = "Unterminated quoted identifier.";
      push("ident", sql.slice(i, j));
      i = j;
      continue;
    }

    // MySQL back-tick identifier.
    if (c === "`") {
      let j = i + 1;
      while (j < n && sql[j] !== "`") j++;
      j++;
      push("ident", sql.slice(i, Math.min(j, n)));
      i = Math.min(j, n);
      continue;
    }

    // SQL Server bracket identifier.
    if (c === "[" && dialect === "sqlserver") {
      const end = sql.indexOf("]", i + 1);
      const j = end === -1 ? n : end + 1;
      push("ident", sql.slice(i, j));
      i = j;
      continue;
    }

    // Placeholders / bind parameters.
    if (c === "?" || (c === "$" && /[0-9]/.test(sql[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9]/.test(sql[j])) j++;
      push("param", sql.slice(i, j));
      i = j;
      continue;
    }
    if ((c === ":" || c === "@") && isWordStart(sql[i + 1] ?? "")) {
      let j = i + 1;
      while (j < n && isWordPart(sql[j])) j++;
      push("param", sql.slice(i, j));
      i = j;
      continue;
    }

    // Numbers (including decimals, hex, and scientific notation).
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      let j = i;
      if (c === "0" && (sql[i + 1] === "x" || sql[i + 1] === "X")) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F]/.test(sql[j])) j++;
      } else {
        while (j < n && /[0-9.]/.test(sql[j])) j++;
        if (sql[j] === "e" || sql[j] === "E") {
          j++;
          if (sql[j] === "+" || sql[j] === "-") j++;
          while (j < n && /[0-9]/.test(sql[j])) j++;
        }
      }
      push("number", sql.slice(i, j));
      i = j;
      continue;
    }

    // Words (keywords and identifiers).
    if (isWordStart(c)) {
      let j = i + 1;
      while (j < n && isWordPart(sql[j])) j++;
      push("word", sql.slice(i, j));
      i = j;
      continue;
    }

    // Punctuation.
    if (PUNCT.has(c)) {
      push("punct", c);
      i++;
      continue;
    }

    // Operators — greedily grab a run of operator characters.
    if (OP_CHARS.has(c)) {
      let j = i + 1;
      while (j < n && OP_CHARS.has(sql[j])) j++;
      push("op", sql.slice(i, j));
      i = j;
      continue;
    }

    // Anything else (e.g. a stray colon or currency sign) — keep it verbatim.
    push("op", c);
    i++;
  }

  return { tokens, error };
}

/* ------------------------------------------------------------------ *
 * Post-processing: keyword flags + phrase merging
 * ------------------------------------------------------------------ */

function mergePhrases(tokens: Token[]): Token[] {
  // Flag single-word keywords first.
  for (const t of tokens) {
    if (t.type === "word" && KEYWORDS.has(t.canon)) t.keyword = true;
  }

  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    const c = tokens[i + 2];
    if (a.type === "word" && b?.type === "word" && c?.type === "word") {
      const three = `${a.canon} ${b.canon} ${c.canon}`;
      if (PHRASES.includes(three)) {
        out.push({
          type: "word",
          text: `${a.text} ${b.text} ${c.text}`,
          canon: three,
          keyword: true,
        });
        i += 2;
        continue;
      }
    }
    if (a.type === "word" && b?.type === "word") {
      const two = `${a.canon} ${b.canon}`;
      if (PHRASES.includes(two)) {
        out.push({ type: "word", text: `${a.text} ${b.text}`, canon: two, keyword: true });
        i++;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

function applyCase(tok: Token, kc: KeywordCase): string {
  if (!tok.keyword || kc === "preserve") return tok.text;
  return kc === "lower" ? tok.canon.toLowerCase() : tok.canon;
}

/* ------------------------------------------------------------------ *
 * Printer
 * ------------------------------------------------------------------ */

const NO_SPACE_BEFORE = new Set([",", ";", ")", ".", "]"]);
const NO_SPACE_AFTER = new Set(["(", ".", "["]);

interface Frame {
  base: number;
  line: number;
}

/** Spaces and tabs removed from the end, in one pass from the end. */
function trimSpacesEnd(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) end--;
  return end === text.length ? text : text.slice(0, end);
}

function formatTokens(tokens: Token[], indent: string, kc: KeywordCase): string {
  // Finished lines plus the line being written. Trimming and appending touch only the
  // current line, so the output is built in linear time however many lines it has.
  const lines: string[] = [];
  let out = "";
  let lineStart = true;
  let base = 0; // indent of top-level clause keywords in the current (sub)query
  let line = 0; // indent used for argument lines in the current clause
  let inlineParen = 0; // depth of function-call / grouping parens
  const stack: Frame[] = []; // saved state for block (subquery) parens

  let prev: Token | null = null;
  let pendingBreak = false; // force a newline before the next visible token
  let pendingIndent = 0;

  const newline = (indentLevel: number) => {
    lines.push(trimSpacesEnd(out));
    out = indent.repeat(Math.max(0, indentLevel));
    lineStart = true;
  };

  const write = (text: string, spaceBefore: boolean) => {
    if (!lineStart && spaceBefore) out += " ";
    out += text;
    lineStart = false;
  };

  const nextVisible = (from: number): Token | null => {
    for (let k = from; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type !== "comment-line" && t.type !== "comment-block") return t;
    }
    return null;
  };

  const spaceBetween = (a: Token | null, b: Token): boolean => {
    if (!a) return false;
    // PostgreSQL cast operator hugs its operands: value::type, not value :: type.
    if (a.text === "::" || b.text === "::") return false;
    if (NO_SPACE_BEFORE.has(b.text)) return false;
    if (NO_SPACE_AFTER.has(a.text)) return false;
    // Function call: identifier immediately followed by "(".
    if (b.text === "(" && (a.type === "word" || a.type === "ident") && !a.keyword) return false;
    return true;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // Comments ride along at the current position, then force a break after a
    // line comment so following SQL does not get swallowed.
    if (tok.type === "comment-line") {
      write(tok.text, !lineStart);
      pendingBreak = true;
      pendingIndent = line;
      prev = tok;
      continue;
    }
    if (tok.type === "comment-block") {
      if (pendingBreak) {
        newline(pendingIndent);
        pendingBreak = false;
      }
      write(tok.text, spaceBetween(prev, tok));
      prev = tok;
      continue;
    }

    const canon = tok.canon;
    const clauseLevel = inlineParen === 0;

    // ---- Clause-level layout (only outside inline parens) ----
    if (clauseLevel && tok.keyword && TOP_LEVEL.has(canon)) {
      if (lines.length > 0 || out !== "") newline(base);
      write(applyCase(tok, kc), false);
      line = base + 1;
      pendingBreak = true;
      pendingIndent = line;
      prev = tok;
      continue;
    }

    if (clauseLevel && tok.keyword && NEWLINE_KW.has(canon)) {
      newline(line);
      write(applyCase(tok, kc), false);
      pendingBreak = false;
      prev = tok;
      continue;
    }

    // ---- Parentheses ----
    if (tok.type === "punct" && tok.text === "(") {
      const openInline = !(clauseLevel && nextVisible(i + 1)?.canon === "SELECT");
      if (pendingBreak) {
        newline(pendingIndent);
        pendingBreak = false;
      }
      write("(", spaceBetween(prev, tok));
      if (openInline) {
        inlineParen++;
      } else {
        stack.push({ base, line });
        base = line + 1;
        line = base;
        pendingBreak = true;
        pendingIndent = base;
      }
      prev = tok;
      continue;
    }

    if (tok.type === "punct" && tok.text === ")") {
      if (inlineParen > 0) {
        inlineParen--;
        write(")", false);
      } else if (stack.length > 0) {
        const f = stack.pop() as Frame;
        base = f.base;
        line = f.line;
        newline(line);
        write(")", false);
        pendingBreak = false;
      } else {
        write(")", false);
      }
      prev = tok;
      continue;
    }

    // ---- Commas ----
    if (tok.type === "punct" && tok.text === ",") {
      write(",", false);
      if (clauseLevel) {
        newline(line);
        pendingBreak = false;
      }
      prev = tok;
      continue;
    }

    // ---- Statement terminator ----
    if (tok.type === "punct" && tok.text === ";") {
      write(";", false);
      base = 0;
      line = 0;
      inlineParen = 0;
      stack.length = 0;
      if (nextVisible(i + 1)) {
        lines.push(out);
        out = "";
        newline(0);
      }
      pendingBreak = false;
      prev = tok;
      continue;
    }

    // ---- Everything else ----
    if (pendingBreak) {
      newline(pendingIndent);
      pendingBreak = false;
    }
    write(applyCase(tok, kc), spaceBetween(prev, tok));
    prev = tok;
  }

  lines.push(out);
  // Trailing blanks at every line end, including inside multi-line comments and strings.
  // The look-behind starts a match only where a run of blanks starts, which keeps a long
  // run in the middle of a line from being rescanned at every position.
  return lines
    .join("\n")
    .replace(/(?<![ \t])[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ *
 * Minifier
 * ------------------------------------------------------------------ */

function minifyTokens(tokens: Token[], kc: KeywordCase, removeComments: boolean): string {
  let out = "";
  let prev: Token | null = null;

  for (const tok of tokens) {
    if (removeComments && (tok.type === "comment-line" || tok.type === "comment-block")) continue;
    // A line comment with comments kept would break single-line output — turn it
    // into a block comment so the minified SQL stays on one line.
    let text = applyCase(tok, kc);
    if (tok.type === "comment-line") text = `/*${tok.text.replace(/^(--|#)/, "").trim()}*/`;

    let space = true;
    if (!prev) space = false;
    else if (prev.text === "::" || tok.text === "::") space = false;
    else if (NO_SPACE_BEFORE.has(tok.text)) space = false;
    else if (NO_SPACE_AFTER.has(prev.text)) space = false;
    else if (
      tok.text === "(" &&
      (prev.type === "word" || prev.type === "ident" || prev.text === ")") &&
      !prev.keyword
    )
      space = false;

    if (space) out += " ";
    out += text;
    prev = tok;
  }

  return out.trim();
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

function balanced(tokens: Token[]): boolean {
  let depth = 0;
  for (const t of tokens) {
    if (t.type === "punct" && t.text === "(") depth++;
    else if (t.type === "punct" && t.text === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function countKeywords(tokens: Token[]): number {
  return tokens.filter((t) => t.keyword).length;
}

function emptyResult(): SqlResult {
  return { output: "", lines: 0, characters: 0, keywords: 0, valid: true };
}

function stats(output: string, tokens: Token[], error?: string): SqlResult {
  return {
    output,
    lines: output === "" ? 0 : output.split("\n").length,
    characters: output.length,
    keywords: countKeywords(tokens),
    valid: !error && balanced(tokens),
    error: error ?? (balanced(tokens) ? undefined : "Unbalanced parentheses."),
  };
}

export function formatSql(sql: string, options: SqlFormatOptions = {}): SqlResult {
  if (!sql || !sql.trim()) return emptyResult();
  const dialect = options.dialect ?? "standard";
  const kc = options.keywordCase ?? "upper";
  const indent = options.indent ?? "  ";

  const { tokens: raw, error } = tokenize(sql, dialect);
  const tokens = mergePhrases(raw);
  const output = formatTokens(tokens, indent, kc);
  return stats(output, tokens, error);
}

export function minifySql(sql: string, options: SqlFormatOptions = {}): SqlResult {
  if (!sql || !sql.trim()) return emptyResult();
  const dialect = options.dialect ?? "standard";
  const kc = options.keywordCase ?? "preserve";
  const removeComments = options.removeComments ?? true;

  const { tokens: raw, error } = tokenize(sql, dialect);
  const tokens = mergePhrases(raw);
  const output = minifyTokens(tokens, kc, removeComments);
  return stats(output, tokens, error);
}
