/**
 * Word, character, sentence and paragraph counts of a text, with reading and speaking time
 * and progress towards a word target.
 */

import {
  countLines,
  countParagraphs,
  countVisibleCharacters,
  splitSentences,
  splitWords,
  tallyCharacters,
} from "./_text-stats.js";
import {
  SILENT_READING_WPM,
  SILENT_READING_WPM_RU,
  SPEECH_PACE_WPM,
} from "./words-to-minutes-calculator.js";

export interface WordCountResult {
  words: number;
  /** Visible characters (grapheme clusters): an emoji or an accented letter is one. */
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number;
  /** Silent reading, rounded up to a whole minute; the pace depends on the language. */
  readingTimeMinutes: number;
  /** Distinct words, compared case-insensitively with surrounding punctuation stripped. */
  uniqueWords: number;
  /** Lines that contain at least one non-whitespace character. */
  lines: number;
  letters: number;
  /** Letters in the Cyrillic script — the breakdown Russian counters print. */
  cyrillic: number;
  /** Letters in the Latin script. */
  latin: number;
  digits: number;
  spaces: number;
  /**
   * Punctuation and symbols, i.e. everything that is neither letter, digit, whitespace nor
   * combining mark.
   */
  punctuation: number;
  /**
   * Exact for Russian (a Russian syllable is a vowel), approximate for English,
   * where vowel groups are counted and a silent trailing "e" is dropped.
   */
  syllables: number;
  /** Words in the longest sentence. */
  longestSentenceWords: number;
  /** Letters and digits per word. */
  averageWordLength: number;
  /** Words per sentence. */
  averageSentenceWords: number;
  /** Read aloud at the average speaking pace (140 wpm). */
  speakingTimeMinutes: number;
}

/**
 * Reading and speaking norms — the same ones the Words to Minutes calculator uses, so
 * the two tools never give different answers. Silent reading: 238 wpm for English
 * (Brysbaert 2019) and 184 wpm for Russian (IReST 2012); reading aloud: 140 wpm, the
 * average conference pace.
 */
export type CountLang = "en" | "ru";

export interface ReadingNorms {
  readingWpm: number;
  speakingWpm: number;
}

export function readingNorms(lang: CountLang = "en"): ReadingNorms {
  return {
    readingWpm: lang === "ru" ? SILENT_READING_WPM_RU : SILENT_READING_WPM,
    speakingWpm: SPEECH_PACE_WPM.average,
  };
}

/** Whole minutes, rounded up; any non-empty text takes at least one. */
export function minutesFor(words: number, wpm: number): number {
  return words > 0 ? Math.max(1, Math.ceil(words / wpm)) : 0;
}

/** а е ё и о у ы э ю я, by code. */
const CYRILLIC_VOWELS = new Set([..."аеёиоуыэюя"].map((c) => c.charCodeAt(0)));
/** a e i o u y, by code. */
const LATIN_VOWELS = new Set([..."aeiouy"].map((c) => c.charCodeAt(0)));
const LOWER_E = 101;

/**
 * Cyrillic words have exactly as many syllables as vowels — that rule is taught in
 * Russian primary school and has no exceptions. Latin words are estimated by vowel
 * group, which is the usual approximation and is wrong for words like "cafe".
 * Takes the word in lower case.
 */
function countSyllables(w: string): number {
  let cyrillic = 0;
  let count = 0;
  let inVowel = false;
  let sawLatin = false;
  let last = 0;
  for (let i = 0; i < w.length; i++) {
    const code = w.charCodeAt(i);
    if (CYRILLIC_VOWELS.has(code)) {
      cyrillic++;
    } else if (code >= 97 && code <= 122) {
      sawLatin = true;
      last = code;
      const isVowel = LATIN_VOWELS.has(code);
      if (isVowel && !inVowel) count++;
      inVowel = isVowel;
    }
  }
  if (cyrillic) return cyrillic;
  if (!sawLatin) return 0;
  if (last === LOWER_E && count > 1) count--;

  return Math.max(1, count);
}

const EMPTY: WordCountResult = {
  words: 0,
  characters: 0,
  charactersNoSpaces: 0,
  sentences: 0,
  paragraphs: 0,
  readingTimeMinutes: 0,
  uniqueWords: 0,
  lines: 0,
  letters: 0,
  cyrillic: 0,
  latin: 0,
  digits: 0,
  spaces: 0,
  punctuation: 0,
  syllables: 0,
  longestSentenceWords: 0,
  averageWordLength: 0,
  averageSentenceWords: 0,
  speakingTimeMinutes: 0,
};

