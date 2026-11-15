/**
 * Pretty-prints and minifies HTML with a small tokenizer that keeps the contents of pre,
 * textarea, script and style as written and warns about unclosed and stray tags.
 */

export interface HtmlFormatResult {
  formatted: string;
  warnings: string[];
}

type TokenType = "declaration" | "comment" | "open" | "close" | "selfclose" | "text";

interface Token {
  type: TokenType;
  value: string;
  /** Lowercased tag name for open/close/selfclose tokens. */
  name: string;
}

// Elements that never have a closing tag.
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Elements whose inner content is text, not markup, and must be left untouched.
const RAW = new Set(["script", "style", "pre", "textarea"]);

// Elements whose closing tag is commonly omitted in valid HTML.
const OPTIONAL_CLOSE = new Set([
  "li",
  "dt",
  "dd",
  "p",
  "option",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
  "tfoot",
  "colgroup",
  "caption",
  "html",
  "head",
  "body",
]);

// Opening one of these implicitly closes an open sibling on the stack.
const IMPLIED_CLOSERS: Record<string, string[]> = {
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  p: ["p"],
  option: ["option"],
  tr: ["tr"],
  td: ["td", "th"],
  th: ["td", "th"],
  thead: ["thead", "tbody", "tfoot"],
  tbody: ["thead", "tbody", "tfoot"],
  tfoot: ["thead", "tbody", "tfoot"],
};

/** Find the `>` that closes a tag, ignoring `>` inside quoted attribute values. */
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
  return match ? match[1].toLowerCase() : "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collapse runs of whitespace outside quotes to a single space. */
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
      } else if (input.startsWith("<!", i) || input.startsWith("<?", i)) {
        const end = findTagEnd(input, i);
        const stop = end === -1 ? n : end + 1;
        tokens.push({ type: "declaration", value: input.slice(i, stop), name: "" });
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

          // Raw-text elements: capture everything up to the matching close verbatim.
          if (type === "open" && RAW.has(name)) {
            const rest = input.slice(i);
            const match = rest.match(new RegExp(`</${escapeRegExp(name)}\\s*>`, "i"));
            if (match?.index !== undefined) {
              const content = rest.slice(0, match.index);
              if (content) tokens.push({ type: "text", value: content, name: "" });
              tokens.push({ type: "close", value: match[0], name });
              i += match.index + match[0].length;
            } else {
              if (rest) tokens.push({ type: "text", value: rest, name: "" });
              i = n;
            }
          }
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

// Phrasing (inline) elements. A line break between two of them, or between one of them and
// text, is rendered as a space, so the formatter keeps such runs on one line.
const INLINE = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

interface InlineRun {
  /** The run on one line: tags normalised, whitespace in text collapsed to one space. */
  text: string;
  /** Index of the first token after the run. */
  end: number;
  /** Inline elements opened in the run and not closed in it, outermost first. */
  unclosed: string[];
}

/**
 * The run of text and inline elements starting at `start`, when it has more than one token
 * and some non-blank text; otherwise null (the caller formats token by token).
 */
function inlineRun(tokens: Token[], start: number): InlineRun | null {
  const open: string[] = [];
  let hasText = false;
  let j = start;
  for (; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === "text") {
      if (t.value.trim()) hasText = true;
    } else if ((t.type === "open" || t.type === "selfclose") && INLINE.has(t.name)) {
      if (t.type === "open" && !VOID.has(t.name)) open.push(t.name);
    } else if (t.type === "close" && INLINE.has(t.name) && open.at(-1) === t.name) {
      open.pop();
    } else {
      break;
    }
  }
  if (!hasText || j - start < 2) return null;
  let text = "";
  for (let k = start; k < j; k++) {
    const t = tokens[k];
    text += t.type === "text" ? t.value.replace(/\s+/g, " ") : normalizeTag(t.value);
  }
  return { text: text.trim(), end: j, unclosed: open };
}

/**
 * Indent HTML one element per line. Text and inline elements that touch each other
 * (`Hello <b>world</b>!`) stay on one line, so no whitespace is added between them; runs of
 * whitespace inside such a line are collapsed to one space. `pre`, `textarea`, `script` and
 * `style` content is kept verbatim.
 */
