/**
 * Builds a robots.txt file from allow and disallow rules, a crawl delay, sitemap URLs and
 * bots to block (AI crawlers among them), and reports problems with the rules.
 */

import { type NumLang, parseDecimal } from "../_num.js";

export type RobotsMode = "allow-all" | "disallow-all" | "custom";

export interface RobotsTxtInput {
  mode: RobotsMode;
  disallow: string;
  allow: string;
  crawlDelay: string;
  /** Page language the crawl delay was typed in: "1,5" is 1.5, EN "1,000" is 1000. */
  lang?: NumLang;
  blockAiCrawlers: boolean;
  blockedBots: string[];
  sitemaps: string;
  /**
   * Comment written at the top of the file, one `# ` line per line of text. Off by default
   * (`undefined`, `false` or an empty string write no comment).
   */
  headerComment?: string | false;
}

export type RobotsIssueCode =
  | "crawl-delay-invalid"
  | "crawl-delay-google"
  | "block-all"
  | "no-rules"
  | "conflict"
  | "sensitive-path"
  | "no-sitemap"
  | "sitemap-relative";

export interface RobotsIssue {
  level: "warning" | "error";
  code: RobotsIssueCode;
  /** English wording; the page may swap it for a translation keyed on `code`. */
  message: string;
  /** The path or value the issue refers to, for templated translations. */
  value?: string;
}

export interface RobotsTxtResult {
  content: string;
  groupCount: number;
  ruleCount: number;
  sitemapCount: number;
  issues: RobotsIssue[];
}

/** User agents used to gather training data or answer chat queries, as of 2026. */
export const AI_CRAWLERS: string[] = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "Google-Extended",
  "CCBot",
  "PerplexityBot",
  "Applebot-Extended",
  "Bytespider",
  "Amazonbot",
  "Meta-ExternalAgent",
  "FacebookBot",
  "cohere-ai",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "YouBot",
  "Timpibot",
];

/** SEO crawlers people most often want to keep off a small site. */
export const OPTIONAL_BOTS: string[] = [
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "BLEXBot",
  "PetalBot",
];

const SENSITIVE_HINTS = [
  "admin",
  "login",
  "private",
  "secret",
  "backup",
  "password",
  "config",
  "database",
  ".env",
];

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Accepts what people actually paste: bare paths, whole URLs, and lines copied
 * straight out of an existing robots.txt with the directive still attached.
 */
function normalizePath(raw: string): string {
  let path = raw.replace(/^(?:dis)?allow\s*:\s*/i, "").trim();
  // An empty "Disallow:" / "Allow:" line means "no rule" (allow everything), not "/".
  if (!path) return "";
  const withHost = path.match(/^https?:\/\/[^/]+(\/.*)?$/i);
  if (withHost) path = withHost[1] ?? "/";
  if (!path.startsWith("/") && !path.startsWith("*")) path = `/${path}`;
  return path;
}

/**
 * Sitemap lines must be absolute URLs. A bare host ("example.com/sitemap.xml")
 * gets https:// added; a root-relative path ("/sitemap.xml") has no host to
 * resolve against, so it is returned as null and reported.
 */
