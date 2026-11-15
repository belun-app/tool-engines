/**
 * Counting rules shared by the word counter and the character counter, so the two
 * tools print the same totals for the same text. One pass over the code points:
 * a 1 MB text is tallied in a few milliseconds, so both counters can recount on
 * every keystroke.
 *
 * - `tallyCharacters` counts Unicode code points (what X/Twitter and most platform
 *   limits count): 👋 is one, 👋🏽 is two (hand + skin tone). The character counter
 *   prints that figure; {@link countVisibleCharacters} gives what a reader sees.
 * - Whitespace is whatever `\s` matches with the `u` flag, NBSP and thin spaces included.
 * - Punctuation is everything that is neither a letter, a decimal digit, whitespace nor
 *   a combining mark (the stress in "моло́ко" belongs to its letter).
 */

import { segmentGraphemes } from "../_graphemes.js";

export interface CharacterTally {
  /** Unicode code points. */
  characters: number;
  charactersNoSpaces: number;
  letters: number;
  /** Letters in the Cyrillic script. */
  cyrillic: number;
  /** Letters in the Latin script. */
  latin: number;
  digits: number;
  spaces: number;
  /** Everything that is neither letter, digit, whitespace nor combining mark. */
  punctuation: number;
}

const SPACE = 0;
const DIGIT = 1;
const LATIN = 2;
const CYRILLIC = 3;
const LETTER = 4;
const OTHER = 5;
/** A combining mark (\p{M}): part of the character before it, never punctuation. */
const MARK = 6;
type Kind = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const kindCache = new Map<number, Kind>();

/** Classifies a non-ASCII code point with the same Unicode classes the counters always used. */
function classifySlow(cp: number): Kind {
  const cached = kindCache.get(cp);
  if (cached !== undefined) return cached;
  const ch = String.fromCodePoint(cp);
  let kind: Kind;
  if (/\p{L}/u.test(ch)) {
    kind = /\p{Script=Cyrillic}/u.test(ch)
      ? CYRILLIC
      : /\p{Script=Latin}/u.test(ch)
        ? LATIN
        : LETTER;
  } else if (/\p{Nd}/u.test(ch)) kind = DIGIT;
  else if (/\s/u.test(ch)) kind = SPACE;
  else if (/\p{M}/u.test(ch)) kind = MARK;
  else kind = OTHER;
  kindCache.set(cp, kind);
  return kind;
}

export function tallyCharacters(text: string): CharacterTally {
  let characters = 0;
  let cyrillic = 0;
  let latin = 0;
  let otherLetters = 0;
  let digits = 0;
  let spaces = 0;
  let punctuation = 0;

  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = (cp - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000;
        i++;
      }
    }
    characters++;
    let kind: Kind;
    if (cp < 0x80) {
      if (cp === 32 || (cp >= 9 && cp <= 13)) kind = SPACE;
      else if (cp >= 48 && cp <= 57) kind = DIGIT;
      else if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) kind = LATIN;
      else kind = OTHER;
    } else if ((cp >= 0x410 && cp <= 0x44f) || cp === 0x401 || cp === 0x451) {
      kind = CYRILLIC;
    } else {
      kind = classifySlow(cp);
    }
    switch (kind) {
      case SPACE:
        spaces++;
        break;
      case DIGIT:
        digits++;
        break;
      case LATIN:
        latin++;
        break;
      case CYRILLIC:
        cyrillic++;
        break;
      case LETTER:
        otherLetters++;
        break;
      case MARK:
        break;
      default:
        punctuation++;
    }
  }

  return {
    characters,
    charactersNoSpaces: characters - spaces,
    letters: latin + cyrillic + otherLetters,
    cyrillic,
    latin,
    digits,
    spaces,
    punctuation,
  };
}

export interface VisibleCharacters {
  /** Grapheme clusters: 👋🏽, a ZWJ family, a flag and "é" as e + U+0301 are one each. */
  characters: number;
  /** Clusters that are not whitespace (CR LF is one cluster). */
  charactersNoSpaces: number;
}

/**
 * A UTF-16 unit that is always a cluster of its own next to another simple unit:
 * Latin up to U+02FF and Cyrillic outside its combining marks (U+0483–U+0489). Only
 * the next unit can join it (a combining accent after "e"), and that one is not simple.
 */
function isSimple(c: number): boolean {
  return c < 0x300 || (c >= 0x400 && c <= 0x52f && (c < 0x483 || c > 0x489));
}

/** Whitespace in the simple range: tab to CR, space, NEL and NBSP. */
function isSimpleSpace(c: number): boolean {
  return c === 32 || (c >= 9 && c <= 13) || c === 0x85 || c === 0xa0;
}

/**
 * Characters as a reader counts them: one per grapheme cluster. Runs of simple
 * Latin/Cyrillic text are counted unit by unit; only the stretches around anything
 * else (emoji, combining marks, other scripts) go through the grapheme segmenter, so
 * a 1 MB text still counts on every keystroke.
 */
export function countVisibleCharacters(text: string): VisibleCharacters {
  if (!text) return { characters: 0, charactersNoSpaces: 0 };
  let characters = 0;
  let spaces = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (isSimple(c)) {
      characters++;
      if (isSimpleSpace(c)) spaces++;
      // CR LF is one cluster.
      i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
      continue;
    }
    // A run of non-simple units, segmented together with the simple unit before it
    // (already counted), which a combining mark or modifier may attach to.
    let j = i + 1;
    while (j < n && !isSimple(text.charCodeAt(j))) j++;
    const from = i > 0 ? i - 1 : 0;
    const clusters = segmentGraphemes(text.slice(from, j));
    if (from < i) {
      // The first cluster holds the already-counted unit.
      const first = clusters.shift() ?? "";
      if (isSimpleSpace(text.charCodeAt(from)) && !/^\s+$/u.test(first)) spaces--;
    }
    for (const g of clusters) {
      characters++;
      if (/^\s+$/u.test(g)) spaces++;
    }
    i = j;
  }
  return { characters, charactersNoSpaces: characters - spaces };
}

/** Words are runs of non-whitespace: "state-of-the-art" is one, "1 200" is two. */
export function splitWords(text: string): string[] {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

/**
 * Sentences end at `.`, `!`, `?` and the ellipsis character `…` (Word's autocorrect
 * turns "..." into it); a run of them is one boundary. A dot between two digits is
 * a decimal point or a version separator, so "3.5 kg" and "1.2.3" never split a
 * sentence. Abbreviations ("Mr.", "т. д.") are still read as endings — the documented
 * limit of the method.
 */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .replace(/(\d)\.(?=\d)/g, "$1")
    .split(/[.!?…]+/)
    .filter((s) => s.trim().length > 0);
}

/** Paragraphs are blocks separated by a blank line. */
export function countParagraphs(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
}

/** Lines that have something on them; blank lines do not count. */
export function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0).length;
}
