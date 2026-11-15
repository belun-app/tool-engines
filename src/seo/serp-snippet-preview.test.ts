import { describe, expect, it } from "vitest";
import { measureTextWidth, previewSerpSnippet } from "./serp-snippet-preview.js";

const GOOD_TITLE = "Free SERP Snippet Preview Tool for Titles"; // comfortably 50-100% of 580px
const GOOD_DESC =
  "See exactly how your page title and meta description look in Google search results on desktop and mobile, with pixel widths and warnings.";

describe("measureTextWidth (Arial-compatible widths)", () => {
  it("uses per-character advance widths scaled by font size", () => {
    // W = 944/1000 em, l = 222, at 1000px -> units directly
    expect(measureTextWidth("W", 1000)).toBe(944);
    expect(measureTextWidth("l", 1000)).toBe(222);
    // space 278 + "~" (last ASCII entry) 584
    expect(measureTextWidth(" ~", 1000)).toBe(862);
    // "Hi" at 20px: H 722 + i 222 = 944 units -> 18.88px
    expect(measureTextWidth("Hi", 20)).toBeCloseTo(18.88, 10);
  });

  it("covers Cyrillic, typographic extras and wide fallbacks", () => {
    // А (U+0410) 667, я (U+044F) 542, Ё 667, — 1000
    expect(measureTextWidth("Ая", 1000)).toBe(1209);
    expect(measureTextWidth("Ё—", 1000)).toBe(1667);
    // emoji and CJK use the wide fallback; other Latin-1 the narrow one
    expect(measureTextWidth("😀中", 1000)).toBe(2000);
    expect(measureTextWidth("é", 1000)).toBe(556);
  });

  it("is zero for empty text", () => {
    expect(measureTextWidth("", 20)).toBe(0);
  });
});

describe("previewSerpSnippet", () => {
  it("handles completely empty input with empty-field warnings", () => {
    const r = previewSerpSnippet();
    expect(r.device).toBe("desktop");
    expect(r.title.status).toBe("empty");
    expect(r.description.status).toBe("empty");
    expect(r.url).toEqual({ valid: false, domain: "", breadcrumb: "", full: "", https: false });
    expect(r.keyword).toBeNull();
    expect(r.warnings).toEqual(["title-empty", "description-empty"]);
    // 100 - 40 - 25
    expect(r.score).toBe(35);
  });

  it("scores a healthy snippet at 100", () => {
    const r = previewSerpSnippet({
      title: GOOD_TITLE,
      description: GOOD_DESC,
      url: "https://www.example.com/serp-preview/",
    });
    expect(r.warnings).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.title.status).toBe("ok");
    expect(r.url).toEqual({
      valid: true,
      domain: "example.com",
      breadcrumb: "example.com › serp-preview",
      full: "https://www.example.com/serp-preview/",
      https: true,
    });
  });

  it("normalises whitespace and counts characters and words", () => {
    const r = previewSerpSnippet({ title: "  Hello \n\t world  " });
    expect(r.title.text).toBe("Hello world");
    expect(r.title.characters).toBe(11);
    expect(r.title.words).toBe(2);
  });

  it("truncates by pixel width with an ellipsis", () => {
    // W at 20px = 18.88px; budget 580 - ellipsis 20 = 560 -> 29 W fit (547.52), 30 do not (566.4)
    const r = previewSerpSnippet({ title: "W".repeat(40) });
    expect(r.title.truncated).toBe(true);
    expect(r.title.display).toBe(`${"W".repeat(29)}…`);
    expect(r.title.status).toBe("long");
    // 40 * 18.88 = 755.2 -> 755px, 755.2/580 = 130%
    expect(r.title.pixels).toBe(755);
    expect(r.title.percent).toBe(130);
    expect(r.warnings).toContain("title-long");
  });

  it("prefers cutting at a word boundary and strips trailing punctuation", () => {
    const title =
      "Alpha beta gamma, delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron";
    const r = previewSerpSnippet({ title, device: "desktop" });
    expect(r.title.truncated).toBe(true);
    expect(r.title.display.endsWith("…")).toBe(true);
    const kept = r.title.display.slice(0, -1);
    // the kept part is a whole-word prefix of the title
    expect(title.startsWith(kept)).toBe(true);
    expect(title[kept.length]).toMatch(/[ ,]/);
  });

  it("gives mobile a larger title budget", () => {
    const r = previewSerpSnippet({ title: "W".repeat(40), device: "mobile" });
    expect(r.title.maxPixels).toBe(920);
    expect(r.title.truncated).toBe(false);
  });

  it("flags short, shouting and repetitive titles", () => {
    expect(previewSerpSnippet({ title: "Hi" }).warnings).toContain("title-short");
    expect(previewSerpSnippet({ title: "BUY CHEAP SHOES NOW TODAY" }).warnings).toContain(
      "title-uppercase",
    );
    expect(previewSerpSnippet({ title: "shoes shoes shoes" }).warnings).toContain("title-repeats");
  });

  it("flags a description that starts by repeating the title", () => {
    const r = previewSerpSnippet({ title: GOOD_TITLE, description: `${GOOD_TITLE}. ${GOOD_DESC}` });
    expect(r.warnings).toContain("description-repeats-title");
  });

  it("checks URL problems: invalid, insecure, underscores, uppercase, depth", () => {
    expect(previewSerpSnippet({ url: "not a url" }).warnings).toContain("url-invalid");
    expect(previewSerpSnippet({ url: "ftp://ex.com" }).warnings).toContain("url-invalid");
    expect(previewSerpSnippet({ url: "localhost" }).warnings).toContain("url-invalid");
    const w = previewSerpSnippet({ url: "http://ex.com/a/B_c/d/e" }).warnings;
    expect(w).toEqual(
      expect.arrayContaining(["url-insecure", "url-underscores", "url-uppercase", "url-deep"]),
    );
  });

  it("adds https:// to a bare domain and decodes Cyrillic path segments in the breadcrumb", () => {
    const r = previewSerpSnippet({ url: "example.ru/блог/кофе" });
    expect(r.url.valid).toBe(true);
    expect(r.url.breadcrumb).toBe("example.ru › блог › кофе");
    expect(r.url.https).toBe(true);
  });

  it("checks the focus keyword in title, description and URL", () => {
    const r = previewSerpSnippet({
      title: GOOD_TITLE,
      description: GOOD_DESC,
      url: "https://example.com/serp-snippet-preview",
      keyword: "  SERP   Snippet ",
    });
    expect(r.keyword).toEqual({
      keyword: "serp snippet",
      inTitle: true,
      inDescription: false,
      inUrl: true,
    });
    expect(r.warnings).toEqual(["keyword-missing-description"]);
    expect(r.score).toBe(95);
  });

  it("never drops the score below 0", () => {
    const r = previewSerpSnippet({ url: "http://", keyword: "x" });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("finds a Cyrillic keyword in a Cyrillic URL", () => {
    const r = previewSerpSnippet({
      url: "https://example.ru/кофе-с-собой",
      keyword: "кофе с собой",
    });
    expect(r.keyword?.inUrl).toBe(true);
  });
});
