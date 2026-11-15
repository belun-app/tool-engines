import { describe, expect, it, vi } from "vitest";
import {
  MAX_URLS_PER_FILE,
  type SitemapInput,
  escapeXml,
  formatPriority,
  generateSitemap,
  priorityForDepth,
} from "./xml-sitemap-generator.js";

const input = (o: Partial<SitemapInput>): SitemapInput => ({
  urls: "",
  baseUrl: "",
  lastmodMode: "none",
  lastmodValue: "",
  changefreq: "",
  priorityMode: "none",
  priorityValue: "",
  today: "2026-11-14",
  ...o,
});
const codes = (r: ReturnType<typeof generateSitemap>) => r.issues.map((i) => i.code);

describe("helpers", () => {
  it("escapeXml escapes the five XML special characters", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });

  it("formatPriority clamps to 0..1 with one decimal", () => {
    expect(formatPriority(0.25)).toBe("0.3"); // tie rounds up per Number#toFixed
    expect(formatPriority(0.8)).toBe("0.8");
    expect(formatPriority(2)).toBe("1.0");
    expect(formatPriority(-1)).toBe("0.0");
  });

  it("priorityForDepth steps down per segment and floors at 0.3", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(priorityForDepth)).toEqual([
      "1.0",
      "0.8",
      "0.6",
      "0.5",
      "0.4",
      "0.3",
      "0.3",
    ]);
  });
});

