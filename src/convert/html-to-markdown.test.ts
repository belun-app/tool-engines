import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./html-to-markdown.js";

const md = (html: string) => htmlToMarkdown(html).markdown;

describe("htmlToMarkdown", () => {
  it("returns the empty result for blank input", () => {
    expect(htmlToMarkdown("  \n")).toEqual({ markdown: "", lineCount: 0, charCount: 0 });
  });

  it("converts headings h1-h6 and paragraphs", () => {
    expect(md("<h1>Title</h1><p>Para one.</p><h3>Sub\n  head</h3><p>Two</p>")).toBe(
      "# Title\n\nPara one.\n\n### Sub head\n\nTwo",
    );
    expect(md("<h6>x</h6>")).toBe("###### x");
    expect(md("<h2>  </h2>")).toBe("");
  });

  it("converts inline formatting", () => {
    expect(
      md("<p><strong>b</strong> <b>b2</b> <em>i</em> <i>i2</i> <del>d</del> <s>s</s></p>"),
    ).toBe("**b** **b2** *i* *i2* ~~d~~ ~~s~~");
    expect(md("<p>use <code>npm  i</code> now</p>")).toBe("use `npm  i` now");
    expect(md("<p><b></b>x</p>")).toBe("x");
  });

  it("converts links and images", () => {
    expect(md('<a href="https://x.com">X site</a>')).toBe("[X site](https://x.com)");
    expect(md('<a href="https://x.com"></a>')).toBe("[https://x.com](https://x.com)");
    expect(md("<a>plain</a>")).toBe("plain");
    expect(md('<img src="a.png" alt="A &amp; B">')).toBe("![A & B](a.png)");
    expect(md('<img alt="no src">')).toBe("");
  });

  it("converts line breaks to hard breaks and hr to ---", () => {
    expect(md("<p>a<br>b</p><hr/>")).toBe("a  \nb\n\n---");
  });

  it("converts unordered, ordered and nested lists", () => {
    expect(md("<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>")).toBe("- a\n- b\n  - c");
    expect(md("<ol><li>one</li><li>two<ol><li>x</li></ol></li></ol>")).toBe(
      "1. one\n2. two\n  1. x",
    );
  });

  it("converts pre/code blocks with the language class and raw content", () => {
    expect(md('<pre><code class="language-js">\nconst a = 1 &lt; 2;\n  b();\n</code></pre>')).toBe(
      "```js\nconst a = 1 < 2;\n  b();\n```",
    );
    expect(md("<pre>plain</pre>")).toBe("```\nplain\n```");
  });

  it("converts blockquotes", () => {
    expect(md("<blockquote><p>q1</p><p>q2</p></blockquote>")).toBe("> q1\n>\n> q2");
  });

  it("converts tables, padding short rows and escaping pipes", () => {
    expect(
      md(
        "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1|2</td></tr></tbody></table>",
      ),
    ).toBe("| A | B |\n| --- | --- |\n| 1\\|2 |  |");
    expect(md("<table></table>")).toBe("");
  });

  it("drops script, style, head and comments", () => {
    expect(
      md(
        "<!DOCTYPE html><html><head><title>T</title><style>p{}</style></head><body><!-- c --><script>var x = '<p>';</script><p>Body</p></body></html>",
      ),
    ).toBe("Body");
  });

  it("decodes named and numeric entities", () => {
    expect(md("<p>&lt;a&gt; &mdash; &#169; &#x41; &euro; &unknown;</p>")).toBe(
      "\\<a> — © A € &unknown;",
    );
    expect(md("<p>1 &lt; 2 &gt; 0</p>")).toBe("1 < 2 > 0");
    // Out-of-range code point stays as written instead of throwing.
    expect(md("<p>&#x110000;</p>")).toBe("&#x110000;");
  });

  it("collapses whitespace and keeps Cyrillic text", () => {
    expect(md("<p>  Привет,\n\n   мир  </p>")).toBe("Привет, мир");
  });

  it("tolerates unclosed and stray closing tags", () => {
    expect(md("<p>open<p>next</div>")).toContain("open");
    expect(() => md("<<<>>> </ > <a")).not.toThrow();
  });

  it("reports line and character counts", () => {
    const r = htmlToMarkdown("<h1>A</h1><p>B</p>");
    expect(r.markdown).toBe("# A\n\nB");
    expect(r.lineCount).toBe(3);
    expect(r.charCount).toBe(6);
  });

  it("keeps the space between an inline tag and the following word", () => {
    expect(md("<p><b>bold </b>text</p>")).toBe("**bold** text");
    expect(md("<p>a <em> b </em> c</p>")).toBe("a *b* c");
  });
});

