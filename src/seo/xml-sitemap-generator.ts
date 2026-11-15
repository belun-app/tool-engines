/**
 * Builds an XML sitemap (sitemaps.org protocol) from a list of URLs with optional lastmod,
 * changefreq and priority, escaping and checking every URL.
 */

export type ChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export type LastmodMode = "none" | "today" | "fixed";
export type PriorityMode = "none" | "fixed" | "auto";

export interface SitemapInput {
  /** Raw pasted list: one URL per line, optional `, lastmod, changefreq, priority` overrides. */
  urls: string;
  /** Used to resolve `/about` style paths and to detect URLs from a different host. */
  baseUrl: string;
  lastmodMode: LastmodMode;
  /** YYYY-MM-DD (or a full W3C datetime) used when lastmodMode is "fixed". */
  lastmodValue: string;
  /** Empty string omits the changefreq element entirely. */
  changefreq: ChangeFreq | "";
  priorityMode: PriorityMode;
  /** 0.0-1.0 used when priorityMode is "fixed". */
  priorityValue: string;
  /** YYYY-MM-DD for the "today" mode. Passed in so the engine stays deterministic. */
  today: string;
}

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export type SitemapIssueCode =
  | "empty"
  | "invalid-url"
  | "duplicate"
  | "mixed-host"
  | "insecure"
  | "bad-lastmod"
  | "too-long"
  | "over-limit"
  | "over-size";

export interface SitemapIssue {
  level: "warning" | "error";
  code: SitemapIssueCode;
  /** English wording; the page may swap it for a translation keyed on `code`. */
  message: string;
  /** The URL or value the issue refers to, for templated translations. */
  value?: string;
  /** How many entries the issue covers, when it was collapsed into one row. */
  count?: number;
}

export interface SitemapFile {
  name: string;
  content: string;
}

export interface SitemapResult {
  /** The file shown in the preview: the sitemap itself, or the index when it was split. */
  content: string;
  files: SitemapFile[];
  entries: SitemapEntry[];
  urlCount: number;
  skippedCount: number;
  bytes: number;
  issues: SitemapIssue[];
}

/** Hard caps from sitemaps.org, enforced by Google and Bing alike. */
export const MAX_URLS_PER_FILE = 50000;
export const MAX_BYTES_PER_FILE = 52428800;
/** sitemaps.org: a <loc> must be shorter than 2,048 characters (Yandex reports it as "URL too long"). */
export const MAX_URL_LENGTH = 2048;

export const CHANGE_FREQS: ChangeFreq[] = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
];

const FREQ_SET = new Set<string>(CHANGE_FREQS);
/** W3C Datetime as sitemaps.org accepts it: a time needs its time zone (Z or ±hh:mm). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
/** Anything that is plainly meant as a date, valid or not (2026-13-45, 2026-09-20T14:30). */
const DATE_LIKE_RE = /^\d{4}-\d{1,2}-\d{1,2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** A day-first date as typed in Europe and Russia: 14.11.2026, 1.2.2026, 14/11/2026. */
const DMY_RE = /^(\d{1,2})([./])(\d{1,2})\2(\d{4})$/;
const PRIORITY_RE = /^[01](?:[.,]\d+)?$/;

/** W3C date format and a date that exists: 2024-02-29 passes, 2024-13-45 or 25:00 do not. */
function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return false;
  }
  const time = value.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (time && (Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] ?? 0) > 59)) {
    return false;
  }
  return true;
}

/**
 * An unescaped ampersand in a query string makes the whole file fail XML parsing,
 * which is the most common reason a hand-rolled sitemap gets rejected.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatPriority(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped.toFixed(1);
}

/** Home page first, then one step down per path segment, floored at 0.3. */
export function priorityForDepth(depth: number): string {
  const table = ["1.0", "0.8", "0.6", "0.5", "0.4"];
  return table[depth] ?? "0.3";
}

