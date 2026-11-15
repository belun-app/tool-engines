/**
 * Converts HTML to Markdown with a small built-in parser: headings, paragraphs, emphasis,
 * strikethrough, code, links, images, quotes, lists, tables, rules and line breaks.
 */

export interface HtmlToMarkdownResult {
  markdown: string;
  lineCount: number;
  charCount: number;
}

type Node = ElementNode | TextNode;

interface ElementNode {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}

interface TextNode {
  type: "text";
  value: string;
}

const VOID_TAGS = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "area",
  "base",
  "col",
  "embed",
  "source",
  "track",
  "wbr",
]);

// Tags whose entire content is discarded
const IGNORE_TAGS = new Set(["script", "style", "head", "title", "noscript", "svg", "iframe"]);

const INLINE_TAGS = new Set([
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "del",
  "s",
  "strike",
  "code",
  "span",
  "mark",
  "sub",
  "sup",
  "small",
  "font",
  "abbr",
  "cite",
  "q",
  "time",
  "label",
  "ins",
  "var",
  "kbd",
  "samp",
  "br",
  "img",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  laquo: "«",
  raquo: "»",
  deg: "°",
  times: "×",
  divide: "÷",
  euro: "€",
  pound: "£",
  cent: "¢",
  sect: "§",
  para: "¶",
  middot: "·",
  bull: "•",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (full, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
      return full;
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v !== undefined ? v : full;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = re.exec(s)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** A comment, doctype or tag (markup), or a run of text. */
interface Token {
  value: string;
  markup: boolean;
}

/**
 * Split HTML into comment, tag and text tokens in one pass. Every search starts where the
 * previous one ended, and a failed search for ">" or "-->" is remembered, so input such as
 * thousands of unclosed "<" stays linear. A "<" that cannot start a tag ("a < b", or no
 * closing ">") is text, as in an HTML parser.
 */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const n = html.length;
  let noGtFrom = n + 1; // no ">" at or after this index
  let noCommentEndFrom = n + 1; // no "-->" at or after this index
  let text = "";
  let i = 0;
  const pushText = () => {
    if (text) tokens.push({ value: text, markup: false });
    text = "";
  };
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, lt);
    if (html.startsWith("<!--", lt)) {
      const end = lt + 4 >= noCommentEndFrom ? -1 : html.indexOf("-->", lt + 4);
      if (end === -1) noCommentEndFrom = Math.min(noCommentEndFrom, lt + 4);
      pushText();
      // An unclosed comment runs to the end of the input.
      tokens.push({ value: end === -1 ? html.slice(lt) : html.slice(lt, end + 3), markup: true });
      i = end === -1 ? n : end + 3;
      continue;
    }
    const next = html[lt + 1] ?? "";
    const gt = /[a-zA-Z/!?]/.test(next) && lt + 1 < noGtFrom ? html.indexOf(">", lt + 1) : -1;
    if (gt === -1) {
      if (/[a-zA-Z/!?]/.test(next)) noGtFrom = Math.min(noGtFrom, lt + 1);
      text += "<";
      i = lt + 1;
      continue;
    }
    pushText();
    const tag = html.slice(lt, gt + 1);
    tokens.push({ value: tag, markup: true });
    i = gt + 1;
    // Script and style content is raw text up to the matching end tag, even when it
    // holds "<" or ">" ("if (a<b) ...").
    const raw = /^<\s*(script|style)\b/i.exec(tag);
    if (raw && !tag.endsWith("/>")) {
      const end = new RegExp(`</${raw[1]}`, "gi");
      end.lastIndex = i;
      const m = end.exec(html);
      const stop = m ? m.index : n;
      if (stop > i) tokens.push({ value: html.slice(i, stop), markup: false });
      i = stop;
    }
  }
  pushText();
  return tokens;
}

/** URL schemes a link or image may keep; anything else is dropped. */
const SAFE_SCHEMES = /^(?:https?|mailto|tel):/i;

/**
 * A link or image URL as it should appear in Markdown, or null when it is unsafe.
 * Markdown renderers decode entities in destinations and browsers drop control
 * characters, so the check runs on the decoded value without them: only http, https,
 * mailto, tel, relative URLs and #fragments pass, and an undecoded entity before the
 * path ("jav&colon;...") is refused. The URL is written as it was in the HTML, with
 * whitespace, angle brackets and unbalanced parentheses percent-encoded so it cannot
 * end the Markdown destination early.
 */
