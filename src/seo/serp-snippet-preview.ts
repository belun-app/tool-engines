/**
 * SERP snippet preview.
 *
 * Google truncates search result titles and descriptions by rendered pixel width,
 * not by character count, so "60 characters" is only a rough proxy: WWW is roughly
 * four times as wide as lll. This module measures text the way a browser would by
 * summing per-character advance widths of an Arial-compatible font: Google renders
 * result titles (20px) and snippets (14px) in Arial on the desktop SERP.
 *
 * Widths are in units per 1000 em, taken from Liberation Sans Regular (SIL Open Font
 * License 1.1), a font designed to be metric-compatible with Arial: its advance widths
 * were read from the font's hmtx table and scaled from 2048 to 1000 units per em. For
 * U+0020..U+007E they are identical to the Helvetica widths of the Adobe Core 14 AFM.
 */

export type SerpDevice = "desktop" | "mobile";

export type SerpFieldStatus = "empty" | "short" | "ok" | "long";

export interface SerpFieldPreview {
  /** The input text after whitespace normalisation. */
  text: string;
  /** What Google would actually render, with an ellipsis if it overflows. */
  display: string;
  /** Rendered width of the full text, in CSS pixels, rounded to a whole pixel. */
  pixels: number;
  /** Pixel budget for this field on the selected device. */
  maxPixels: number;
  characters: number;
  words: number;
  truncated: boolean;
  /** pixels / maxPixels as a percentage, rounded to a whole number. */
  percent: number;
  status: SerpFieldStatus;
}

export interface SerpUrlPreview {
  /** True when the input parsed as an absolute http(s) URL. */
  valid: boolean;
  /** Host with a leading www. removed, e.g. example.com. */
  domain: string;
  /** Google-style path trail, e.g. example.com > blog > serp-preview. */
  breadcrumb: string;
  /** Normalised absolute URL, or the raw input when it did not parse. */
  full: string;
  https: boolean;
}

export interface SerpKeywordCheck {
  keyword: string;
  inTitle: boolean;
  inDescription: boolean;
  inUrl: boolean;
}

/**
 * Machine-readable warning codes. The UI layer maps these to localised strings so
 * the English and Russian pages can share one engine.
 */
export type SerpWarning =
  | "title-empty"
  | "title-long"
  | "title-short"
  | "title-uppercase"
  | "title-repeats"
  | "description-empty"
  | "description-long"
  | "description-short"
  | "description-repeats-title"
  | "url-invalid"
  | "url-insecure"
  | "url-underscores"
  | "url-uppercase"
  | "url-deep"
  | "keyword-missing-title"
  | "keyword-missing-description";

export interface SerpSnippetResult {
  device: SerpDevice;
  title: SerpFieldPreview;
  description: SerpFieldPreview;
  url: SerpUrlPreview;
  keyword: SerpKeywordCheck | null;
  warnings: SerpWarning[];
  /** Rough 0-100 health score, penalised per warning. */
  score: number;
}

export interface SerpSnippetInput {
  title?: string;
  description?: string;
  url?: string;
  device?: SerpDevice;
  /** Optional focus keyword checked against title, description, and URL. */
  keyword?: string;
}

interface DeviceProfile {
  titleFontSize: number;
  titleMaxPixels: number;
  descriptionFontSize: number;
  descriptionMaxPixels: number;
}

/**
 * Desktop numbers come from Google's own result container: the title link renders at
 * 20px Arial inside a 600px column, the snippet at 14px over two lines. Mobile wraps
 * the title over two lines and the snippet over three, so the budgets are larger.
 */
const PROFILES: Record<SerpDevice, DeviceProfile> = {
  desktop: {
    titleFontSize: 20,
    titleMaxPixels: 580,
    descriptionFontSize: 14,
    descriptionMaxPixels: 920,
  },
  mobile: {
    titleFontSize: 20,
    titleMaxPixels: 920,
    descriptionFontSize: 14,
    descriptionMaxPixels: 1300,
  },
};

/** Advance widths for U+0020..U+007E, in units per 1000 em. */
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Advance widths for U+0410..U+042F (A..Ya in Cyrillic). */
const CYRILLIC_UPPER = [
  667, 656, 667, 542, 677, 667, 923, 604, 719, 719, 583, 656, 833, 722, 778, 719, 667, 722, 611,
  635, 760, 667, 740, 667, 917, 938, 792, 885, 656, 719, 1010, 722,
];

