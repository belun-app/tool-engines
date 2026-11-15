/**
 * Cleans text pasted from AI chat tools: rewrites dashes and quotes, removes zero-width
 * characters, odd spaces, Markdown bold markers and emoji, and tidies whitespace.
 */

/** How the dashes AI loves should be rewritten. */
export type DashMode = "keep" | "comma" | "hyphen" | "space";

/** What the curly quotes become. */
export type QuoteMode = "keep" | "straight" | "guillemets";

export interface AiTextCleanerOptions {
  /** What to do with em dashes (—), horizontal bars (―), and leftover en dashes (–). */
  dashMode: DashMode;
  /** Straight typewriter quotes, Russian/French «guillemets», or leave them alone. */
  quoteMode: QuoteMode;
  /** Delete zero-width spaces, soft hyphens, and byte-order marks. */
  removeZeroWidth: boolean;
  /** Turn non-breaking, thin, and ideographic spaces into a plain space. */
  fixUnicodeSpaces: boolean;
  /** The single-character ellipsis (…) becomes three periods. */
  normalizeEllipsis: boolean;
  /** Bullet characters at the start of a line become a hyphen. */
  normalizeBullets: boolean;
  /** Strip Markdown bold and italic markers, keeping the words. */
  removeBoldMarkers: boolean;
  /** Remove emoji and pictographs. */
  removeEmoji: boolean;
  /** Collapse runs of spaces and trim the end of every line. */
  tidyWhitespace: boolean;
}

/** How many of each marker a chunk of text contains. */
export interface AiMarkerCounts {
  emDashes: number;
  enDashes: number;
  smartQuotes: number;
  zeroWidth: number;
  unicodeSpaces: number;
  ellipses: number;
  bullets: number;
  boldMarkers: number;
  emoji: number;
  doubleSpaces: number;
}

export interface AiTextCleanerResult {
  text: string;
  before: AiMarkerCounts;
  after: AiMarkerCounts;
  /** Markers that disappeared, never negative. */
  fixes: number;
  charactersBefore: number;
  charactersAfter: number;
  words: number;
}

export const DEFAULT_OPTIONS: AiTextCleanerOptions = {
  dashMode: "comma",
  quoteMode: "straight",
  removeZeroWidth: true,
  fixUnicodeSpaces: true,
  normalizeEllipsis: true,
  normalizeBullets: false,
  removeBoldMarkers: false,
  removeEmoji: false,
  tidyWhitespace: true,
};

const EM_DASH = /[—―]/g;
const EN_DASH = /–/g;
const SMART_QUOTE = /[‘’‚‛“”„‟′″]/g;
// Written as an alternation: a zero-width joiner inside a character class would
// also match the glue that holds multi-codepoint emoji together.
const ZERO_WIDTH = /​|‌|⁠|﻿|­/g;
const UNICODE_SPACE = /[   -   　᠎]/g;
const ELLIPSIS = /…/g;
const BULLET_LINE = /^[^\S\n]*[•‣▪●◦∙⁃·][^\S\n]*/gm;
const BOLD_MARKER = /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/g;
const ITALIC_MARKER = /(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g;
// A pictograph with its skin-tone modifiers, FE0F and ZWJ-joined parts; a flag (a pair of
// regional indicators, which are not Extended_Pictographic); or a stray skin-tone modifier.
const EMOJI =
  /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*|\p{Regional_Indicator}{1,2}|\p{Emoji_Modifier}/gu;
const DOUBLE_SPACE = /[^\S\n]{2,}/g;
// Trademark and copyright signs are pictographs by Unicode's definition but
// nobody wants them stripped out of a document.
const KEEP_PICTOGRAPHS = new Set(["©", "®", "™"]);

const SMART_QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
};

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function countEmoji(text: string): number {
  let total = 0;
  for (const match of text.matchAll(EMOJI)) {
    if (!KEEP_PICTOGRAPHS.has(match[0])) total += 1;
  }
  return total;
}

/** Count the AI formatting markers in a text without changing anything. */
export function countAiMarkers(text: string): AiMarkerCounts {
  if (!text) {
    return {
      emDashes: 0,
      enDashes: 0,
      smartQuotes: 0,
      zeroWidth: 0,
      unicodeSpaces: 0,
      ellipses: 0,
      bullets: 0,
      boldMarkers: 0,
      emoji: 0,
      doubleSpaces: 0,
    };
  }

  return {
    emDashes: countMatches(text, EM_DASH),
    enDashes: countMatches(text, EN_DASH),
    smartQuotes: countMatches(text, SMART_QUOTE),
    zeroWidth: countMatches(text, ZERO_WIDTH),
    unicodeSpaces: countMatches(text, UNICODE_SPACE),
    ellipses: countMatches(text, ELLIPSIS),
    bullets: countMatches(text, BULLET_LINE),
    boldMarkers: countMatches(text, BOLD_MARKER) + countMatches(text, ITALIC_MARKER),
    emoji: countEmoji(text),
    doubleSpaces: countMatches(text, DOUBLE_SPACE),
  };
}