const round1 = (n: number) => Math.round(n * 10) / 10;

const EDGE_PUNCTUATION = /^[^\p{L}\p{Nd}]+|[^\p{L}\p{Nd}]+$/gu;
const WORD_CHAR = /^[\p{L}\p{Nd}]$/u;

/** Letter or digit, with fast paths for ASCII and basic Cyrillic. */
function isWordChar(code: number): boolean {
  if (code < 0x80)
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  if ((code >= 0x410 && code <= 0x44f) || code === 0x401 || code === 0x451) return true;
  if (code >= 0xd800 && code <= 0xdfff) return false;
  return WORD_CHAR.test(String.fromCharCode(code));
}

/** A lower-cased word compared for uniqueness: punctuation stripped from both ends. */
function normaliseWord(w: string): string {
  if (isWordChar(w.charCodeAt(0)) && isWordChar(w.charCodeAt(w.length - 1))) return w;
  return w.replace(EDGE_PUNCTUATION, "");
}

/**
 * Counts a text with the rules shared with the character counter (`_text-stats.ts`).
 * Characters are what a reader sees (grapheme clusters — the character counter's
 * "Visible" figure): 👋🏽 or "é" typed as e + U+0301 is one. Letters, digits, spaces and
 * punctuation are code-point tallies, as in the character counter. Whitespace-only text
 * still has characters and spaces.
 * `lang` picks the silent-reading norm (see {@link readingNorms}).
 */
export function countWords(text: string, lang: CountLang = "en"): WordCountResult {
  if (!text) return { ...EMPTY };

  const tally = tallyCharacters(text);
  const visible = countVisibleCharacters(text);
  const wordList = splitWords(text);
  const words = wordList.length;
  if (!words) {
    return {
      ...EMPTY,
      characters: visible.characters,
      charactersNoSpaces: visible.charactersNoSpaces,
      spaces: tally.spaces,
    };
  }

  const sentenceList = splitSentences(text);
  const sentences = sentenceList.length;
  const { readingWpm, speakingWpm } = readingNorms(lang);

  const unique = new Set<string>();
  let syllables = 0;
  for (const w of wordList) {
    const lower = w.toLowerCase();
    const n = normaliseWord(lower);
    if (n) unique.add(n);
    syllables += countSyllables(lower);
  }

  let longestSentenceWords = 0;
  for (const s of sentenceList) {
    const n = splitWords(s).length;
    if (n > longestSentenceWords) longestSentenceWords = n;
  }

  return {
    words,
    characters: visible.characters,
    charactersNoSpaces: visible.charactersNoSpaces,
    sentences,
    paragraphs: countParagraphs(text),
    readingTimeMinutes: minutesFor(words, readingWpm),
    uniqueWords: unique.size,
    lines: countLines(text),
    letters: tally.letters,
    cyrillic: tally.cyrillic,
    latin: tally.latin,
    digits: tally.digits,
    spaces: tally.spaces,
    punctuation: tally.punctuation,
    syllables,
    longestSentenceWords,
    averageWordLength: round1((tally.letters + tally.digits) / words),
    averageSentenceWords: sentences ? round1(words / sentences) : 0,
    speakingTimeMinutes: minutesFor(words, speakingWpm),
  };
}

export type TargetUnit = "words" | "characters" | "noSpaces";

export interface TargetProgress {
  /** Units counted so far. */
  used: number;
  /** Units still missing; negative when the text is over the target. */
  left: number;
  /** 0–100, capped, for a progress bar. */
  percent: number;
  over: boolean;
  reached: boolean;
}

/** Progress towards a length target in words or characters (with or without spaces). */
export function targetProgress(
  result: WordCountResult,
  target: number,
  unit: TargetUnit,
): TargetProgress | null {
  if (!Number.isFinite(target) || target <= 0) return null;
  const used =
    unit === "words"
      ? result.words
      : unit === "noSpaces"
        ? result.charactersNoSpaces
        : result.characters;
  const left = target - used;
  return {
    used,
    left,
    percent: Math.min(100, (used / target) * 100),
    over: left < 0,
    reached: left <= 0,
  };
}
