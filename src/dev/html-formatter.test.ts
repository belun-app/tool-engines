import { describe, expect, it } from "vitest";
import { formatHTML, minifyHTML } from "./html-formatter.js";

describe("formatHTML", () => {
  it("indents a small document, keeping leaf text and void elements on one line", () => {
    const r = formatHTML(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title></head><body><div class="a"><p>Hi</p><br><img src="x.png" /></div></body></html>',
    );
    expect(r.warnings).toEqual([]);
    expect(r.formatted).toBe(
      [
        "<!DOCTYPE html>",
        "<html>",
        "  <head>",
        '    <meta charset="utf-8">',
        "    <title>T</title>",
        "  </head>",
        "  <body>",
        '    <div class="a">',
        "      <p>Hi</p>",
        "      <br>",
        '      <img src="x.png"/>',
        "    </div>",
        "  </body>",
        "</html>",
      ].join("\n"),
    );
  });

  it("keeps text and inline elements on one line so no whitespace is added between them", () => {
    expect(formatHTML("<p>Hello <b>world</b>!</p>").formatted).toBe(
      "<p>\n  Hello <b>world</b>!\n</p>",
    );
    expect(formatHTML("<div><b>a</b><i>b</i></div>").formatted).toBe(
      "<div>\n  <b>a</b><i>b</i>\n</div>",
    );
    expect(formatHTML('<p>See <a href="/x">the <em>docs</em></a>.</p>').formatted).toBe(
      '<p>\n  See <a href="/x">the <em>docs</em></a>.\n</p>',
    );
    expect(formatHTML("<p>a<br>b</p>").formatted).toBe("<p>\n  a<br>b\n</p>");
  });

  it("collapses whitespace inside an inline run", () => {
    expect(formatHTML("<p>Hello\n    <b>world</b>   again</p>").formatted).toBe(
      "<p>\n  Hello <b>world</b> again\n</p>",
    );
  });

  it("indents block content inside an inline element", () => {
    const r = formatHTML("<a href='#'>Go <div>block</div> back</a>");
    expect(r.formatted).toBe("<a href='#'>Go\n  <div>block</div>\n  back\n</a>");
    expect(r.warnings).toEqual([]);
  });

  it("returns empty for non-string input", () => {
    expect(formatHTML(undefined as unknown as string).formatted).toBe("");
    expect(minifyHTML(null as unknown as string).formatted).toBe("");
  });

  it("honours indent size", () => {
    expect(formatHTML("<div><span>x</span></div>", 4).formatted).toBe(
      "<div>\n    <span>x</span>\n</div>",
    );
  });

  it("closes implied siblings (li, td, option) without warnings", () => {
    const r = formatHTML("<ul><li>One<li>Two</ul>");
    expect(r.formatted).toBe("<ul>\n  <li>\n    One\n  <li>\n    Two\n</ul>");
    expect(r.warnings).toEqual([]);
  });

  it("preserves pre/textarea verbatim and script content", () => {
    const r = formatHTML("<div><pre>  a\n   b </pre><script>if (a < b) { x(); }</script></div>");
    expect(r.formatted).toBe(
      "<div>\n  <pre>  a\n   b </pre>\n  <script>\n" +
        "if (a < b) { x(); }\n" +
        "  </script>\n</div>",
    );
    expect(formatHTML("<script src='a.js'></script>").formatted).toBe(
      "<script src='a.js'></script>",
    );
  });

  it("is case-insensitive for tag names and keeps quoted > in attributes", () => {
    expect(formatHTML('<DIV title="a>b"><P>x</p></div>').formatted).toBe(
      '<DIV title="a>b">\n  <P>x</p>\n</div>',
    );
  });

  it("warns about stray and unclosed tags (optional-close tags exempt)", () => {
    expect(formatHTML("<div>x</span></div>").warnings).toEqual([
      "Stray closing tag </span> with no matching opener",
    ]);
    expect(formatHTML("<p>a</p></br>").warnings).toEqual(["Ignored stray closing tag </br>"]);
    expect(formatHTML("<section><div>").warnings).toEqual(["Unclosed tags: <div>, <section>"]);
    expect(formatHTML("<html><body><p>open").warnings).toEqual([]);
  });

  it("keeps comments", () => {
    expect(formatHTML("<div><!-- c --></div>").formatted).toBe("<div>\n  <!-- c -->\n</div>");
  });

  it("returns empty for blank input", () => {
    expect(formatHTML(" \n ")).toEqual({ formatted: "", warnings: [] });
  });

  it("warns when a closing tag implicitly closes a non-optional element", () => {
    expect(formatHTML("<div><span>x</div>").warnings.length).toBeGreaterThan(0);
  });
});

describe("minifyHTML", () => {
  it("collapses whitespace but keeps one space between inline words", () => {
    expect(minifyHTML("<div>\n  <p>Hello   <b>world</b> !</p>\n</div>\n").formatted).toBe(
      "<div> <p>Hello <b>world</b> !</p> </div>",
    );
  });

  it("keeps raw-text element content intact", () => {
    expect(minifyHTML("<pre>  a\n  b</pre>  <style> a { } </style>").formatted).toBe(
      "<pre>  a\n  b</pre> <style> a { } </style>",
    );
  });

  it("normalises tag whitespace and keeps comments", () => {
    expect(minifyHTML('<a   href="x  y"  ><!-- c --></a >').formatted).toBe(
      '<a href="x  y"><!-- c --></a>',
    );
  });

  it("returns empty for blank input", () => {
    expect(minifyHTML("")).toEqual({ formatted: "", warnings: [] });
  });
});