function normalizeSitemap(raw: string): string | null {
  const value = raw.replace(/^sitemap\s*:\s*/i, "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return null;
  return `https://${value}`;
}

function parseCrawlDelay(raw: string, lang: NumLang = "en"): number | null {
  const value = raw.trim();
  if (!value) return null;
  const result = parseDecimal(value, lang);
  if (!result.ok || result.value <= 0) return null;
  return Math.round(result.value * 10) / 10;
}

export function generateRobotsTxt(input: RobotsTxtInput): RobotsTxtResult {
  const issues: RobotsIssue[] = [];

  const disallowPaths = unique(splitLines(input.disallow).map(normalizePath).filter(Boolean));
  const allowPaths = unique(splitLines(input.allow).map(normalizePath).filter(Boolean));
  const sitemapLines = splitLines(input.sitemaps);
  const sitemaps = unique(
    sitemapLines.map(normalizeSitemap).filter((url): url is string => Boolean(url)),
  );
  for (const line of sitemapLines) {
    if (normalizeSitemap(line) !== null) continue;
    const value = line.replace(/^sitemap\s*:\s*/i, "").trim();
    issues.push({
      level: "error",
      code: "sitemap-relative",
      message: `Sitemap "${value}" must be a full URL, such as https://example.com${value}. The line was left out.`,
      value,
    });
  }
  const crawlDelay = parseCrawlDelay(input.crawlDelay, input.lang);
  const blockedBots = unique(input.blockedBots.map((bot) => bot.trim()).filter(Boolean));

  if (input.crawlDelay.trim() && crawlDelay === null) {
    issues.push({
      level: "error",
      code: "crawl-delay-invalid",
      message: "Crawl-delay must be a positive number of seconds. The directive was left out.",
    });
  }
  if (crawlDelay !== null) {
    issues.push({
      level: "warning",
      code: "crawl-delay-google",
      message:
        "Googlebot ignores Crawl-delay. Use the crawl rate setting in Search Console instead.",
    });
  }

  const lines: string[] = [];
  if (typeof input.headerComment === "string" && input.headerComment.trim()) {
    for (const line of input.headerComment.trim().split(/\r?\n/)) {
      lines.push(line.trim() ? `# ${line.trim().replace(/^#\s*/, "")}` : "#");
    }
    lines.push("");
  }
  let groupCount = 0;
  let ruleCount = 0;

  lines.push("User-agent: *");
  groupCount += 1;

  if (input.mode === "disallow-all") {
    lines.push("Disallow: /");
    ruleCount += 1;
    issues.push({
      level: "warning",
      code: "block-all",
      message:
        "This blocks every crawler from the whole site. Pages already indexed will drop out of search results.",
    });
  } else if (input.mode === "allow-all") {
    lines.push("Disallow:");
    ruleCount += 1;
  } else {
    for (const path of disallowPaths) {
      lines.push(`Disallow: ${path}`);
      ruleCount += 1;
    }
    for (const path of allowPaths) {
      lines.push(`Allow: ${path}`);
      ruleCount += 1;
    }
    if (disallowPaths.length === 0 && allowPaths.length === 0) {
      lines.push("Disallow:");
      ruleCount += 1;
      issues.push({
        level: "warning",
        code: "no-rules",
        message: "No paths listed, so this file allows everything. Add a path or pick a preset.",
      });
    }
  }

  if (crawlDelay !== null) lines.push(`Crawl-delay: ${crawlDelay}`);

  if (input.mode === "custom") {
    const conflicts = disallowPaths.filter((path) => allowPaths.includes(path));
    for (const path of conflicts) {
      issues.push({
        level: "error",
        code: "conflict",
        message: `"${path}" is listed under both Allow and Disallow. Crawlers follow the longest match, so the result is undefined.`,
        value: path,
      });
    }
    const exposed = disallowPaths.filter((path) =>
      SENSITIVE_HINTS.some((hint) => path.toLowerCase().includes(hint)),
    );
    if (exposed.length > 0) {
      issues.push({
        level: "warning",
        code: "sensitive-path",
        message: `robots.txt is public, so listing ${exposed[0]} tells everyone where it is. Use authentication or noindex for anything private.`,
        value: exposed[0],
      });
    }
  }

  if (input.blockAiCrawlers) {
    lines.push("");
    lines.push("# AI training and answer-engine crawlers");
    for (const agent of AI_CRAWLERS) lines.push(`User-agent: ${agent}`);
    lines.push("Disallow: /");
    groupCount += 1;
    ruleCount += 1;
  }

  if (blockedBots.length > 0) {
    lines.push("");
    lines.push("# Blocked crawlers");
    for (const agent of blockedBots) lines.push(`User-agent: ${agent}`);
    lines.push("Disallow: /");
    groupCount += 1;
    ruleCount += 1;
  }

  if (sitemaps.length > 0) {
    lines.push("");
    for (const url of sitemaps) lines.push(`Sitemap: ${url}`);
  } else {
    issues.push({
      level: "warning",
      code: "no-sitemap",
      message: "No sitemap declared. Adding one helps search engines find every page you publish.",
    });
  }

  return {
    content: `${lines.join("\n").trim()}\n`,
    groupCount,
    ruleCount,
    sitemapCount: sitemaps.length,
    issues,
  };
}
