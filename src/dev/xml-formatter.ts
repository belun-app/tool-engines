/**
 * Pretty-prints, minifies and checks the well-formedness of XML with a small tokenizer
 * (declarations, doctypes, comments, CDATA sections, elements and text).
 */

export interface XmlFormatResult {
  formatted: string | null;
  error: string | null;
  isValid: boolean;
}

type TokenType =
  | "declaration"
  | "doctype"
  | "comment"
  | "cdata"
  | "open"
  | "close"
  | "selfclose"
  | "text";

interface Token {
  type: TokenType;
  value: string;
  name: string;
}

/** Find the index of the `>` that closes a tag, ignoring `>` inside quoted attribute values. */
function findTagEnd(input: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

function tagName(raw: string): string {
  const match = raw.match(/^<\/?\s*([^\s/>]+)/);
  return match ? match[1] : "";
}

/** Collapse runs of whitespace outside quotes to a single space so attributes line up cleanly. */
function normalizeTag(raw: string): string {
  let out = "";
  let quote: string | null = null;
  let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      prevSpace = false;
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
      prevSpace = false;
    } else if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      if (!prevSpace) {
        out += " ";
        prevSpace = true;
      }
    } else {
      out += c;
      prevSpace = false;
    }
  }
  return out
    .replace(/^<\s+/, "<")
    .replace(/\s+>$/, ">")
    .replace(/\s+\/>$/, "/>");
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    if (input[i] === "<") {
      if (input.startsWith("<!--", i)) {
        const end = input.indexOf("-->", i);
        const stop = end === -1 ? n : end + 3;
        tokens.push({ type: "comment", value: input.slice(i, stop), name: "" });
        i = stop;
      } else if (input.startsWith("<![CDATA[", i)) {
        const end = input.indexOf("]]>", i);
        const stop = end === -1 ? n : end + 3;
        tokens.push({ type: "cdata", value: input.slice(i, stop), name: "" });
        i = stop;
      } else if (input.startsWith("<?", i)) {
        const end = input.indexOf("?>", i);
        const stop = end === -1 ? n : end + 2;
        tokens.push({ type: "declaration", value: input.slice(i, stop), name: "" });
        i = stop;
      } else if (input.startsWith("<!", i)) {
        const end = findTagEnd(input, i);
        const stop = end === -1 ? n : end + 1;
        tokens.push({ type: "doctype", value: input.slice(i, stop), name: "" });
        i = stop;
      } else {
        const end = findTagEnd(input, i);
        if (end === -1) {
          tokens.push({ type: "text", value: input.slice(i), name: "" });
          i = n;
        } else {
          const raw = input.slice(i, end + 1);
          const name = tagName(raw);
          let type: TokenType;
          if (raw.startsWith("</")) type = "close";
          else if (raw.endsWith("/>")) type = "selfclose";
          else type = "open";
          tokens.push({ type, value: raw, name });
          i = end + 1;
        }
      }
    } else {
      const next = input.indexOf("<", i);
      const stop = next === -1 ? n : next;
      tokens.push({ type: "text", value: input.slice(i, stop), name: "" });
      i = stop;
    }
  }

  return tokens;
}

function unclosedError(stack: string[]): string {
  const names = [...stack].reverse().join(">, <");
  return `Unclosed tag${stack.length > 1 ? "s" : ""}: <${names}>`;
}

export function formatXML(input: string, indentSize = 2): XmlFormatResult {
  if (!input.trim()) {
    return { formatted: "", error: null, isValid: false };
  }

  const tokens = tokenize(input);
  const unit = " ".repeat(Math.max(0, indentSize));
  const lines: string[] = [];
  const stack: string[] = [];
  let depth = 0;

  const pad = (d: number) => unit.repeat(Math.max(0, d));

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.type === "text") {
      const text = tok.value.trim();
      if (text) lines.push(pad(depth) + text);
      i++;
      continue;
    }

    if (tok.type === "comment" || tok.type === "cdata") {
      lines.push(pad(depth) + tok.value);
      i++;
      continue;
    }

    if (tok.type === "open") {
      const next = tokens[i + 1];
      const after = tokens[i + 2];
      // Keep <tag>text</tag> on a single line.
      if (
        next?.type === "text" &&
        after?.type === "close" &&
        after.name === tok.name &&
        !next.value.includes("<")
      ) {
        lines.push(
          pad(depth) + normalizeTag(tok.value) + next.value.trim() + normalizeTag(after.value),
        );
        i += 3;
        continue;
      }
      // Keep empty <tag></tag> on a single line.
      if (next?.type === "close" && next.name === tok.name) {
        lines.push(pad(depth) + normalizeTag(tok.value) + normalizeTag(next.value));
        i += 2;
        continue;
      }
      lines.push(pad(depth) + normalizeTag(tok.value));
      stack.push(tok.name);
      depth++;
      i++;
      continue;
    }

    if (tok.type === "close") {
      const expected = stack.pop();
      if (expected === undefined) {
        return { formatted: null, error: `Unexpected closing tag </${tok.name}>`, isValid: false };
      }
      if (expected !== tok.name) {
        return {
          formatted: null,
          error: `Mismatched tag: expected </${expected}> but found </${tok.name}>`,
          isValid: false,
        };
      }
      depth = Math.max(0, depth - 1);
      lines.push(pad(depth) + normalizeTag(tok.value));
      i++;
      continue;
    }

    // declaration, doctype, selfclose
    lines.push(pad(depth) + normalizeTag(tok.value));
    i++;
  }

  if (stack.length > 0) {
    return { formatted: null, error: unclosedError(stack), isValid: false };
  }

  return { formatted: lines.join("\n"), error: null, isValid: true };
}

export function minifyXML(input: string): XmlFormatResult {
  if (!input.trim()) {
    return { formatted: "", error: null, isValid: false };
  }

  const tokens = tokenize(input);
  const stack: string[] = [];
  const parts: string[] = [];

  for (const tok of tokens) {
    if (tok.type === "text") {
      // Whitespace-only text between tags is indentation and goes. Real text keeps a single
      // space at its edges: in mixed content ("Hello <b>world</b>") that space is part of
      // the document's text.
      if (tok.value.trim()) parts.push(tok.value.replace(/^\s+/, " ").replace(/\s+$/, " "));
      continue;
    }
    if (tok.type === "comment" || tok.type === "cdata") {
      parts.push(tok.value);
      continue;
    }
    if (tok.type === "open") {
      stack.push(tok.name);
    } else if (tok.type === "close") {
      const expected = stack.pop();
      if (expected === undefined) {
        return { formatted: null, error: `Unexpected closing tag </${tok.name}>`, isValid: false };
      }
      if (expected !== tok.name) {
        return {
          formatted: null,
          error: `Mismatched tag: expected </${expected}> but found </${tok.name}>`,
          isValid: false,
        };
      }
    }
    parts.push(normalizeTag(tok.value));
  }

  if (stack.length > 0) {
    return { formatted: null, error: unclosedError(stack), isValid: false };
  }

  return { formatted: parts.join("").trim(), error: null, isValid: true };
}

export function validateXML(input: string): { isValid: boolean; error: string | null } {
  if (!input.trim()) return { isValid: false, error: null };
  const result = formatXML(input);
  return { isValid: result.isValid, error: result.error };
}
