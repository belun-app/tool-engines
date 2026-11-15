/**
 * Converts JSON to YAML, and a YAML subset back to JSON (block and flow collections, quoted
 * and block scalars, comments; no anchors, aliases, tags or multiple documents).
 */

export type JsonYamlDirection = "json-to-yaml" | "yaml-to-json";

export interface JsonYamlResult {
  output: string;
  error: string;
  outputLines: number;
  outputCharacters: number;
}

const EMPTY_RESULT: JsonYamlResult = {
  output: "",
  error: "",
  outputLines: 0,
  outputCharacters: 0,
};

/** Deepest nesting of sequences and mappings that parseYaml and jsonToYaml accept. */
export const MAX_YAML_DEPTH = 1000;

export function convertJsonYaml(input: string, direction: JsonYamlDirection): JsonYamlResult {
  if (!input.trim()) {
    return { ...EMPTY_RESULT };
  }

  try {
    const output =
      direction === "json-to-yaml"
        ? jsonToYaml(JSON.parse(input))
        : JSON.stringify(parseYaml(input), null, 2);
    return {
      output,
      error: "",
      outputLines: output ? output.split("\n").length : 0,
      outputCharacters: output.length,
    };
  } catch (err) {
    return {
      ...EMPTY_RESULT,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- JSON -> YAML ---

const INDENT = "  ";

export function jsonToYaml(value: unknown): string {
  return renderNode(value, 0).join("\n");
}

function renderNode(value: unknown, level: number): string[] {
  if (level >= MAX_YAML_DEPTH) {
    throw new Error(`nesting deeper than ${MAX_YAML_DEPTH} levels is not supported`);
  }
  const pad = INDENT.repeat(level);

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    const lines: string[] = [];
    for (const item of value) {
      if (isScalar(item) || isEmptyCollection(item)) {
        lines.push(`${pad}- ${renderScalar(item)}`);
      } else {
        const child = renderNode(item, level + 1);
        lines.push(`${pad}- ${child[0].slice(pad.length + INDENT.length)}`, ...child.slice(1));
      }
    }
    return lines;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [`${pad}{}`];
    const lines: string[] = [];
    for (const [key, val] of entries) {
      const renderedKey = plainKeyIsSafe(key) ? key : JSON.stringify(key);
      if (isScalar(val) || isEmptyCollection(val)) {
        lines.push(`${pad}${renderedKey}: ${renderScalar(val)}`);
      } else {
        lines.push(`${pad}${renderedKey}:`, ...renderNode(val, level + 1));
      }
    }
    return lines;
  }

  return [`${pad}${renderScalar(value)}`];
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function isEmptyCollection(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (value !== null && typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function renderScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return "[]";
  if (typeof value === "object") return "{}";
  const s = String(value);
  return plainStringIsSafe(s) ? s : JSON.stringify(s);
}

function plainKeyIsSafe(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key);
}

function hasControlChars(s: string): boolean {
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function plainStringIsSafe(s: string): boolean {
  if (s === "" || /^\s|\s$/.test(s)) return false;
  if (hasControlChars(s)) return false;
  if (/^[-?:,[\]{}#&*!|>%@`"']/.test(s)) return false;
  if (s.includes(": ") || s.endsWith(":") || s.includes(" #")) return false;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return false;
  if (/^[+-]?(\d[\d_]*)?(\.\d*)?([eE][+-]?\d+)?$/.test(s) && /\d/.test(s)) return false;
  if (/^0[xo][0-9a-fA-F]+$/.test(s)) return false;
  // YAML 1.1 timestamps (PyYAML, js-yaml's default schema) would read back as a date.
  if (/^\d{4}-\d{1,2}-\d{1,2}(?:[Tt ]|$)/.test(s)) return false;
  return true;
}

// --- YAML -> JSON (block-style subset: mappings, sequences, scalars, flow collections,
// quoted strings, block scalars, comments; no anchors, aliases, tags, or multi-document) ---

/**
 * Set an own, enumerable property, also for keys such as "__proto__" that a plain
 * assignment would turn into a prototype change.
 */
function setKey(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

class YamlError extends Error {
  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`);
  }
}

export function parseYaml(input: string): unknown {
  const parser = new YamlParser(input.replace(/\r\n?/g, "\n").split("\n"));
  return parser.parseDocument();
}

class YamlParser {
  private pos = 0;
  private lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  parseDocument(): unknown {
    this.skipIgnorable();
    if (this.pos >= this.lines.length) return null;
    const value = this.parseNode(this.indentAt(this.pos));
    this.skipIgnorable();
    if (this.pos < this.lines.length) {
      throw new YamlError("unexpected content after the document ends", this.pos + 1);
    }
    return value;
  }

  private indentAt(pos: number): number {
    const line = this.lines[pos];
    const indent = line.length - line.trimStart().length;
    if (line.slice(0, indent).includes("\t")) {
      throw new YamlError("tabs are not allowed in YAML indentation — use spaces", pos + 1);
    }
    return indent;
  }

  private isIgnorable(pos: number): boolean {
    const trimmed = this.lines[pos].trim();
    return trimmed === "" || trimmed.startsWith("#") || trimmed === "---" || trimmed === "...";
  }

  private skipIgnorable(): void {
    while (this.pos < this.lines.length && this.isIgnorable(this.pos)) {
      this.pos += 1;
    }
  }

  private content(pos: number): string {
    return stripInlineComment(this.lines[pos].trim());
  }

  private depth = 0;

  private parseNode(indent: number): unknown {
    if (this.depth >= MAX_YAML_DEPTH) {
      throw new YamlError(
        `nesting deeper than ${MAX_YAML_DEPTH} levels is not supported`,
        this.pos + 1,
      );
    }
    this.depth += 1;
    try {
      return this.parseNodeAt(indent);
    } finally {
      this.depth -= 1;
    }
  }

  private parseNodeAt(indent: number): unknown {
    const text = this.content(this.pos);
    if (text === "-" || text.startsWith("- ")) {
      return this.parseSequence(indent);
    }
    const colon = findMappingColon(text, this.pos + 1);
    if (colon !== -1) {
      return this.parseMapping(indent);
    }
    const lineNo = this.pos + 1;
    this.pos += 1;
    return this.parseInlineValue(text, lineNo, indent);
  }

  private parseSequence(indent: number): unknown[] {
    const items: unknown[] = [];
    while (this.pos < this.lines.length) {
      this.skipIgnorable();
      if (this.pos >= this.lines.length || this.indentAt(this.pos) !== indent) break;
      const text = this.content(this.pos);
      if (text !== "-" && !text.startsWith("- ")) break;

      if (text === "-") {
        this.pos += 1;
        items.push(this.parseChildBlock(indent + 1, false));
      } else {
        const rest = text.slice(2).trimStart();
        const restCol = indent + (text.length - rest.length);
        this.lines[this.pos] = " ".repeat(restCol) + rest;
        items.push(this.parseNode(restCol));
      }
    }
    return items;
  }

  private parseMapping(indent: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    while (this.pos < this.lines.length) {
      this.skipIgnorable();
      if (this.pos >= this.lines.length || this.indentAt(this.pos) !== indent) break;
      const text = this.content(this.pos);
      if (text === "-" || text.startsWith("- ")) break;
      const lineNo = this.pos + 1;
      const colon = findMappingColon(text, lineNo);
      if (colon === -1) {
        throw new YamlError(`expected "key: value" but got "${truncate(text)}"`, lineNo);
      }

      const key = parseKey(text.slice(0, colon).trim(), lineNo);
      const after = text.slice(colon + 1).trim();
      this.pos += 1;

      if (after === "") {
        setKey(result, key, this.parseChildBlock(indent, true));
      } else if (after.startsWith("|") || after.startsWith(">")) {
        setKey(result, key, this.parseBlockScalar(after, indent, lineNo));
      } else {
        setKey(result, key, this.parseInlineValue(after, lineNo, indent));
      }
    }
    return result;
  }

  private parseChildBlock(parentIndent: number, allowSameIndentSequence: boolean): unknown {
    this.skipIgnorable();
    if (this.pos >= this.lines.length) return null;
    const indent = this.indentAt(this.pos);
    if (indent > parentIndent) {
      return this.parseNode(indent);
    }
    if (allowSameIndentSequence && indent === parentIndent) {
      const text = this.content(this.pos);
      if (text === "-" || text.startsWith("- ")) {
        return this.parseSequence(indent);
      }
    }
    return null;
  }

  private parseBlockScalar(header: string, keyIndent: number, lineNo: number): string {
    const match = /^([|>])([+-]?)(\d*)([+-]?)\s*$/.exec(header);
    if (!match) {
      throw new YamlError(`invalid block scalar header "${truncate(header)}"`, lineNo);
    }
    const folded = match[1] === ">";
    const chomp = match[2] || match[4] || "";

    const raw: string[] = [];
    let blockIndent = -1;
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos];
      if (line.trim() === "") {
        raw.push("");
        this.pos += 1;
        continue;
      }
      const indent = this.indentAt(this.pos);
      if (indent <= keyIndent) break;
      if (blockIndent === -1) blockIndent = indent;
      raw.push(line.slice(Math.min(blockIndent, indent)));
      this.pos += 1;
    }
    let trailingBlank = 0;
    while (raw.length > 0 && raw[raw.length - 1] === "") {
      raw.pop();
      trailingBlank += 1;
    }
    if (raw.length === 0) return chomp === "+" ? "\n".repeat(trailingBlank) : "";

    let body: string;
    if (folded) {
      body = raw
        .map((line, i) => {
          if (line === "") return "\n";
          const sep = i === 0 || raw[i - 1] === "" ? "" : " ";
          return sep + line;
        })
        .join("");
    } else {
      body = raw.join("\n");
    }
    if (chomp === "-") return body;
    // "+" (keep) keeps the trailing blank lines as newlines; the default (clip) keeps one.
    if (chomp === "+") return `${body}\n${"\n".repeat(trailingBlank)}`;
    return `${body}\n`;
  }

  private parseInlineValue(text: string, lineNo: number, indent: number): unknown {
    if (text.startsWith("|") || text.startsWith(">")) {
      return this.parseBlockScalar(text, indent - 1, lineNo);
    }
    if (text.startsWith("[") || text.startsWith("{")) {
      let flowText = text;
      while (!flowIsBalanced(flowText) && this.pos < this.lines.length) {
        if (this.indentAt(this.pos) <= indent && !this.isIgnorable(this.pos)) break;
        flowText += ` ${this.content(this.pos)}`;
        this.pos += 1;
      }
      const flow = new FlowParser(flowText, lineNo);
      return flow.parse();
    }
    return parseScalarToken(text, lineNo);
  }
}

function stripInlineComment(text: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\" && inDouble) {
      i += 1;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === "#" && !inSingle && !inDouble && i > 0 && /\s/.test(text[i - 1])) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}

function findMappingColon(text: string, lineNo: number): number {
  let i = 0;
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0];
    i = 1;
    while (i < text.length) {
      if (quote === '"' && text[i] === "\\") i += 1;
      else if (text[i] === quote) {
        if (quote === "'" && text[i + 1] === "'") i += 1;
        else break;
      }
      i += 1;
    }
    if (i >= text.length) throw new YamlError("unterminated quoted key", lineNo);
    i += 1;
  }
  let depth = 0;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    else if (ch === ":" && depth === 0 && (i === text.length - 1 || /\s/.test(text[i + 1]))) {
      return i;
    }
  }
  return -1;
}

function parseKey(rawKey: string, lineNo: number): string {
  if (rawKey.startsWith('"') || rawKey.startsWith("'")) {
    const value = parseScalarToken(rawKey, lineNo);
    return String(value);
  }
  if (rawKey === "") throw new YamlError("empty mapping key", lineNo);
  if (rawKey.startsWith("?")) {
    throw new YamlError("complex mapping keys are not supported", lineNo);
  }
  return rawKey;
}

function parseScalarToken(text: string, lineNo: number): unknown {
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new YamlError(`invalid double-quoted string ${truncate(text)}`, lineNo);
    }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) {
      throw new YamlError(`unterminated single-quoted string ${truncate(text)}`, lineNo);
    }
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith("&") || text.startsWith("*")) {
    throw new YamlError("anchors and aliases are not supported", lineNo);
  }
  if (text.startsWith("!")) {
    throw new YamlError("tags are not supported", lineNo);
  }

  if (text === "" || text === "~" || /^null$/i.test(text)) return null;
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  if (/^[+-]?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^0x[0-9a-fA-F]+$/.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^0o[0-7]+$/.test(text)) return Number.parseInt(text.slice(2), 8);
  if (/^[+-]?(\.\d+|\d+\.?\d*)([eE][+-]?\d+)?$/.test(text)) return Number.parseFloat(text);
  return text;
}

function flowIsBalanced(text: string): boolean {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\" && inDouble) i += 1;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (!inSingle && !inDouble) {
      if (ch === "[" || ch === "{") depth += 1;
      else if (ch === "]" || ch === "}") depth -= 1;
    }
  }
  return depth <= 0 && !inSingle && !inDouble;
}

class FlowParser {
  private i = 0;
  private text: string;
  private lineNo: number;

  constructor(text: string, lineNo: number) {
    this.text = text;
    this.lineNo = lineNo;
  }

  parse(): unknown {
    const value = this.parseValue();
    this.skipSpaces();
    if (this.i < this.text.length) {
      throw new YamlError(
        `unexpected content after flow collection: "${truncate(this.text.slice(this.i))}"`,
        this.lineNo,
      );
    }
    return value;
  }

  private skipSpaces(): void {
    while (this.i < this.text.length && /\s/.test(this.text[this.i])) this.i += 1;
  }

  private depth = 0;

  private parseValue(): unknown {
    this.skipSpaces();
    const ch = this.text[this.i];
    if (ch === "[" || ch === "{") {
      if (this.depth >= MAX_YAML_DEPTH) {
        throw new YamlError(
          `nesting deeper than ${MAX_YAML_DEPTH} levels is not supported`,
          this.lineNo,
        );
      }
      this.depth += 1;
      try {
        return ch === "[" ? this.parseArray() : this.parseObject();
      } finally {
        this.depth -= 1;
      }
    }
    if (ch === '"' || ch === "'") {
      return parseScalarToken(this.readQuoted(ch), this.lineNo);
    }
    return parseScalarToken(this.readPlain(), this.lineNo);
  }

  private parseArray(): unknown[] {
    this.i += 1;
    const items: unknown[] = [];
    this.skipSpaces();
    if (this.text[this.i] === "]") {
      this.i += 1;
      return items;
    }
    for (;;) {
      items.push(this.parseValue());
      this.skipSpaces();
      const ch = this.text[this.i];
      if (ch === ",") {
        this.i += 1;
        this.skipSpaces();
        if (this.text[this.i] === "]") {
          this.i += 1;
          return items;
        }
      } else if (ch === "]") {
        this.i += 1;
        return items;
      } else {
        throw new YamlError('expected "," or "]" in flow sequence', this.lineNo);
      }
    }
  }

  private parseObject(): Record<string, unknown> {
    this.i += 1;
    const result: Record<string, unknown> = {};
    this.skipSpaces();
    if (this.text[this.i] === "}") {
      this.i += 1;
      return result;
    }
    for (;;) {
      this.skipSpaces();
      const ch = this.text[this.i];
      let key: string;
      if (ch === '"' || ch === "'") {
        key = String(parseScalarToken(this.readQuoted(ch), this.lineNo));
      } else {
        key = this.readPlain(true).trim();
      }
      this.skipSpaces();
      if (this.text[this.i] !== ":") {
        throw new YamlError('expected ":" in flow mapping', this.lineNo);
      }
      this.i += 1;
      setKey(result, key, this.parseValue());
      this.skipSpaces();
      const next = this.text[this.i];
      if (next === ",") {
        this.i += 1;
        this.skipSpaces();
        if (this.text[this.i] === "}") {
          this.i += 1;
          return result;
        }
      } else if (next === "}") {
        this.i += 1;
        return result;
      } else {
        throw new YamlError('expected "," or "}" in flow mapping', this.lineNo);
      }
    }
  }

  private readQuoted(quote: string): string {
    const start = this.i;
    this.i += 1;
    while (this.i < this.text.length) {
      if (quote === '"' && this.text[this.i] === "\\") this.i += 1;
      else if (this.text[this.i] === quote) {
        if (quote === "'" && this.text[this.i + 1] === "'") this.i += 1;
        else {
          this.i += 1;
          return this.text.slice(start, this.i);
        }
      }
      this.i += 1;
    }
    throw new YamlError("unterminated quoted string in flow collection", this.lineNo);
  }

  private readPlain(isKey = false): string {
    const start = this.i;
    const stop = isKey ? ",]}:" : ",]}";
    while (this.i < this.text.length && !stop.includes(this.text[this.i])) {
      this.i += 1;
    }
    return this.text.slice(start, this.i).trim();
  }
}

function truncate(s: string): string {
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