/** Advance widths for U+0430..U+044F (a..ya in Cyrillic). */
const CYRILLIC_LOWER = [
  556, 573, 531, 365, 583, 556, 669, 458, 559, 559, 438, 583, 688, 552, 556, 542, 556, 500, 458,
  500, 823, 500, 573, 521, 802, 823, 625, 719, 521, 510, 750, 542,
];

/** Punctuation and symbols that show up in real titles often enough to matter. */
const EXTRA_WIDTHS = new Map<string, number>([
  ["«", 556],
  ["»", 556],
  ["°", 400],
  ["©", 737],
  ["®", 737],
  ["–", 556],
  ["—", 1000],
  ["‘", 222],
  ["’", 222],
  ["‚", 222],
  ["“", 333],
  ["”", 333],
  ["„", 333],
  ["•", 350],
  ["…", 1000],
  ["™", 1000],
  ["Ё", 667], // Cyrillic capital Io
  ["ё", 556], // Cyrillic small io
]);

/** Anything outside the tables - CJK, emoji - falls back to a full-width guess. */
const FALLBACK_WIDTH = 556;
const WIDE_FALLBACK = 1000;
const ELLIPSIS = "…";

function advanceWidth(char: string): number {
  const code = char.codePointAt(0);
  if (code === undefined) return 0;
  if (code >= 0x20 && code <= 0x7e) return ASCII_WIDTHS[code - 0x20];
  if (code >= 0x410 && code <= 0x42f) return CYRILLIC_UPPER[code - 0x410];
  if (code >= 0x430 && code <= 0x44f) return CYRILLIC_LOWER[code - 0x430];
  const extra = EXTRA_WIDTHS.get(char);
  if (extra !== undefined) return extra;
  // Emoji, CJK, and other double-width glyphs are far wider than a Latin lowercase.
  if (code >= 0x1100) return WIDE_FALLBACK;
  return FALLBACK_WIDTH;
}

/**
 * Width of `text` rendered in Arial at `fontSize` CSS pixels.
 * Exported so callers can measure arbitrary strings without a canvas.
 */
export function measureTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) units += advanceWidth(char);
  return (units * fontSize) / 1000;
}

interface Truncation {
  display: string;
  truncated: boolean;
}

/** Cut at the last whole word that still leaves room for the ellipsis, like Google does. */
function truncateToPixels(text: string, maxPixels: number, fontSize: number): Truncation {
  if (!text) return { display: "", truncated: false };
  if (measureTextWidth(text, fontSize) <= maxPixels) return { display: text, truncated: false };

  const chars = [...text];
  const budget = maxPixels - measureTextWidth(ELLIPSIS, fontSize);
  let width = 0;
  let fits = 0;
  let lastSpace = -1;

  for (let i = 0; i < chars.length; i++) {
    const w = (advanceWidth(chars[i]) * fontSize) / 1000;
    if (width + w > budget) break;
    width += w;
    fits = i + 1;
    if (chars[i] === " ") lastSpace = i;
  }

  // Prefer a word boundary, but never throw away more than a third of what fits.
  const cut = lastSpace > fits * 0.66 ? lastSpace : fits;
  const kept = chars
    .slice(0, cut)
    .join("")
    .replace(/[\s–—,;:.-]+$/, "");
  return { display: `${kept}${ELLIPSIS}`, truncated: true };
}

