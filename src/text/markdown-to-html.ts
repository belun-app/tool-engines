/**
 * Converts a Markdown subset to HTML (headings, paragraphs, fenced code, quotes, flat lists,
 * rules, inline code, emphasis, links, images; no nested lists or tables).
 */

export interface MarkdownToHtmlResult {
  html: string;
  lineCount: number;
  charCount: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** URL schemes a link or image may use; anything else becomes "#". */
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * Link and image destinations: relative URLs, #fragments and the SAFE_SCHEMES. Control
 * characters are removed first (browsers strip leading C0 controls and spaces and drop
 * tabs and line breaks anywhere in a URL, so "\u0001javascript:" and "java\tscript:"
 * still run as javascript:), then the scheme, if any, is checked against the allow-list.
 */
export function sanitizeHref(url: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
  const t = url.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(t);
  if (scheme && !SAFE_SCHEMES.has(scheme[1].toLowerCase())) return "#";
  return t;
}

// Unicode Private Use Area delimiters — safe in regex (not control characters)
const PUA_OPEN = "\uE000";
const PUA_CLOSE = "\uE001";
const PLACEHOLDER = new RegExp(`${PUA_OPEN}(\\d+)${PUA_CLOSE}`, "g");

function parseInline(raw: string): string {
  const stash: string[] = [];

  const stash_push = (html: string): string => {
    const idx = stash.length;
    stash.push(html);
    return `${PUA_OPEN}${idx}${PUA_CLOSE}`;
  };

  const restore = (html: string): string =>
    stash.length ? html.replace(PLACEHOLDER, (m, i) => stash[+i] ?? escapeHtml(m)) : html;

  // Protect inline code spans first
  let text = raw.replace(/`([^`]+)`/g, (_, code) => stash_push(`<code>${escapeHtml(code)}</code>`));

  // Protect images (before links). The destination may hold one level of balanced
  // parentheses, as in https://en.wikipedia.org/wiki/Foo_(bar). Labels cannot contain
  // brackets: that keeps each attempt bounded by the next "[", so the scan stays linear
  // on input such as thousands of unclosed "[".
  text = text.replace(/!\[([^[\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g, (_, alt, src) =>
    stash_push(`<img src="${escapeHtml(sanitizeHref(src))}" alt="${escapeHtml(alt)}">`),
  );

  // Protect links; the label may hold an inline code span stashed above
  text = text.replace(/\[([^[\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, label, href) =>
    stash_push(`<a href="${escapeHtml(sanitizeHref(href))}">${restore(escapeHtml(label))}</a>`),
  );

  // HTML-escape remaining text (& < > " are not markdown markers)
  text = escapeHtml(text);

  // Apply inline formatting (order matters: *** before ** before *)
  // Emphasis content may not start or end with a space, so "2 * 3 * 4" stays plain text.
  text = text.replace(/\*\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__(?!\s)([^_\n]+?)(?<!\s)__/g, "<strong>$1</strong>");
  text = text.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, "<em>$1</em>");
  // Underscore italic: avoid matching inside words of any script (snake_case, при_вет)
  text = text.replace(
    /(?<![\p{L}\p{N}])_(?!\s)([^_\n]+?)(?<!\s)_(?![\p{L}\p{N}])/gu,
    "<em>$1</em>",
  );
  text = text.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");

  // Restore stashed items — PUA delimiters survived escapeHtml unchanged
  return restore(text);
}

export function markdownToHtml(markdown: string): MarkdownToHtmlResult {
  const charCount = markdown.length;

  if (!markdown.trim()) {
    return { html: "", lineCount: 0, charCount: 0 };
  }

  const inputLines = markdown.split("\n");
  const lineCount = inputLines.length;
  const out: string[] = [];

  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let inUL = false;
  let inOL = false;
  let paragraphLines: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    const content = paragraphLines
      .map((line) => {
        const hardBreak = line.endsWith("  ");
        return parseInline(hardBreak ? line.slice(0, -2) : line) + (hardBreak ? "<br>" : "");
      })
      .join("\n");
    out.push(`<p>${content}</p>`);
    paragraphLines = [];
  }

  function closeUL() {
    if (!inUL) return;
    out.push("</ul>");
    inUL = false;
  }

  function closeOL() {
    if (!inOL) return;
    out.push("</ol>");
    inOL = false;
  }

  for (const line of inputLines) {
    // Inside a fenced code block
    if (inCodeBlock) {
      if (/^```/.test(line)) {
        inCodeBlock = false;
        const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
        out.push(`<pre><code${langClass}>${codeLines.map(escapeHtml).join("\n")}</code></pre>`);
        codeLines = [];
        codeLang = "";
      } else {
        codeLines.push(line);
      }
      continue;
    }

    // Open a fenced code block
    if (/^```(.*)$/.test(line)) {
      flushParagraph();
      closeUL();
      closeOL();
      inCodeBlock = true;
      codeLang = line.slice(3).trim();
      continue;
    }

    // Blank line — flush all open blocks
    if (line.trim() === "") {
      flushParagraph();
      closeUL();
      closeOL();
      continue;
    }

    // ATX heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      flushParagraph();
      closeUL();
      closeOL();
      const lvl = headingMatch[1].length;
      out.push(`<h${lvl}>${parseInline(headingMatch[2].trimEnd())}</h${lvl}>`);
      continue;
    }

    // Horizontal rule (3+ *, -, or _ on a line)
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      closeUL();
      closeOL();
      out.push("<hr>");
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      flushParagraph();
      closeUL();
      closeOL();
      out.push(`<blockquote><p>${parseInline(bqMatch[1])}</p></blockquote>`);
      continue;
    }

    // Unordered list item (-, *, or +)
    const ulMatch = line.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      flushParagraph();
      closeOL();
      if (!inUL) {
        out.push("<ul>");
        inUL = true;
      }
      out.push(`<li>${parseInline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      flushParagraph();
      closeUL();
      if (!inOL) {
        out.push("<ol>");
        inOL = true;
      }
      out.push(`<li>${parseInline(olMatch[1])}</li>`);
      continue;
    }

    // Regular paragraph text
    if (inUL) closeUL();
    if (inOL) closeOL();
    paragraphLines.push(line);
  }

  // Flush any remaining open blocks
  flushParagraph();
  closeUL();
  closeOL();
  if (inCodeBlock) {
    const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
    out.push(`<pre><code${langClass}>${codeLines.map(escapeHtml).join("\n")}</code></pre>`);
  }

  return { html: out.join("\n"), lineCount, charCount };
}
