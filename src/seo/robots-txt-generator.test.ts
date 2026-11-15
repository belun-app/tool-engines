import { describe, expect, it } from "vitest";
import { AI_CRAWLERS, type RobotsTxtInput, generateRobotsTxt } from "./robots-txt-generator.js";

const HEADER_TEXT = "robots.txt — generated with example.com";
const HEADER = `# ${HEADER_TEXT}`;
const input = (o: Partial<RobotsTxtInput>): RobotsTxtInput => ({
  headerComment: HEADER_TEXT,
  mode: "allow-all",
  disallow: "",
  allow: "",
  crawlDelay: "",
  blockAiCrawlers: false,
  blockedBots: [],
  sitemaps: "",
  ...o,
});
const codes = (r: ReturnType<typeof generateRobotsTxt>) => r.issues.map((i) => i.code);

describe("generateRobotsTxt", () => {
  it("writes no header comment by default", () => {
    const r = generateRobotsTxt(input({ headerComment: undefined }));
    expect(r.content).toBe("User-agent: *\nDisallow:\n");
    expect(generateRobotsTxt(input({ headerComment: false })).content).toBe(r.content);
    expect(generateRobotsTxt(input({ headerComment: "  " })).content).toBe(r.content);
  });

  it("writes a multi-line header comment as # lines", () => {
    const r = generateRobotsTxt(input({ headerComment: "Line one\n\n# Line two" }));
    expect(r.content).toBe("# Line one\n#\n# Line two\n\nUser-agent: *\nDisallow:\n");
  });

  it("allow-all writes an empty Disallow and warns about the missing sitemap", () => {
    const r = generateRobotsTxt(input({}));
    expect(r.content).toBe(`${HEADER}\n\nUser-agent: *\nDisallow:\n`);
    expect(r).toMatchObject({ groupCount: 1, ruleCount: 1, sitemapCount: 0 });
    expect(codes(r)).toEqual(["no-sitemap"]);
  });

  it("disallow-all blocks the whole site with a warning", () => {
    const r = generateRobotsTxt(input({ mode: "disallow-all", sitemaps: "https://a.com/s.xml" }));
    expect(r.content).toBe(
      `${HEADER}\n\nUser-agent: *\nDisallow: /\n\nSitemap: https://a.com/s.xml\n`,
    );
    expect(codes(r)).toEqual(["block-all"]);
  });

  it("custom mode normalises pasted paths, URLs and directive lines", () => {
    const r = generateRobotsTxt(
      input({
        mode: "custom",
        disallow:
          "/admin\nprivate/\nDisallow: /tmp\nhttps://ex.com/cgi-bin/\n# comment\n\n/admin\n*.pdf$",
        allow: "/admin/public",
        crawlDelay: "2,5",
        blockAiCrawlers: true,
        blockedBots: ["AhrefsBot", "  ", "AhrefsBot"],
        sitemaps: "example.com/sitemap.xml\nSitemap: https://example.com/s2.xml",
      }),
    );
    expect(r.content).toBe(
      [
        HEADER,
        "",
        "User-agent: *",
        "Disallow: /admin",
        "Disallow: /private/",
        "Disallow: /tmp",
        "Disallow: /cgi-bin/",
        "Disallow: *.pdf$",
        "Allow: /admin/public",
        "Crawl-delay: 2.5",
        "",
        "# AI training and answer-engine crawlers",
        ...AI_CRAWLERS.map((a) => `User-agent: ${a}`),
        "Disallow: /",
        "",
        "# Blocked crawlers",
        "User-agent: AhrefsBot",
        "Disallow: /",
        "",
        "Sitemap: https://example.com/sitemap.xml",
        "Sitemap: https://example.com/s2.xml",
        "",
      ].join("\n"),
    );
    // 5 disallow + 1 allow + AI group + blocked group
    expect(r).toMatchObject({ groupCount: 3, ruleCount: 8, sitemapCount: 2 });
    expect(codes(r)).toEqual(["crawl-delay-google", "sensitive-path"]);
    expect(r.issues[1].value).toBe("/admin");
  });

  it("a whole URL without a path becomes the root", () => {
    const r = generateRobotsTxt(input({ mode: "custom", disallow: "https://ex.com" }));
    expect(r.content).toContain("Disallow: /\n");
  });

  it("custom mode with no paths allows everything and warns", () => {
    const r = generateRobotsTxt(input({ mode: "custom" }));
    expect(r.content).toContain("User-agent: *\nDisallow:\n");
    expect(codes(r)).toContain("no-rules");
  });

  it("flags a path listed under both Allow and Disallow", () => {
    const r = generateRobotsTxt(input({ mode: "custom", disallow: "/x", allow: "x" }));
    expect(r.issues).toContainEqual(
      expect.objectContaining({ code: "conflict", level: "error", value: "/x" }),
    );
  });

  it("rejects invalid crawl delays and leaves the directive out", () => {
    for (const crawlDelay of ["abc", "0", "-1"]) {
      const r = generateRobotsTxt(input({ crawlDelay }));
      expect(codes(r)).toContain("crawl-delay-invalid");
      expect(r.content).not.toContain("Crawl-delay");
    }
  });

  it("reads the crawl delay in the page language", () => {
    // A naive comma swap would read EN "1,000" as 1.
    expect(generateRobotsTxt(input({ crawlDelay: "1,000", lang: "en" })).content).toContain(
      "Crawl-delay: 1000",
    );
    expect(generateRobotsTxt(input({ crawlDelay: "1,000", lang: "ru" })).content).toContain(
      "Crawl-delay: 1\n",
    );
    expect(generateRobotsTxt(input({ crawlDelay: "2,5", lang: "ru" })).content).toContain(
      "Crawl-delay: 2.5",
    );
  });

  it("rounds the crawl delay to one decimal", () => {
    expect(generateRobotsTxt(input({ crawlDelay: "1.26" })).content).toContain("Crawl-delay: 1.3");
  });

  it("keeps an empty pasted Disallow line from becoming a block-all rule", () => {
    const r = generateRobotsTxt(input({ mode: "custom", disallow: "Disallow:" }));
    expect(r.content).not.toContain("Disallow: /\n");
  });

  it("does not turn a sitemap path into a host name", () => {
    const r = generateRobotsTxt(input({ sitemaps: "/sitemap.xml" }));
    expect(r.content).not.toContain("Sitemap: https://sitemap.xml");
    expect(r.sitemapCount).toBe(0);
    expect(r.issues.find((i) => i.code === "sitemap-relative")?.value).toBe("/sitemap.xml");
  });
});