function normalise(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function buildField(
  raw: string | undefined,
  maxPixels: number,
  fontSize: number,
): SerpFieldPreview {
  const text = normalise(raw);
  const pixels = measureTextWidth(text, fontSize);
  const { display, truncated } = truncateToPixels(text, maxPixels, fontSize);

  let status: SerpFieldStatus = "ok";
  if (!text) status = "empty";
  else if (truncated) status = "long";
  else if (pixels < maxPixels * 0.5) status = "short";

  return {
    text,
    display,
    pixels: Math.round(pixels),
    maxPixels,
    characters: [...text].length,
    words: text ? text.split(" ").filter(Boolean).length : 0,
    truncated,
    percent: Math.round((pixels / maxPixels) * 100),
    status,
  };
}

/**
 * Keyword-in-URL check on the readable URL: the href is percent-encoded, so a Cyrillic
 * slug ("/кофе-с-собой") would never contain the Cyrillic keyword as typed.
 */
function urlContains(href: string, needle: string): boolean {
  let readable = href;
  try {
    readable = decodeURI(href);
  } catch {
    /* malformed escapes: compare against the href as it is */
  }
  return readable.toLowerCase().includes(needle) || href.toLowerCase().includes(needle);
}

function parseUrl(raw: string | undefined): SerpUrlPreview {
  const input = (raw ?? "").trim();
  if (!input) {
    return { valid: false, domain: "", breadcrumb: "", full: "", https: false };
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { valid: false, domain: "", breadcrumb: input, full: input, https: false };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, domain: "", breadcrumb: input, full: input, https: false };
  }
  if (!parsed.hostname.includes(".")) {
    return { valid: false, domain: "", breadcrumb: input, full: input, https: false };
  }

  const domain = parsed.hostname.replace(/^www\./i, "");
  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  return {
    valid: true,
    domain,
    breadcrumb: [domain, ...segments].join(" › "),
    full: parsed.href,
    https: parsed.protocol === "https:",
  };
}

/** Does any word repeat three or more times? A cheap keyword-stuffing signal. */
function hasRepeatedWord(text: string): boolean {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 4) continue;
    const next = (counts.get(word) ?? 0) + 1;
    if (next >= 3) return true;
    counts.set(word, next);
  }
  return false;
}

const PENALTIES: Record<SerpWarning, number> = {
  "title-empty": 40,
  "title-long": 15,
  "title-short": 10,
  "title-uppercase": 5,
  "title-repeats": 8,
  "description-empty": 25,
  "description-long": 8,
  "description-short": 8,
  "description-repeats-title": 6,
  "url-invalid": 15,
  "url-insecure": 6,
  "url-underscores": 4,
  "url-uppercase": 4,
  "url-deep": 4,
  "keyword-missing-title": 10,
  "keyword-missing-description": 5,
};

export function previewSerpSnippet(input: SerpSnippetInput = {}): SerpSnippetResult {
  const device: SerpDevice = input.device === "mobile" ? "mobile" : "desktop";
  const profile = PROFILES[device];

  const title = buildField(input.title, profile.titleMaxPixels, profile.titleFontSize);
  const description = buildField(
    input.description,
    profile.descriptionMaxPixels,
    profile.descriptionFontSize,
  );
  const url = parseUrl(input.url);

  const keywordText = normalise(input.keyword).toLowerCase();
  const keyword: SerpKeywordCheck | null = keywordText
    ? {
        keyword: keywordText,
        inTitle: title.text.toLowerCase().includes(keywordText),
        inDescription: description.text.toLowerCase().includes(keywordText),
        inUrl: urlContains(url.full, keywordText.replace(/\s+/g, "-")),
      }
    : null;

  const warnings: SerpWarning[] = [];

  if (title.status === "empty") {
    warnings.push("title-empty");
  } else {
    if (title.status === "long") warnings.push("title-long");
    if (title.status === "short") warnings.push("title-short");
    const letters = [...title.text].filter((c) => /\p{L}/u.test(c));
    const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase());
    if (letters.length >= 8 && upper.length / letters.length > 0.8) {
      warnings.push("title-uppercase");
    }
    if (hasRepeatedWord(title.text)) warnings.push("title-repeats");
  }

  if (description.status === "empty") {
    warnings.push("description-empty");
  } else {
    if (description.status === "long") warnings.push("description-long");
    if (description.status === "short") warnings.push("description-short");
    if (
      title.text.length > 15 &&
      description.text.toLowerCase().startsWith(title.text.toLowerCase())
    ) {
      warnings.push("description-repeats-title");
    }
  }

  if ((input.url ?? "").trim() && !url.valid) warnings.push("url-invalid");
  if (url.valid) {
    if (!url.https) warnings.push("url-insecure");
    const path = url.breadcrumb.slice(url.domain.length);
    if (path.includes("_")) warnings.push("url-underscores");
    if (/[A-Z]/.test(path)) warnings.push("url-uppercase");
    if (url.breadcrumb.split("›").length - 1 >= 4) warnings.push("url-deep");
  }

  if (keyword) {
    if (!keyword.inTitle) warnings.push("keyword-missing-title");
    if (!keyword.inDescription) warnings.push("keyword-missing-description");
  }

  const penalty = warnings.reduce((sum, code) => sum + PENALTIES[code], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return { device, title, description, url, keyword, warnings, score };
}