function safeUrl(raw: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
  const strip = (s: string) => s.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const url = strip(raw);
  if (!url) return null;
  const decoded = strip(decodeEntities(url));
  const head = decoded.split(/[/?#]/, 1)[0];
  if (head.includes(":") && !SAFE_SCHEMES.test(decoded)) return null;
  if (head.includes("&")) return null;
  let depth = 0;
  let balanced = true;
  for (const c of url) {
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) balanced = false;
  }
  if (depth !== 0) balanced = false;
  return url.replace(/[\s<>()]/g, (c) =>
    (c === "(" || c === ")") && balanced
      ? c
      : `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/**
 * Escape decoded text so that it reads as text in Markdown: a "<" that could open an
 * HTML tag or comment, and "](" that would close a link label, are backslash-escaped, as
 * is a backslash before punctuation. Inside a link label or image alt every bracket is
 * escaped.
 */
function escapeText(s: string, inLabel: boolean): string {
  let out = s.replace(/\\(?=[!-/:-@[-`{-~])/g, "\\\\").replace(/<(?=[a-zA-Z/!?])/g, "\\<");
  out = inLabel ? out.replace(/[[\]]/g, "\\$&") : out.replace(/\](?=\()/g, "\\]");
  return out;
}

/** Backtick fence longer than any run of backticks in the text (at least `min`). */
function fence(text: string, min: number): string {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return "`".repeat(Math.max(min, longest + 1));
}

function parseHtml(html: string): Node[] {
  const tokens = tokenize(html);
  const root: ElementNode = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack: ElementNode[] = [root];
  let skipUntil: string | null = null;

  for (const { value: tok, markup } of tokens) {
    if (skipUntil) {
      const close = markup && tok.match(/^<\/\s*([a-zA-Z][a-zA-Z0-9]*)/);
      if (close && close[1].toLowerCase() === skipUntil) skipUntil = null;
      continue;
    }

    const top = stack[stack.length - 1];

    if (!markup) {
      top.children.push({ type: "text", value: tok });
      continue;
    }

    if (tok.startsWith("<!")) continue; // comments, doctype

    if (tok.startsWith("</")) {
      const m = tok.match(/^<\/\s*([a-zA-Z][a-zA-Z0-9]*)/);
      if (!m) continue;
      const name = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    if (tok.startsWith("<")) {
      const m = tok.match(/^<\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/?)>$/);
      if (!m) continue;
      const name = m[1].toLowerCase();
      const selfClose = m[3] === "/" || VOID_TAGS.has(name);
      if (IGNORE_TAGS.has(name)) {
        if (!selfClose) skipUntil = name;
        continue;
      }
      const el: ElementNode = {
        type: "element",
        tag: name,
        attrs: parseAttrs(m[2]),
        children: [],
      };
      top.children.push(el);
      if (!selfClose) stack.push(el);
    }
  }

  return root.children;
}

function rawText(node: ElementNode): string {
  let out = "";
  for (const c of node.children) {
    out += c.type === "text" ? decodeEntities(c.value) : rawText(c);
  }
  return out;
}

function inline(nodes: Node[], inLabel = false): string {
  let out = "";
  for (const n of nodes) {
    let piece =
      n.type === "text"
        ? escapeText(decodeEntities(n.value).replace(/\s+/g, " "), inLabel)
        : inlineEl(n, inLabel);
    // A space moved out of an emphasis element can meet a text node's own space; keep one.
    if (out.endsWith(" ") && piece.startsWith(" ")) {
      piece = piece.slice(1);
    }
    out += piece;
  }
  return out;
}

/**
 * Emphasis markers must hug the text ("**bold**"), but whitespace at the edges of the
 * element still separates words: "<b>bold </b>text" is "**bold** text", not "**bold**text".
 */
function wrapInline(el: ElementNode, marker: string, inLabel: boolean): string {
  const raw = inline(el.children, inLabel);
  const inner = raw.trim();
  if (!inner) return /\s/.test(raw) ? " " : "";
  const lead = /^\s/.test(raw) ? " " : "";
  const trail = /\s$/.test(raw) ? " " : "";
  return `${lead}${marker}${inner}${marker}${trail}`;
}

function inlineEl(el: ElementNode, inLabel: boolean): string {
  switch (el.tag) {
    case "br":
      return "  \n";
    case "img": {
      const alt = escapeText(decodeEntities(el.attrs.alt || "").replace(/\s+/g, " "), true);
      const src = safeUrl(el.attrs.src || "");
      return src ? `![${alt}](${src})` : "";
    }
    case "strong":
    case "b":
      return wrapInline(el, "**", inLabel);
    case "em":
    case "i":
      return wrapInline(el, "*", inLabel);
    case "del":
    case "s":
    case "strike":
      return wrapInline(el, "~~", inLabel);
    case "code": {
      const inner = rawText(el).replace(/\r?\n/g, " ").trim();
      if (!inner) return "";
      // A fence longer than any backtick run inside, padded when the code starts or ends
      // with a backtick, so the code cannot close the span early.
      const f = fence(inner, 1);
      const pad = inner.startsWith("`") || inner.endsWith("`") ? " " : "";
      return `${f}${pad}${inner}${pad}${f}`;
    }
    case "a": {
      const href = safeUrl(el.attrs.href || "");
      const label = inline(el.children, true).trim();
      if (!href) return label || "";
      return `[${label || escapeText(decodeEntities(href), true)}](${href})`;
    }
    default:
      return inline(el.children, inLabel);
  }
}

