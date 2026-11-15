/**
 * Whitespace cleanup: collapses spaces, trims lines, removes or collapses empty lines,
 * converts tabs, normalises Unicode spaces and fixes spacing around punctuation.
 */

export interface WhitespaceOptions {
  /** Collapse runs of spaces and tabs inside a line down to a single space. */
  collapseSpaces: boolean;
  /** Strip leading and trailing whitespace from every line. */
  trimLines: boolean;
  /** Drop lines that are empty or contain only whitespace. */
  removeEmptyLines: boolean;
  /** Collapse runs of two or more blank lines down to one. */
  collapseBlankLines: boolean;
  /** Remove every space, tab, and line break, leaving one unbroken run of text. */
  removeAllWhitespace: boolean;
  /** Convert tab characters to a single space before other rules run. */
  tabsToSpaces: boolean;
  /**
   * Replace non-breaking and other look-alike spaces with a plain space and delete
   * zero-width characters. Off: a single non-breaking space survives every other rule.
   */
  normalizeUnicode: boolean;
  /**
   * Remove spaces before , . ; : ! ? … ) ] » and after ( [ «, the debris Word and OCR
   * leave behind ("слово , слово" → "слово, слово").
   */
  fixPunctuation: boolean;
  /** Join the lines of a paragraph with a space; blank lines between paragraphs stay. */
  joinLines: boolean;
}

export interface WhitespaceStats {
  characters: number;
  words: number;
  lines: number;
  /** Count of space, tab, and line-break characters. */
  whitespace: number;
}

export interface WhitespaceResult {
  text: string;
  before: WhitespaceStats;
  after: WhitespaceStats;
  /** Characters removed, never negative. */
  removed: number;
  /** Percentage of the original length that was stripped, rounded to one decimal. */
  removedPercent: number;
}

export const DEFAULT_OPTIONS: WhitespaceOptions = {
  collapseSpaces: true,
  trimLines: true,
  removeEmptyLines: false,
  collapseBlankLines: true,
  removeAllWhitespace: false,
  tabsToSpaces: false,
  normalizeUnicode: true,
  fixPunctuation: false,
  joinLines: false,
};

/**
 * Invisible characters that look like a plain space but are not one.
 * Word processors and PDF copy-paste sprinkle these everywhere.
 */
const UNICODE_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\u180e]/g;
/** Zero-width space, word joiner and byte-order mark: never meaningful inside text. */
const ZERO_WIDTH = /[\u200b\u2060\ufeff]/g;
/**
 * A zero-width joiner is the glue of emoji sequences (👩‍💻, 🏳️‍🌈): it is kept between two
 * emoji and deleted anywhere else.
 */
const STRAY_ZWJ =
  /(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}]\ufe0f?)\u200d|\u200d(?!\p{Extended_Pictographic})/gu;
/**
 * A zero-width non-joiner is spelling inside a Persian, Kurdish or Hindi word
 * (Persian «mi-xâham», written with one): it is kept between two letters of such a script.
 * Next to Latin, Cyrillic or Greek letters, or away from letters, it is copy-paste
 * debris and is deleted.
 */
const STRAY_ZWNJ =
  /(?<!\p{L}\p{M}*)\u200c|\u200c(?!\p{L})|(?<=[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]\p{M}*)\u200c|\u200c(?=[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}])/gu;
/**
 * Runs of horizontal whitespace inside a line, plus a lone tab. A single non-breaking or
 * narrow space is left alone (it is typography, not an extra space), and so is a
 * byte-order mark, which must not turn into a visible space.
 */
const SPACE_RUN = /[^\S\n\ufeff]{2,}|\t/g;
/**
 * Spaces before closing punctuation, only where the mark ends a word: the run of marks
 * (closers first, then , . ; : ! ? …, as in "word ?!" or "( note ) .") must be followed
 * by whitespace or the end of the text. ".NET", ".docx", ":)" and "a ,b" keep their space.
 */
const SPACE_BEFORE_PUNCT = /[^\S\n]+(?=(?:[)\]»]+[,.;:!?…]*|[,.;:!?…]+)(?:\s|$))/g;
/** Spaces after opening brackets. */
const SPACE_AFTER_OPEN = /([(\[«])[^\S\n]+/g;

/** Character, word, line, and whitespace counts for a chunk of text. */
export function measure(text: string): WhitespaceStats {
  if (!text) return { characters: 0, words: 0, lines: 0, whitespace: 0 };

  return {
    characters: text.length,
    words: text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0,
    lines: text.split("\n").length,
    whitespace: (text.match(/\s/g) ?? []).length,
  };
}

/** Apply the selected whitespace rules. Order matters, so it is fixed here. */
export function cleanWhitespace(text: string, options: WhitespaceOptions): string {
  if (!text) return "";

  let out = text.replace(/\r\n?/g, "\n");

  if (options.normalizeUnicode) {
    out = out
      .replace(UNICODE_SPACES, " ")
      .replace(ZERO_WIDTH, "")
      .replace(STRAY_ZWJ, "")
      .replace(STRAY_ZWNJ, "");
  }

  if (options.removeAllWhitespace) {
    return out.replace(/\s+/g, "");
  }

  if (options.tabsToSpaces) {
    out = out.replace(/\t/g, " ");
  }

  if (options.collapseSpaces) {
    out = out.replace(SPACE_RUN, " ");
  }

  if (options.fixPunctuation) {
    out = out.replace(SPACE_BEFORE_PUNCT, "").replace(SPACE_AFTER_OPEN, "$1");
  }

  if (options.trimLines) {
    out = out
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
  }

  if (options.removeEmptyLines) {
    out = out
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .join("\n");
  } else if (options.collapseBlankLines) {
    // Only the blank lines in between collapse; the indentation of the next line stays.
    out = out.replace(/\n(?:[^\S\n]*\n)+/g, "\n\n");
  }

  if (options.joinLines) {
    // A line break with text on both sides becomes a space; blank lines stay.
    out = out.replace(/([^\n])[^\S\n]*\n(?=[^\S\n]*[^\s])[^\S\n]*/g, "$1 ");
  }

  if (options.trimLines) {
    // Trimming every line leaves the blank lines at the very start and end of the text.
    out = out.replace(/^\n+|\n+$/g, "");
  }

  return out;
}

/**
 * Clean the text and report before/after stats.
 * Empty input returns zeroed stats rather than throwing.
 */
export function removeWhitespace(
  text: string,
  options: WhitespaceOptions = DEFAULT_OPTIONS,
): WhitespaceResult {
  const before = measure(text);
  const cleaned = cleanWhitespace(text, options);
  const after = measure(cleaned);
  const removed = Math.max(0, before.characters - after.characters);
  const removedPercent =
    before.characters > 0 ? Math.round((removed / before.characters) * 1000) / 10 : 0;

  return { text: cleaned, before, after, removed, removedPercent };
}
