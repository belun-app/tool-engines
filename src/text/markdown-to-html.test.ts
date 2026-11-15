import { describe, expect, it } from "vitest";
import { markdownToHtml, sanitizeHref } from "./markdown-to-html.js";

const html = (md: string) => markdownToHtml(md).html;

describe("markdownToHtml", () => {
  it("returns empty html for empty or whitespace input", () => {
    expect(markdownToHtml("")).toEqual({ html: "", lineCount: 0, charCount: 0 });
    expect(markdownToHtml("  \n ")).toEqual({ html: "", lineCount: 0, charCount: 0 });
  });

  it("reports line and character counts", () => {
    const r = markdownToHtml("# A\ntext");
    expect(r.lineCount).toBe(2);
    expect(r.charCount).toBe(8);
  });

  it("renders headings h1..h6 and treats 7 hashes as text", () => {
    expect(html("# One")).toBe("<h1>One</h1>");
    expect(html("###### Six")).toBe("<h6>Six</h6>");
    expect(html("####### Seven")).toBe("<p>####### Seven</p>");
    expect(html("#NoSpace")).toBe("<p>#NoSpace</p>");
  });

  it("joins consecutive lines into one paragraph and supports hard breaks", () => {
    expect(html("one\ntwo\n\nthree")).toBe("<p>one\ntwo</p>\n<p>three</p>");
    expect(html("line  \nnext")).toBe("<p>line<br>\nnext</p>");
  });

  it("renders bold, italic, bold-italic, strikethrough and inline code", () => {
    expect(html("**b** *i* ***bi*** __u__ _e_ ~~s~~ `c`")).toBe(
      "<p><strong>b</strong> <em>i</em> <strong><em>bi</em></strong> <strong>u</strong> <em>e</em> <del>s</del> <code>c</code></p>",
    );
  });

  it("does not italicise underscores inside snake_case words", () => {
    expect(html("use snake_case_name here")).toBe("<p>use snake_case_name here</p>");
  });

  it("escapes HTML in text and inline code", () => {
    expect(html('<script>alert("x")</script> & `<b>`')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; <code>&lt;b&gt;</code></p>",
    );
  });

  it("renders links and images, neutralising javascript:/data: URLs", () => {
    expect(html("[site](https://example.com/?a=1&b=2)")).toBe(
      '<p><a href="https://example.com/?a=1&amp;b=2">site</a></p>',
    );
    expect(html("![alt](pic.png)")).toBe('<p><img src="pic.png" alt="alt"></p>');
    expect(html("[x](JavaScript:alert)")).toBe('<p><a href="#">x</a></p>');
    expect(html("![x](data:image/svg+xml;base64,AAA)")).toBe('<p><img src="#" alt="x"></p>');
  });

  it("neutralises scripting URLs hidden behind control characters", () => {
    for (const href of [
      "\u0001javascript:alert(1)",
      "\u0000javascript:alert(1)",
      "java\u0008script:alert(1)",
      "\u001Fvbscript:msgbox",
      "file:///etc/passwd",
    ]) {
      expect(html(`[x](${href})`)).toBe('<p><a href="#">x</a></p>');
      expect(html(`![x](${href})`)).toBe('<p><img src="#" alt="x"></p>');
    }
    // Not link syntax in Markdown (whitespace in the destination), but unsafe on their own.
    for (const href of ["java\tscript:alert(1)", "java\nscript:x", " JAVASCRIPT:alert(1)"]) {
      expect(sanitizeHref(href)).toBe("#");
    }
  });

  it("keeps http, https, mailto, tel, relative and fragment URLs", () => {
    for (const href of [
      "http://a.example/",
      "https://a.example/x?y=1",
      "mailto:me@example.com",
      "tel:+123",
      "/docs/page",
      "../up",
      "page.html",
      "#section",
      "//cdn.example/x.png",
    ]) {
      expect(sanitizeHref(href)).toBe(href);
    }
    expect(sanitizeHref("\u0001https://a.example/")).toBe("https://a.example/");
  });

  // Each case used to take seconds at this size because of regex backtracking; with a
  // linear scan it finishes in milliseconds, well inside the test timeout.
  it("handles long runs of unclosed link and image syntax", () => {
    const n = 200_000;
    expect(html("[".repeat(n))).toBe(`<p>${"[".repeat(n)}</p>`);
    expect(html("![".repeat(n / 2))).toBe(`<p>${"![".repeat(n / 2)}</p>`);
    expect(html("[a](".repeat(n / 4))).toBe(`<p>${"[a](".repeat(n / 4)}</p>`);
  });

  it("renders unordered and ordered lists and switches between them", () => {
    expect(html("- a\n* b\n+ c")).toBe("<ul>\n<li>a</li>\n<li>b</li>\n<li>c</li>\n</ul>");
    expect(html("1. a\n2. b\n- c")).toBe(
      "<ol>\n<li>a</li>\n<li>b</li>\n</ol>\n<ul>\n<li>c</li>\n</ul>",
    );
  });

  it("closes a list when a paragraph line follows", () => {
    expect(html("- a\ntext")).toBe("<ul>\n<li>a</li>\n</ul>\n<p>text</p>");
  });

  it("renders blockquotes and horizontal rules", () => {
    expect(html("> quote *it*")).toBe("<blockquote><p>quote <em>it</em></p></blockquote>");
    expect(html("---\n***\n___")).toBe("<hr>\n<hr>\n<hr>");
  });

  it("renders fenced code blocks with a language class and escaped content", () => {
    expect(html("```js\nconst a = 1 < 2;\n**not bold**\n```")).toBe(
      '<pre><code class="language-js">const a = 1 &lt; 2;\n**not bold**</code></pre>',
    );
  });

  it("closes an unterminated code block at the end", () => {
    expect(html("```\ncode")).toBe("<pre><code>code</code></pre>");
  });

  it("handles Cyrillic and emoji", () => {
    expect(html("# Привет 👋\n**жирный**")).toBe(
      "<h1>Привет 👋</h1>\n<p><strong>жирный</strong></p>",
    );
  });

  it("renders inline code inside a link label", () => {
    expect(html("[`code`](https://x.com)")).toBe(
      '<p><a href="https://x.com"><code>code</code></a></p>',
    );
  });

  it("keeps balanced parentheses in link URLs", () => {
    expect(html("[w](https://en.wikipedia.org/wiki/Foo_(bar))")).toBe(
      '<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)">w</a></p>',
    );
  });

  it("does not italicise underscores inside Cyrillic words", () => {
    expect(html("при_вет_мир")).toBe("<p>при_вет_мир</p>");
  });

  it("does not treat spaced asterisks as emphasis", () => {
    expect(html("2 * 3 * 4")).toBe("<p>2 * 3 * 4</p>");
  });
});