export function totalMarkers(counts: AiMarkerCounts): number {
  return (
    counts.emDashes +
    counts.enDashes +
    counts.smartQuotes +
    counts.zeroWidth +
    counts.unicodeSpaces +
    counts.ellipses +
    counts.bullets +
    counts.boldMarkers +
    counts.emoji +
    counts.doubleSpaces
  );
}

/** True when nothing but spaces sits between the start of the line and `offset`. */
function atLineStart(full: string, offset: number): boolean {
  for (let i = offset - 1; i >= 0; i -= 1) {
    const char = full[i];
    if (char === "\n") return true;
    if (char !== " " && char !== "\t") return false;
  }
  return true;
}

function atLineEnd(full: string, offset: number): boolean {
  for (let i = offset; i < full.length; i += 1) {
    const char = full[i];
    if (char === "\n") return true;
    if (char !== " " && char !== "\t") return false;
  }
  return true;
}

function lastVisibleChar(full: string, offset: number): string {
  for (let i = offset - 1; i >= 0; i -= 1) {
    const char = full[i];
    if (char !== " " && char !== "\t") return char;
  }
  return "";
}

function rewriteDashes(text: string, mode: DashMode): string {
  if (mode === "keep") return text;

  // A dash between two numbers is a range. Turning "1990—2000" into "1990, 2000"
  // changes the meaning, so ranges always collapse to a plain hyphen instead.
  let out = text.replace(
    /(\d)[^\S\n]*[–—―−][^\S\n]*(\d)/g,
    (_match, left: string, right: string) => `${left}-${right}`,
  );

  const replacement = mode === "comma" ? ", " : mode === "hyphen" ? " - " : " ";

  out = out.replace(/[^\S\n]*[–—―][^\S\n]*/g, (match, offset: number) => {
    // A dash opening a line is dialogue punctuation in Russian, French, and
    // Spanish, and a list marker in plain-text notes. Both stay as they are.
    if (atLineStart(out, offset)) return match;
    // A dangling dash at the end of a line gets dropped, commas included —
    // "the point was, \n" reads worse than "the point was\n".
    if (atLineEnd(out, offset + match.length)) return "";
    if (mode === "comma") {
      const prev = lastVisibleChar(out, offset);
      // Already punctuated: "wait, — he said" only needs the space.
      if (prev && ",;:.!?…".includes(prev)) return " ";
    }
    return replacement;
  });

  return out;
}

/**
 * Straight double quotes become «…». Which half to use is decided by the
 * previous character rather than by alternating, so one unbalanced quote
 * earlier in the text does not flip every pair after it.
 */
function toGuillemets(text: string): string {
  return text.replace(/"/g, (_match, offset: number) => {
    const prev = offset > 0 ? text[offset - 1] : "";
    return prev === "" || /[\s([{«—–-]/.test(prev) ? "«" : "»";
  });
}

function stripEmoji(text: string): string {
  return text.replace(EMOJI, (match) => (KEEP_PICTOGRAPHS.has(match) ? match : ""));
}

/** Apply the selected rules. The order is fixed because it matters. */
export function cleanAiText(text: string, options: AiTextCleanerOptions): string {
  if (!text) return "";

  let out = text.replace(/\r\n?/g, "\n");

  if (options.removeZeroWidth) {
    out = out.replace(ZERO_WIDTH, "");
  }

  if (options.fixUnicodeSpaces) {
    out = out.replace(UNICODE_SPACE, " ");
  }

  if (options.removeEmoji) {
    out = stripEmoji(out);
  }

  if (options.normalizeEllipsis) {
    out = out.replace(ELLIPSIS, "...");
  }

  if (options.quoteMode !== "keep") {
    out = out.replace(SMART_QUOTE, (char) => SMART_QUOTES[char] ?? char);
  }

  if (options.quoteMode === "guillemets") {
    out = toGuillemets(out);
  }

  out = rewriteDashes(out, options.dashMode);

  if (options.normalizeBullets) {
    out = out.replace(BULLET_LINE, (match) => {
      const indent = match.match(/^[^\S\n]*/)?.[0] ?? "";
      return `${indent}- `;
    });
  }

  if (options.removeBoldMarkers) {
    out = out
      .replace(BOLD_MARKER, (_match, bold?: string, underscored?: string) =>
        bold !== undefined ? bold : (underscored ?? ""),
      )
      .replace(ITALIC_MARKER, (_match, lead: string, inner: string) => `${lead}${inner}`);
  }

  if (options.tidyWhitespace) {
    out = out
      .replace(DOUBLE_SPACE, " ")
      .split("\n")
      .map((line) => line.replace(/[^\S\n]+$/, ""))
      .join("\n");
  }

  return out;
}

/**
 * Clean the text and report what changed.
 * Empty input returns zeroed counts rather than throwing.
 */
export function cleanAiTextWithStats(
  text: string,
  options: AiTextCleanerOptions = DEFAULT_OPTIONS,
): AiTextCleanerResult {
  const before = countAiMarkers(text);
  const cleaned = cleanAiText(text, options);
  const after = countAiMarkers(cleaned);
  const trimmed = cleaned.trim();

  return {
    text: cleaned,
    before,
    after,
    fixes: Math.max(0, totalMarkers(before) - totalMarkers(after)),
    charactersBefore: text.length,
    charactersAfter: cleaned.length,
    words: trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0,
  };
}