function renderPre(el: ElementNode): string {
  let codeEl: ElementNode | null = null;
  for (const c of el.children) {
    if (c.type === "element" && c.tag === "code") {
      codeEl = c;
      break;
    }
  }
  const target = codeEl ?? el;
  let lang = "";
  if (codeEl) {
    const m = (codeEl.attrs.class || "").match(/language-([a-zA-Z0-9#+\-.]+)/);
    if (m) lang = m[1];
  }
  const text = rawText(target)
    .replace(/^\r?\n/, "")
    .replace(/\s+$/, "");
  // The fence is longer than any backtick run in the code, so the code cannot end it.
  const f = fence(text, 3);
  return `${f}${lang}\n${text}\n${f}`;
}

function renderList(el: ElementNode, ordered: boolean, depth: number): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let idx = 0;
  for (const c of el.children) {
    if (c.type !== "element" || c.tag !== "li") continue;
    idx++;
    const marker = ordered ? `${idx}. ` : "- ";
    const inlineChildren: Node[] = [];
    const nestedLists: ElementNode[] = [];
    for (const lc of c.children) {
      if (lc.type === "element" && (lc.tag === "ul" || lc.tag === "ol")) {
        nestedLists.push(lc);
      } else {
        inlineChildren.push(lc);
      }
    }
    const content = inline(inlineChildren)
      .trim()
      .replace(/\s*\n\s*/g, " ");
    lines.push(`${indent}${marker}${content}`);
    for (const nl of nestedLists) {
      lines.push(renderList(nl, nl.tag === "ol", depth + 1));
    }
  }
  return lines.join("\n");
}

function renderTable(el: ElementNode): string {
  const rows: string[][] = [];
  const collect = (node: ElementNode): void => {
    for (const c of node.children) {
      if (c.type !== "element") continue;
      if (c.tag === "tr") {
        const cells: string[] = [];
        for (const cell of c.children) {
          if (cell.type === "element" && (cell.tag === "td" || cell.tag === "th")) {
            cells.push(
              inline(cell.children)
                .trim()
                .replace(/\s*\n\s*/g, " ")
                .replace(/\|/g, "\\|"),
            );
          }
        }
        if (cells.length) rows.push(cells);
      } else if (c.tag === "thead" || c.tag === "tbody" || c.tag === "tfoot") {
        collect(c);
      }
    }
  };
  collect(el);
  if (rows.length === 0) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]): string[] => {
    const copy = r.slice();
    while (copy.length < cols) copy.push("");
    return copy;
  };
  const fmt = (r: string[]): string => `| ${r.join(" | ")} |`;
  const header = fmt(pad(rows[0]));
  const sep = fmt(new Array(cols).fill("---"));
  const body = rows.slice(1).map((r) => fmt(pad(r)));
  return [header, sep, ...body].join("\n");
}

function renderBlockEl(el: ElementNode): string {
  switch (el.tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(el.tag[1]);
      const text = inline(el.children)
        .trim()
        .replace(/\s*\n\s*/g, " ");
      return text ? `${"#".repeat(level)} ${text}` : "";
    }
    case "hr":
      return "---";
    case "pre":
      return renderPre(el);
    case "blockquote": {
      const inner = renderBlocks(el.children).join("\n\n");
      return inner
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    }
    case "ul":
      return renderList(el, false, 0);
    case "ol":
      return renderList(el, true, 0);
    case "table":
      return renderTable(el);
    case "p":
      return inline(el.children).trim();
    default:
      return renderBlocks(el.children).join("\n\n");
  }
}

function renderBlocks(nodes: Node[]): string[] {
  const blocks: string[] = [];
  let buf: Node[] = [];

  const flush = (): void => {
    if (buf.length === 0) return;
    const text = inline(buf).trim();
    buf = [];
    if (text) blocks.push(text);
  };

  for (const n of nodes) {
    if (n.type === "text" || INLINE_TAGS.has(n.tag)) {
      buf.push(n);
      continue;
    }
    flush();
    const block = renderBlockEl(n);
    if (block) blocks.push(block);
  }
  flush();
  return blocks;
}

export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  if (!html.trim()) {
    return { markdown: "", lineCount: 0, charCount: 0 };
  }

  const tree = parseHtml(html);
  let markdown = renderBlocks(tree).join("\n\n");
  markdown = markdown.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, (m) =>
    // keep markdown hard-break (two trailing spaces), drop other trailing whitespace
    m.length >= 2 ? "  " : "",
  );
  markdown = markdown.replace(/^\n+|\n+$/g, "");

  const lineCount = markdown ? markdown.split("\n").length : 0;
  const charCount = markdown.length;

  return { markdown, lineCount, charCount };
}