function stripListMarkup(raw: string): string {
  return raw
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^["'<]+/, "")
    .replace(/["'>,;]+$/, "")
    .trim();
}

function normalizeBase(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return "";
  }
}

type Override = { kind: "lastmod" | "bad-lastmod" | "changefreq" | "priority"; value: string };

function classify(part: string): Override | null {
  const value = part.trim();
  if (!value) return null;
  if (DATE_LIKE_RE.test(value)) {
    return isRealDate(value) ? { kind: "lastmod", value } : { kind: "bad-lastmod", value };
  }
  // A day-first date is still a date field, never part of the URL: converted to
  // YYYY-MM-DD when the day exists, reported and left out when it does not.
  const dmy = value.match(DMY_RE);
  if (dmy) {
    const iso = `${dmy[4]}-${dmy[3].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return isRealDate(iso) ? { kind: "lastmod", value: iso } : { kind: "bad-lastmod", value };
  }
  if (FREQ_SET.has(value.toLowerCase())) return { kind: "changefreq", value: value.toLowerCase() };
  if (PRIORITY_RE.test(value)) {
    return { kind: "priority", value: formatPriority(Number(value.replace(",", "."))) };
  }
  return null;
}

interface ParsedLine {
  raw: string;
  loc: string;
  /** Set when the line's URL is too long for a sitemap: the line is skipped. */
  tooLong?: boolean;
  /** A per-row date that is not a W3C date; the element is left out. */
  badLastmod?: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
  host: string;
  depth: number;
}

function parseLine(raw: string, base: string): ParsedLine | null {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;

  const separator = /[\t|]/.test(line) ? /[\t|]/ : /,/;
  const parts = line.split(separator);

  // Walk from the left until a field looks like an override; everything before
  // that belongs to the URL, so commas inside a query string survive intact.
  // Inside a query string a comma with no space after it is part of the URL
  // ("?ids=3,1"), so with comma separators an override there needs ", " before it.
  const gluedToQuery = (urlSoFar: string, part: string) =>
    separator.source === "," && urlSoFar.includes("?") && !/^\s/.test(part);
  let urlText = parts[0] ?? "";
  let index = 1;
  while (
    index < parts.length &&
    (classify(parts[index]) === null || gluedToQuery(urlText, parts[index]))
  ) {
    urlText = `${urlText},${parts[index]}`;
    index += 1;
  }
  urlText = stripListMarkup(urlText);
  if (!urlText) return null;

  const overrides: Partial<ParsedLine> = {};
  for (; index < parts.length; index += 1) {
    const hit = classify(parts[index]);
    if (!hit) continue;
    if (hit.kind === "lastmod") overrides.lastmod = hit.value;
    if (hit.kind === "bad-lastmod") overrides.badLastmod = hit.value;
    if (hit.kind === "changefreq") overrides.changefreq = hit.value;
    if (hit.kind === "priority") overrides.priority = hit.value;
  }

  const unreadable: ParsedLine = { raw: line, loc: "", host: "", depth: 0 };

  let candidate = urlText;
  if (!/^https?:\/\//i.test(candidate)) {
    if (candidate.startsWith("/") && base) candidate = base + candidate;
    else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(candidate))
      candidate = `https://${candidate}`;
    // Only treat the leftovers as a relative path when they could plausibly be
    // one, otherwise a prose line like "not a url" turns into a fabricated entry.
    else if (base && !/\s/.test(candidate)) candidate = `${base}/${candidate}`;
    else return unreadable;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return unreadable;
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return unreadable;
  // Crawlers ignore the #fragment, so /a#top is the same page as /a.
  url.hash = "";
  if (url.href.length >= MAX_URL_LENGTH) return { ...unreadable, loc: url.href, tooLong: true };

  return {
    raw: line,
    // href normalises spaces, IDN hosts, and non-ASCII paths into percent-encoded
    // form, which is what the sitemap spec asks for.
    loc: url.href,
    host: url.host,
    depth: url.pathname.split("/").filter(Boolean).length,
    ...overrides,
  };
}

function buildIndex(names: string[], root: string, lastmod: string): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const name of names) {
    lines.push("  <sitemap>");
    lines.push(`    <loc>${escapeXml(`${root}/${name}`)}</loc>`);
    if (lastmod) lines.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
    lines.push("  </sitemap>");
  }
  lines.push("</sitemapindex>");
  return `${lines.join("\n")}\n`;
}

/**
 * Parsed lines, keyed by the raw line (and the base for relative ones). Typing in the
 * base-URL field re-runs the whole list; with 50,000 absolute URLs nothing about them
 * changes, so they come from here instead of being parsed again.
 */
const lineCache = new Map<string, ParsedLine | null>();
const LINE_CACHE_LIMIT = 200_000;

function parseLineCached(raw: string, base: string): ParsedLine | null {
  const key = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?["'<]*https?:\/\//i.test(raw)
    ? raw
    : `${base}\u0000${raw}`;
  const hit = lineCache.get(key);
  if (hit !== undefined) return hit;
  const parsed = parseLine(raw, base);
  if (lineCache.size >= LINE_CACHE_LIMIT) lineCache.clear();
  lineCache.set(key, parsed);
  return parsed;
}

/** The host most of the URLs share: where the split files are expected to live. */
function mainOrigin(entries: ParsedLine[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const origin = e.loc.slice(0, e.loc.indexOf("/", e.loc.indexOf("//") + 2));
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [origin, n] of counts) {
    if (n > bestCount) {
      best = origin;
      bestCount = n;
    }
  }
  return best;
}

/** One <url> block; every part is ASCII (loc is percent-encoded), so length = bytes. */
function urlBlock(entry: SitemapEntry): string {
  let block = `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n`;
  if (entry.lastmod) block += `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n`;
  if (entry.changefreq) block += `    <changefreq>${entry.changefreq}</changefreq>\n`;
  if (entry.priority) block += `    <priority>${entry.priority}</priority>\n`;
  return `${block}  </url>\n`;
}

interface Body {
  unique: ParsedLine[];
  duplicates: number;
  entries: SitemapEntry[];
  contents: string[];
  issues: SitemapIssue[];
  defaultLastmod: string;
}

/**
 * The last build, reused when the parsed lines (same objects, same order) and the
 * per-entry options are unchanged — typing a base URL over 50,000 absolute URLs changes
 * nothing in the files themselves, only possibly the index.
 */
let memo: { parsed: ParsedLine[]; key: string; body: Body } | null = null;

function sameLines(a: ParsedLine[], b: ParsedLine[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function buildBody(parsed: ParsedLine[], input: SitemapInput): Body {
  const bodyIssues: SitemapIssue[] = [];
  const seen = new Set<string>();
  const unique: ParsedLine[] = [];
  let duplicates = 0;
  let firstDuplicate = "";
  for (const entry of parsed) {
    if (seen.has(entry.loc)) {
      duplicates += 1;
      if (!firstDuplicate) firstDuplicate = entry.loc;
      continue;
    }
    seen.add(entry.loc);
    unique.push(entry);
  }

  if (duplicates > 0) {
    bodyIssues.push({
      level: "warning",
      code: "duplicate",
      message: `${duplicates} duplicate URL${duplicates === 1 ? "" : "s"} removed, starting with ${firstDuplicate}. A sitemap should list each canonical URL exactly once.`,
      value: firstDuplicate,
      count: duplicates,
    });
  }

  const hosts = new Set(unique.map((entry) => entry.host));
  if (hosts.size > 1) {
    bodyIssues.push({
      level: "warning",
      code: "mixed-host",
      message: `These URLs cover ${hosts.size} different hosts (${Array.from(hosts).slice(0, 3).join(", ")}). A sitemap may only list URLs from the host it is published on, unless you verify cross-submission in Search Console.`,
      count: hosts.size,
    });
  }

  const insecure = unique.filter((entry) => entry.loc.startsWith("http://")).length;
  if (insecure > 0) {
    bodyIssues.push({
      level: "warning",
      code: "insecure",
      message: `${insecure} URL${insecure === 1 ? " uses" : "s use"} http://. If your site redirects to https, list the https version so crawlers skip the redirect hop.`,
      count: insecure,
    });
  }

  let defaultLastmod = "";
  if (input.lastmodMode === "today") defaultLastmod = input.today;
  if (input.lastmodMode === "fixed") {
    const value = input.lastmodValue.trim();
    if (value && !isRealDate(value)) {
      bodyIssues.push({
        level: "error",
        code: "bad-lastmod",
        message: `"${value}" is not a W3C date. Use YYYY-MM-DD, or a full timestamp like 2026-09-20T14:30:00+00:00. The element was left out.`,
        value,
      });
    } else {
      defaultLastmod = value;
    }
  }

  // A decimal comma ("0,5", as typed in a Russian locale) is accepted like per-line overrides.
  // An emptied field means "no value", not 0.0.
  const rawPriority = input.priorityValue.trim().replace(",", ".");
  const fixedPriorityNumber = rawPriority === "" ? Number.NaN : Number(rawPriority);
  const fixedPriority = formatPriority(fixedPriorityNumber);

  const entries: SitemapEntry[] = unique.map((entry) => {
    const built: SitemapEntry = { loc: entry.loc };
    // A row whose own date was unreadable gets no lastmod at all (as the warning says),
    // not today's or the fixed date in its place.
    const lastmod = entry.lastmod ?? (entry.badLastmod ? "" : defaultLastmod);
    if (lastmod) built.lastmod = lastmod;
    const changefreq = entry.changefreq ?? input.changefreq;
    if (changefreq) built.changefreq = changefreq;
    if (entry.priority) built.priority = entry.priority;
    else if (input.priorityMode === "auto") built.priority = priorityForDepth(entry.depth);
    else if (input.priorityMode === "fixed" && Number.isFinite(fixedPriorityNumber)) {
      built.priority = fixedPriority;
    }
    return built;
  });

  // Split by both caps: 50,000 URLs and 50 MB per file, whichever comes first.
  const HEAD =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  const TAIL = "</urlset>\n";
  const chunks: string[][] = [[]];
  let chunkBytes = HEAD.length + TAIL.length;
  for (const entry of entries) {
    const block = urlBlock(entry);
    let current = chunks[chunks.length - 1];
    if (
      current.length >= MAX_URLS_PER_FILE ||
      (current.length > 0 && chunkBytes + block.length > MAX_BYTES_PER_FILE)
    ) {
      current = [];
      chunks.push(current);
      chunkBytes = HEAD.length + TAIL.length;
    }
    current.push(block);
    chunkBytes += block.length;
  }
  const contents = chunks.map((blocks) => HEAD + blocks.join("") + TAIL);
  return { unique, duplicates, entries, contents, issues: bodyIssues, defaultLastmod };
}

export function generateSitemap(input: SitemapInput): SitemapResult {
  const issues: SitemapIssue[] = [];
  const base = normalizeBase(input.baseUrl);

  const parsed: ParsedLine[] = [];
  let invalid = 0;
  let firstInvalid = "";
  let tooLong = 0;
  let firstTooLong = "";
  let badDates = 0;
  let firstBadDate = "";

  for (const line of input.urls.split(/\r?\n/)) {
    const entry = parseLineCached(line, base);
    if (!entry) continue;
    if (entry.tooLong) {
      tooLong += 1;
      if (!firstTooLong) firstTooLong = `${entry.loc.slice(0, 80)}…`;
      continue;
    }
    if (!entry.loc) {
      invalid += 1;
      if (!firstInvalid) firstInvalid = entry.raw;
      continue;
    }
    if (entry.badLastmod) {
      badDates += 1;
      if (!firstBadDate) firstBadDate = entry.badLastmod;
    }
    parsed.push(entry);
  }

  if (tooLong > 0) {
    issues.push({
      level: "warning",
      code: "too-long",
      message: `${tooLong} URL${tooLong === 1 ? " is" : "s are"} ${MAX_URL_LENGTH} characters or longer and ${tooLong === 1 ? "was" : "were"} skipped, starting with ${firstTooLong} Search engines reject such entries.`,
      value: firstTooLong,
      count: tooLong,
    });
  }

  if (badDates > 0) {
    issues.push({
      level: "warning",
      code: "bad-lastmod",
      message: `"${firstBadDate}" is not a W3C date${badDates > 1 ? ` (and ${badDates - 1} more row dates)` : ""}. Use YYYY-MM-DD, or a full timestamp like 2026-09-20T14:30:00+00:00. The element was left out.`,
      value: firstBadDate,
      count: badDates,
    });
  }

  if (invalid > 0) {
    issues.push({
      level: "warning",
      code: "invalid-url",
      message: `${invalid} line${invalid === 1 ? "" : "s"} could not be read as a URL and ${invalid === 1 ? "was" : "were"} skipped, starting with "${firstInvalid}". Add a base URL if you pasted bare paths.`,
      value: firstInvalid,
      count: invalid,
    });
  }

  if (parsed.length === 0) {
    issues.push({
      level: "warning",
      code: "empty",
      message: "Paste one URL per line to build the sitemap.",
    });
    return {
      content: "",
      files: [],
      entries: [],
      urlCount: 0,
      skippedCount: invalid,
      bytes: 0,
      issues,
    };
  }

  const key = [
    input.lastmodMode,
    input.lastmodValue,
    input.changefreq,
    input.priorityMode,
    input.priorityValue,
    input.today,
  ].join("\u0000");
  const reuse = memo && memo.key === key && sameLines(memo.parsed, parsed);
  const { unique, duplicates, entries, contents, defaultLastmod, ...core } = reuse
    ? (memo as { body: Body }).body
    : buildBody(parsed, input);
  if (!reuse)
    memo = {
      parsed,
      key,
      body: { unique, duplicates, entries, contents, defaultLastmod, ...core },
    };
  issues.push(...core.issues);

  const files: SitemapFile[] = [];
  const skippedCount = invalid + duplicates + tooLong;

  if (contents.length === 1) {
    const content = contents[0];
    files.push({ name: "sitemap.xml", content });
    return {
      content,
      files,
      entries,
      urlCount: entries.length,
      skippedCount,
      bytes: content.length,
      issues,
    };
  }

  const names = contents.map((_, i) => `sitemap-${i + 1}.xml`);
  for (let i = 0; i < contents.length; i += 1) {
    files.push({ name: names[i], content: contents[i] });
  }
  // The index must point where the files will live: the base URL, or else the host the
  // URLs themselves are on — never a placeholder domain.
  const root = base || mainOrigin(unique);
  const index = buildIndex(names, root, defaultLastmod || input.today);
  files.unshift({ name: "sitemap.xml", content: index });

  const bySize = entries.length <= MAX_URLS_PER_FILE;
  issues.push({
    level: "warning",
    code: bySize ? "over-size" : "over-limit",
    message: bySize
      ? `One sitemap may be at most 50 MB uncompressed, so the list was split into ${contents.length} files plus a sitemap index. Submit sitemap.xml — the index points at the rest.`
      : `One sitemap holds at most 50,000 URLs, so the list was split into ${contents.length} files plus a sitemap index. Submit sitemap.xml — the index points at the rest.`,
    count: contents.length,
  });

  return {
    content: index,
    files,
    entries,
    urlCount: entries.length,
    skippedCount,
    bytes: files.reduce((total, file) => total + file.content.length, 0),
    issues,
  };
}
