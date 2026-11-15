import { describe, expect, it } from "vitest";
import {
  type MetaTagInput,
  generateMetaTags,
  normalizeTwitterHandle,
} from "./meta-tag-generator.js";

const EMPTY: MetaTagInput = {
  title: "",
  description: "",
  url: "",
  siteName: "",
  imageUrl: "",
  twitterHandle: "",
  ogType: "",
  twitterCard: "",
};
const gen = (o: Partial<MetaTagInput>) => generateMetaTags({ ...EMPTY, ...o });

describe("normalizeTwitterHandle", () => {
  it("adds exactly one @ and trims", () => {
    expect(normalizeTwitterHandle("belun")).toBe("@belun");
    expect(normalizeTwitterHandle("  @@belun ")).toBe("@belun");
    expect(normalizeTwitterHandle("   ")).toBe("");
    expect(normalizeTwitterHandle("@")).toBe("");
  });
});

describe("generateMetaTags", () => {
  it("returns empty html and 'empty' statuses for empty input", () => {
    expect(gen({})).toEqual({
      html: "",
      titleLength: 0,
      descriptionLength: 0,
      titleStatus: "empty",
      descriptionStatus: "empty",
    });
  });

  it("generates the full tag set with defaults for og:type and twitter:card", () => {
    const r = gen({
      title: "  My Page  ",
      description: "About it",
      url: "https://ex.com/",
      siteName: "Ex",
      imageUrl: "https://ex.com/i.png",
      twitterHandle: "ex",
    });
    expect(r.html).toBe(
      [
        "<title>My Page</title>",
        '<meta name="description" content="About it">',
        '<link rel="canonical" href="https://ex.com/">',
        "",
        "<!-- Open Graph -->",
        '<meta property="og:type" content="website">',
        '<meta property="og:title" content="My Page">',
        '<meta property="og:description" content="About it">',
        '<meta property="og:url" content="https://ex.com/">',
        '<meta property="og:site_name" content="Ex">',
        '<meta property="og:image" content="https://ex.com/i.png">',
        "",
        "<!-- Twitter Card -->",
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="My Page">',
        '<meta name="twitter:description" content="About it">',
        '<meta name="twitter:image" content="https://ex.com/i.png">',
        '<meta name="twitter:site" content="@ex">',
      ].join("\n"),
    );
    expect(r.titleLength).toBe(7);
  });

  it("honours a custom og:type and twitter:card", () => {
    const r = gen({ title: "T", ogType: "article", twitterCard: "summary" });
    expect(r.html).toContain('<meta property="og:type" content="article">');
    expect(r.html).toContain('<meta name="twitter:card" content="summary">');
  });

  it("escapes &, <, > and quotes", () => {
    const r = gen({ title: 'Tom & "Jerry" <3' });
    expect(r.html).toContain("<title>Tom &amp; &quot;Jerry&quot; &lt;3</title>");
    expect(r.html).toContain('content="Tom &amp; &quot;Jerry&quot; &lt;3"');
  });

  it("rates title length: <30 short, 30..60 ok, >60 long", () => {
    expect(gen({ title: "a".repeat(29) }).titleStatus).toBe("short");
    expect(gen({ title: "a".repeat(30) }).titleStatus).toBe("ok");
    expect(gen({ title: "a".repeat(60) }).titleStatus).toBe("ok");
    expect(gen({ title: "a".repeat(61) }).titleStatus).toBe("long");
  });

  it("rates description length: <70 short, 70..160 ok, >160 long", () => {
    expect(gen({ description: "a".repeat(69) }).descriptionStatus).toBe("short");
    expect(gen({ description: "a".repeat(70) }).descriptionStatus).toBe("ok");
    expect(gen({ description: "a".repeat(160) }).descriptionStatus).toBe("ok");
    expect(gen({ description: "a".repeat(161) }).descriptionStatus).toBe("long");
  });

  it("keeps Cyrillic text intact", () => {
    expect(gen({ title: "Привет мир" }).html).toContain("<title>Привет мир</title>");
  });
});