describe("htmlToMarkdown output safety", () => {
  it("keeps entity-encoded tags as text, not raw HTML", () => {
    expect(md("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe(
      "\\<script>alert(1)\\</script>",
    );
    expect(md("<p>&lt;!-- x --&gt; &lt;img src=x onerror=alert(1)&gt;</p>")).toBe(
      "\\<!-- x --> \\<img src=x onerror=alert(1)>",
    );
    // A literal backslash before the tag cannot cancel the escape.
    expect(md("<p>\\&lt;b&gt;</p>")).toBe("\\\\\\<b>");
  });

  it("drops scripting URLs from links and images", () => {
    for (const href of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "&#1;javascript:alert(1)",
      "jav&#x61;script:alert(1)",
      "jav&colon;script:alert(1)",
      "java&Tab;script:alert(1)",
      "vbscript:x",
      "data:text/html,x",
    ]) {
      expect(md(`<a href="${href}">label</a>`)).toBe("label");
      expect(md(`<img src="${href}" alt="pic">`)).toBe("");
    }
    expect(md('<a href="\u0001javascript:alert(1)">x</a>')).toBe("x");
  });

  it("keeps safe URLs as written", () => {
    expect(md('<a href="https://x.com/?a=1&amp;b=2">x</a>')).toBe(
      "[x](https://x.com/?a=1&amp;b=2)",
    );
    expect(md('<a href="mailto:a@b.c">m</a> <a href="#top">t</a> <a href="/p">p</a>')).toBe(
      "[m](mailto:a@b.c) [t](#top) [p](/p)",
    );
    expect(md('<a href="https://en.wikipedia.org/wiki/Foo_(bar)">w</a>')).toBe(
      "[w](https://en.wikipedia.org/wiki/Foo_(bar))",
    );
  });

  it("encodes characters that would end the destination early", () => {
    expect(md('<a href="/a b)c">x</a>')).toBe("[x](/a%20b%29c)");
    expect(md('<img src="a(.png" alt="i">')).toBe("![i](a%28.png)");
  });

  it("escapes brackets in image alt and link text", () => {
    expect(md('<img src="a.png" alt="a](http://evil) [b">')).toBe(
      "![a\\](http://evil) \\[b](a.png)",
    );
    expect(md('<a href="/x">[1] see ](y)</a>')).toBe("[\\[1\\] see \\](y)](/x)");
  });

  it("does not let plain text form a link", () => {
    expect(md("<p>[x](javascript:alert(1)) and [1]</p>")).toBe(
      "[x\\](javascript:alert(1)) and [1]",
    );
  });

  it("uses fences longer than any backtick run in code", () => {
    expect(md("<p><code>a`b</code></p>")).toBe("``a`b``");
    expect(md("<p><code>`x`</code></p>")).toBe("`` `x` ``");
    expect(md("<pre><code>```\n&lt;script&gt;\n```</code></pre>")).toBe(
      "````\n```\n<script>\n```\n````",
    );
  });

  it("treats script and style content as raw text up to the end tag", () => {
    expect(md("<script>if (a<b) x('</p>');</script><p>after</p>")).toBe("after");
    expect(md("<p>a</p><STYLE>p > a { }</style><p>b</p>")).toBe("a\n\nb");
  });

  // These inputs used to take seconds because every "<" rescanned the rest of the input;
  // the tokenizer is linear now, so they finish in milliseconds, well inside the timeout.
  it("handles long runs of unclosed tags and comments", () => {
    const n = 200_000;
    expect(md("<".repeat(n))).toBe("<".repeat(n));
    expect(md("<a".repeat(n / 2))).toBe("\\<a".repeat(n / 2));
    expect(md(`x${"<!--".repeat(n / 4)}`)).toBe("x");
    expect(md("<script>".repeat(n / 8))).toBe("");
  });
});