describe("generateSitemap", () => {
  it("returns an empty result with an 'empty' warning for blank input", () => {
    const r = generateSitemap(input({ urls: "  \n\n# comment only\n" }));
    expect(r.content).toBe("");
    expect(r.files).toEqual([]);
    expect(r.urlCount).toBe(0);
    expect(r.bytes).toBe(0);
    expect(codes(r)).toEqual(["empty"]);
  });

  it("builds a minimal valid urlset", () => {
    const r = generateSitemap(input({ urls: "https://example.com/\nhttps://example.com/about" }));
    expect(r.content).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url>",
        "    <loc>https://example.com/</loc>",
        "  </url>",
        "  <url>",
        "    <loc>https://example.com/about</loc>",
        "  </url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
    expect(r.files).toEqual([{ name: "sitemap.xml", content: r.content }]);
    expect(r.urlCount).toBe(2);
    expect(r.skippedCount).toBe(0);
    expect(r.bytes).toBe(new TextEncoder().encode(r.content).length);
    expect(r.issues).toEqual([]);
  });

  it("escapes ampersands in query strings", () => {
    const r = generateSitemap(input({ urls: "https://example.com/?a=1&b=2" }));
    expect(r.content).toContain("<loc>https://example.com/?a=1&amp;b=2</loc>");
  });

  it("resolves bare paths against the base URL and bare domains with https", () => {
    const r = generateSitemap(
      input({ baseUrl: "example.com/ignored-path", urls: "/about\ncontact\nexample.com/blog" }),
    );
    expect(r.entries.map((e) => e.loc)).toEqual([
      "https://example.com/about",
      "https://example.com/contact",
      "https://example.com/blog",
    ]);
  });

  it("skips unreadable lines with one collapsed invalid-url warning", () => {
    const r = generateSitemap(input({ urls: "/about\nnot a url\nhttps://example.com/" }));
    // no base URL: "/about" and "not a url" are unreadable
    expect(r.urlCount).toBe(1);
    expect(r.skippedCount).toBe(2);
    const issue = r.issues.find((i) => i.code === "invalid-url");
    expect(issue).toMatchObject({ count: 2, value: "/about", level: "warning" });
  });

  it("strips list markers, quotes and angle brackets", () => {
    const r = generateSitemap(
      input({
        urls: '- https://example.com/a\n2. https://example.com/b\n<https://example.com/c>\n"https://example.com/d",',
      }),
    );
    expect(r.entries.map((e) => e.loc)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
      "https://example.com/d",
    ]);
  });

  it("removes duplicates after normalisation and reports them", () => {
    // "https://Example.com" normalises to "https://example.com/"
    const r = generateSitemap(
      input({ urls: "https://example.com/\nhttps://Example.com\nhttps://example.com/" }),
    );
    expect(r.urlCount).toBe(1);
    expect(r.skippedCount).toBe(2);
    expect(r.issues.find((i) => i.code === "duplicate")?.count).toBe(2);
  });

  it("warns about mixed hosts and http:// URLs", () => {
    const r = generateSitemap(input({ urls: "https://example.com/\nhttp://www.example.com/" }));
    expect(codes(r)).toEqual(["mixed-host", "insecure"]);
    expect(r.issues[0].count).toBe(2);
    expect(r.issues[1].count).toBe(1);
  });

  it("percent-encodes Cyrillic paths and IDN hosts", () => {
    const r = generateSitemap(input({ urls: "https://пример.рф/статья" }));
    // пример.рф -> xn--e1afmkfd.xn--p1ai ; "статья" UTF-8 percent-encoded
    expect(r.entries[0].loc).toBe(
      "https://xn--e1afmkfd.xn--p1ai/%D1%81%D1%82%D0%B0%D1%82%D1%8C%D1%8F",
    );
  });

  it("applies per-line overrides (comma, tab or pipe separated)", () => {
    const r = generateSitemap(
      input({
        urls: [
          "https://example.com/a, 2025-01-02, weekly, 0.7",
          "https://example.com/b\t2025-03-04T10:00:00+03:00\tDAILY\t1",
          "https://example.com/c | never | 0,3",
        ].join("\n"),
      }),
    );
    expect(r.entries).toEqual([
      {
        loc: "https://example.com/a",
        lastmod: "2025-01-02",
        changefreq: "weekly",
        priority: "0.7",
      },
      {
        loc: "https://example.com/b",
        lastmod: "2025-03-04T10:00:00+03:00",
        changefreq: "daily",
        priority: "1.0",
      },
      { loc: "https://example.com/c", changefreq: "never", priority: "0.3" },
    ]);
  });

  it("keeps commas that are part of the URL", () => {
    const r = generateSitemap(input({ urls: "https://example.com/?tags=a,b,c" }));
    expect(r.entries[0].loc).toBe("https://example.com/?tags=a,b,c");
  });

  it("applies global lastmod modes: today and fixed", () => {
    const today = generateSitemap(input({ urls: "https://example.com/", lastmodMode: "today" }));
    expect(today.entries[0].lastmod).toBe("2026-11-14");
    const fixed = generateSitemap(
      input({ urls: "https://example.com/", lastmodMode: "fixed", lastmodValue: "2024-05-06" }),
    );
    expect(fixed.entries[0].lastmod).toBe("2024-05-06");
    expect(fixed.content).toContain("<lastmod>2024-05-06</lastmod>");
  });

  it("reports a bad fixed lastmod as an error and omits the element", () => {
    const r = generateSitemap(
      input({ urls: "https://example.com/", lastmodMode: "fixed", lastmodValue: "06.05.2024" }),
    );
    expect(r.issues).toContainEqual(
      expect.objectContaining({ code: "bad-lastmod", level: "error", value: "06.05.2024" }),
    );
    expect(r.entries[0].lastmod).toBeUndefined();
    expect(r.content).not.toContain("<lastmod>");
  });

  it("a per-line lastmod overrides the global one", () => {
    const r = generateSitemap(
      input({ urls: "https://example.com/, 2020-01-01", lastmodMode: "today" }),
    );
    expect(r.entries[0].lastmod).toBe("2020-01-01");
  });

  it("applies a global changefreq", () => {
    const r = generateSitemap(input({ urls: "https://example.com/", changefreq: "monthly" }));
    expect(r.content).toContain("<changefreq>monthly</changefreq>");
  });

  it("auto priority follows path depth", () => {
    const r = generateSitemap(
      input({
        priorityMode: "auto",
        urls: "https://example.com/\nhttps://example.com/blog/\nhttps://example.com/a/b/c/d/e",
      }),
    );
    expect(r.entries.map((e) => e.priority)).toEqual(["1.0", "0.8", "0.3"]);
  });

  it("fixed priority is clamped and formatted", () => {
    const r = generateSitemap(
      input({ urls: "https://example.com/", priorityMode: "fixed", priorityValue: "0.5" }),
    );
    expect(r.entries[0].priority).toBe("0.5");
    const high = generateSitemap(
      input({ urls: "https://example.com/", priorityMode: "fixed", priorityValue: "7" }),
    );
    expect(high.entries[0].priority).toBe("1.0");
  });

  it("no priority element when priorityMode is none", () => {
    const r = generateSitemap(input({ urls: "https://example.com/", priorityValue: "0.5" }));
    expect(r.content).not.toContain("<priority>");
  });

  it("splits more than 50,000 URLs into chunks plus an index", () => {
    const urls = Array.from(
      { length: MAX_URLS_PER_FILE + 1 },
      (_, i) => `https://example.com/p${i}`,
    ).join("\n");
    const r = generateSitemap(input({ urls, baseUrl: "https://example.com" }));
    expect(r.urlCount).toBe(50001);
    expect(r.files.map((f) => f.name)).toEqual(["sitemap.xml", "sitemap-1.xml", "sitemap-2.xml"]);
    expect(r.content).toContain("<sitemapindex");
    expect(r.content).toContain("<loc>https://example.com/sitemap-2.xml</loc>");
    // index lastmod falls back to today
    expect(r.content).toContain("<lastmod>2026-11-14</lastmod>");
    expect(r.files[2].content.match(/<url>/g)?.length).toBe(1);
    expect(codes(r)).toContain("over-limit");
  });

  it("accepts a decimal comma in the fixed priority", () => {
    const r = generateSitemap(
      input({ urls: "https://example.com/", priorityMode: "fixed", priorityValue: "0,5" }),
    );
    expect(r.entries[0].priority).toBe("0.5");
  });

  it("keeps a trailing ,1 inside a query string", () => {
    const r = generateSitemap(input({ urls: "https://example.com/?ids=3,1" }));
    expect(r.entries[0].loc).toBe("https://example.com/?ids=3,1");
  });

  it("rejects an impossible fixed lastmod date", () => {
    const r = generateSitemap(
      input({ urls: "https://example.com/", lastmodMode: "fixed", lastmodValue: "2024-13-45" }),
    );
    expect(codes(r)).toContain("bad-lastmod");
  });

  // Regression: without a base URL the index pointed at https://example.com/sitemap-1.xml.
  it("points the index at the URLs' own host when no base URL is given", () => {
    const urls = Array.from(
      { length: MAX_URLS_PER_FILE + 1 },
      (_, i) => `https://mysite.org/p${i}`,
    );
    urls.push("https://other.net/x");
    const r = generateSitemap(input({ urls: urls.join("\n") }));
    expect(r.content).toContain("<loc>https://mysite.org/sitemap-1.xml</loc>");
    expect(r.content).toContain("<loc>https://mysite.org/sitemap-2.xml</loc>");
    expect(r.content).not.toContain("example.com");
  });

  // Regression: /a#top was written as its own <loc>.
  it("drops #fragments and deduplicates what is left", () => {
    const r = generateSitemap(
      input({ urls: "https://ex.com/a\nhttps://ex.com/a#top\nhttps://ex.com/b#x" }),
    );
    expect(r.entries.map((e) => e.loc)).toEqual(["https://ex.com/a", "https://ex.com/b"]);
    expect(codes(r)).toContain("duplicate");
  });

  // Regression: 2026-13-45 and a time without a time zone were written as they were.
  it("validates per-row dates and leaves bad ones out with a warning", () => {
    const r = generateSitemap(
      input({
        urls: "https://ex.com/a, 2026-13-45\nhttps://ex.com/b, 2026-02-30\nhttps://ex.com/c, 2026-09-20T14:30\nhttps://ex.com/d, 2026-09-20T14:30+03:00",
      }),
    );
    expect(r.entries.map((e) => e.loc)).toEqual([
      "https://ex.com/a",
      "https://ex.com/b",
      "https://ex.com/c",
      "https://ex.com/d",
    ]);
    expect(r.entries.map((e) => e.lastmod)).toEqual([
      undefined,
      undefined,
      undefined,
      "2026-09-20T14:30+03:00",
    ]);
    const issue = r.issues.find((i) => i.code === "bad-lastmod");
    expect(issue?.value).toBe("2026-13-45");
    expect(issue?.count).toBe(3);
  });

  // Regression: in "today" mode a row with a bad date got today's date, though the
  // warning said the element was left out.
  it("leaves lastmod out for a row with a bad date even in today mode", () => {
    const r = generateSitemap(
      input({
        urls: "https://ex.com/a, 2026-13-45\nhttps://ex.com/b",
        lastmodMode: "today",
      }),
    );
    expect(r.entries.map((e) => e.lastmod)).toEqual([undefined, "2026-11-14"]);
    expect(r.content.match(/<lastmod>/g)).toHaveLength(1);
    expect(r.issues.find((i) => i.code === "bad-lastmod")?.message).toContain("left out");
  });

  // Regression: "https://example.com/c, 14.11.2026" became the URL ".../c,%2014.11.2026".
  it("reads day-first dates after a comma as lastmod, never as part of the URL", () => {
    const r = generateSitemap(
      input({
        urls: [
          "https://ex.com/a, 14.11.2026",
          "https://ex.com/b, 1.2.2026, weekly",
          "https://ex.com/c, 14/11/2026",
          "https://ex.com/d, 31.02.2026",
          "https://ex.com/e | 05.06.2025",
        ].join("\n"),
      }),
    );
    expect(r.entries.map((e) => e.loc)).toEqual([
      "https://ex.com/a",
      "https://ex.com/b",
      "https://ex.com/c",
      "https://ex.com/d",
      "https://ex.com/e",
    ]);
    expect(r.entries.map((e) => e.lastmod)).toEqual([
      "2026-11-14",
      "2026-02-01",
      "2026-11-14",
      undefined,
      "2025-06-05",
    ]);
    expect(r.entries[1].changefreq).toBe("weekly");
    const issue = r.issues.find((i) => i.code === "bad-lastmod");
    expect(issue?.value).toBe("31.02.2026");
    expect(issue?.count).toBe(1);
  });

  it("requires a time zone on a fixed timestamp", () => {
    const r = generateSitemap(
      input({ urls: "https://ex.com/", lastmodMode: "fixed", lastmodValue: "2026-09-20T14:30" }),
    );
    expect(codes(r)).toContain("bad-lastmod");
    expect(r.entries[0].lastmod).toBeUndefined();
  });

  // Regression: an emptied priority field wrote <priority>0.0</priority> everywhere.
  it("omits priority when the fixed value is empty", () => {
    const r = generateSitemap(
      input({ urls: "https://ex.com/a", priorityMode: "fixed", priorityValue: "  " }),
    );
    expect(r.entries[0].priority).toBeUndefined();
    expect(
      generateSitemap(
        input({ urls: "https://ex.com/a", priorityMode: "fixed", priorityValue: "0,7" }),
      ).entries[0].priority,
    ).toBe("0.7");
  });

  // Regression: a 2,115-character URL was written without a word.
  it("skips URLs of 2,048 characters or more with a too-long warning", () => {
    const long = `https://ex.com/${"a".repeat(2100)}`;
    const r = generateSitemap(input({ urls: `${long}\nhttps://ex.com/ok` }));
    expect(r.entries.map((e) => e.loc)).toEqual(["https://ex.com/ok"]);
    expect(codes(r)).toContain("too-long");
    expect(r.skippedCount).toBe(1);
  });

  // Regression: a list over 50 MB came out as one file with "split it yourself".
  it("splits by size as well as by count", () => {
    const path = "x".repeat(1400);
    const urls = Array.from({ length: 40000 }, (_, i) => `https://ex.com/${path}/${i}`).join("\n");
    const r = generateSitemap(input({ urls }));
    expect(r.files.length).toBeGreaterThan(2);
    expect(r.files[0].content).toContain("<sitemapindex");
    for (const f of r.files.slice(1)) expect(f.content.length).toBeLessThanOrEqual(52428800);
    expect(codes(r)).toContain("over-size");
    const total = r.files
      .slice(1)
      .reduce((n, f) => n + (f.content.match(/<url>/g)?.length ?? 0), 0);
    expect(total).toBe(40000);
  });

  it("does not parse absolute URLs again when only the base URL changes", () => {
    // Count URL parses by wrapping the global URL class the module uses.
    const RealURL = globalThis.URL;
    let parses = 0;
    vi.stubGlobal(
      "URL",
      class extends RealURL {
        constructor(url: string | URL, base?: string | URL) {
          super(url, base);
          parses++;
        }
      },
    );
    const urls = Array.from(
      { length: 5000 },
      (_, i) => `https://reparse-check.example/section/page-${i}`,
    ).join("\n");
    expect(generateSitemap(input({ urls })).urlCount).toBe(5000);
    expect(parses).toBeGreaterThanOrEqual(5000);
    parses = 0;
    const r = generateSitemap(input({ urls, baseUrl: "h" }));
    expect(r.urlCount).toBe(5000);
    // Only the base URL itself (and similar per-run work) may be parsed, not the list.
    expect(parses).toBeLessThan(50);
  });
});