export function formatHTML(input: string, indentSize = 2): HtmlFormatResult {
  if (typeof input !== "string" || !input.trim()) return { formatted: "", warnings: [] };

  const tokens = tokenize(input);
  const unit = " ".repeat(Math.max(0, indentSize));
  const pad = (d: number) => unit.repeat(Math.max(0, d));
  const lines: string[] = [];
  const stack: string[] = [];
  const warnings: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];

    if (
      tok.type === "text" ||
      ((tok.type === "open" || tok.type === "selfclose") && INLINE.has(tok.name))
    ) {
      const run = inlineRun(tokens, i);
      if (run) {
        if (run.text) lines.push(pad(stack.length) + run.text);
        stack.push(...run.unclosed);
        i = run.end;
        continue;
      }
    }

    if (tok.type === "text") {
      const text = tok.value.trim();
      if (text) lines.push(pad(stack.length) + text);
      i++;
      continue;
    }

    if (tok.type === "comment") {
      lines.push(pad(stack.length) + tok.value);
      i++;
      continue;
    }

    if (tok.type === "declaration" || tok.type === "selfclose") {
      lines.push(pad(stack.length) + normalizeTag(tok.value));
      i++;
      continue;
    }

    if (tok.type === "open") {
      const name = tok.name;

      // Raw-text element: preserve its content exactly.
      if (RAW.has(name)) {
        const openStr = normalizeTag(tok.value);
        let j = i + 1;
        let content = "";
        if (tokens[j]?.type === "text") {
          content = tokens[j].value;
          j++;
        }
        const closeStr = tokens[j]?.type === "close" ? normalizeTag(tokens[j].value) : `</${name}>`;
        if (tokens[j]?.type === "close") j++;

        if (name === "pre" || name === "textarea") {
          // Whitespace is significant — keep the whole block verbatim.
          lines.push(pad(stack.length) + openStr + content + closeStr);
        } else if (content.trim() === "") {
          lines.push(pad(stack.length) + openStr + closeStr);
        } else {
          lines.push(pad(stack.length) + openStr);
          lines.push(content.replace(/^\n+|\s+$/g, ""));
          lines.push(pad(stack.length) + closeStr);
        }
        i = j;
        continue;
      }

      // A new sibling can implicitly close an open element (li, tr, option, ...).
      const closers = IMPLIED_CLOSERS[name];
      if (closers) {
        while (stack.length > 0 && closers.includes(stack[stack.length - 1])) {
          stack.pop();
        }
      }

      if (VOID.has(name)) {
        lines.push(pad(stack.length) + normalizeTag(tok.value));
        i++;
        continue;
      }

      const next = tokens[i + 1];
      const after = tokens[i + 2];
      // Keep <tag>text</tag> on one line.
      if (
        next?.type === "text" &&
        after?.type === "close" &&
        after.name === name &&
        !next.value.includes("<")
      ) {
        lines.push(
          pad(stack.length) +
            normalizeTag(tok.value) +
            next.value.trim() +
            normalizeTag(after.value),
        );
        i += 3;
        continue;
      }
      // Keep empty <tag></tag> on one line.
      if (next?.type === "close" && next.name === name) {
        lines.push(pad(stack.length) + normalizeTag(tok.value) + normalizeTag(next.value));
        i += 2;
        continue;
      }

      lines.push(pad(stack.length) + normalizeTag(tok.value));
      stack.push(name);
      i++;
      continue;
    }

    // close
    const name = tok.name;
    if (VOID.has(name)) {
      warnings.push(`Ignored stray closing tag </${name}>`);
      i++;
      continue;
    }
    const idx = stack.lastIndexOf(name);
    if (idx === -1) {
      warnings.push(`Stray closing tag </${name}> with no matching opener`);
      i++;
      continue;
    }
    // Elements left open inside it are closed implicitly; that is only legal for
    // optional-close tags (<p>, <li>, …), so warn about the rest.
    const implicit = stack.slice(idx + 1).filter((t) => !OPTIONAL_CLOSE.has(t));
    if (implicit.length > 0) {
      const names = [...implicit].reverse().join(">, <");
      warnings.push(`Unclosed tag${implicit.length > 1 ? "s" : ""}: <${names}>`);
    }
    while (stack.length > idx) stack.pop();
    lines.push(pad(stack.length) + normalizeTag(tok.value));
    i++;
  }

  const leftover = stack.filter((t) => !OPTIONAL_CLOSE.has(t));
  if (leftover.length > 0) {
    const names = [...leftover].reverse().join(">, <");
    warnings.push(`Unclosed tag${leftover.length > 1 ? "s" : ""}: <${names}>`);
  }

  return { formatted: lines.join("\n"), warnings };
}

export function minifyHTML(input: string): HtmlFormatResult {
  if (typeof input !== "string" || !input.trim()) return { formatted: "", warnings: [] };

  const tokens = tokenize(input);
  const parts: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.type === "open" && RAW.has(tok.name)) {
      parts.push(normalizeTag(tok.value));
      let j = i + 1;
      if (tokens[j]?.type === "text") {
        parts.push(tokens[j].value);
        j++;
      }
      if (tokens[j]?.type === "close") {
        parts.push(normalizeTag(tokens[j].value));
        j++;
      }
      i = j;
      continue;
    }

    if (tok.type === "text") {
      parts.push(tok.value.replace(/\s+/g, " "));
      i++;
      continue;
    }

    if (tok.type === "comment") {
      parts.push(tok.value);
      i++;
      continue;
    }

    parts.push(normalizeTag(tok.value));
    i++;
  }

  return { formatted: parts.join("").trim(), warnings: [] };
}
