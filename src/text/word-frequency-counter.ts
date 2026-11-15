/**
 * Word frequency list of a text with counts and percentages, optional stop-word filtering,
 * CSV export, and the "classic nausea" keyword-stuffing figure.
 */

import { STOP_WORDS } from "./_stop-words.js";

export interface WordFrequencyEntry {
  word: string;
  count: number;
  percentage: number;
}

export interface WordFrequencyResult {
  totalWords: number;
  uniqueWords: number;
  /** Words dropped because they are function words. 0 unless excludeStopWords is on. */
  stopWordCount: number;
  /** Share of the original text made up of function words, in percent, rounded to 0.1. */
  stopWordShare: number;
  /** Occurrences of the single most frequent word after filtering. 0 for empty text. */
  maxCount: number;
  entries: WordFrequencyEntry[];
}

export interface WordFrequencyOptions {
  caseSensitive?: boolean;
  minLength?: number;
  /** Drop function words ("the", "и") from the table. Default false. */
  excludeStopWords?: boolean;
  /**
   * Locale (BCP 47) used to break ties alphabetically. Default: the host's default locale,
   * so tie order can differ between machines; pass a locale for reproducible output.
   */
  locale?: string | string[];
}

/** String comparison for the locale; an invalid locale falls back to the host default. */
function textCompare(locale?: string | string[]): (a: string, b: string) => number {
  try {
    return new Intl.Collator(locale).compare;
  } catch {
    return new Intl.Collator().compare;
  }
}

export function countWordFrequency(
  text: string,
  options: WordFrequencyOptions = {},
): WordFrequencyResult {
  const { caseSensitive = false, minLength = 1, excludeStopWords = false, locale } = options;
  const compare = textCompare(locale);

  const matches = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  const cased = matches.map((w) => (caseSensitive ? w : w.toLowerCase()));

  const stopWordCount = cased.reduce((n, w) => n + (STOP_WORDS.has(w.toLowerCase()) ? 1 : 0), 0);
  const stopWordShare =
    cased.length === 0 ? 0 : Math.round((stopWordCount / cased.length) * 1000) / 10;

  const words = cased
    .filter((w) => w.length >= Math.max(1, minLength))
    .filter((w) => !excludeStopWords || !STOP_WORDS.has(w.toLowerCase()));

  if (words.length === 0) {
    return {
      totalWords: 0,
      uniqueWords: 0,
      stopWordCount,
      stopWordShare,
      maxCount: 0,
      entries: [],
    };
  }

  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const totalWords = words.length;
  const entries = [...counts.entries()]
    .map(([word, count]) => ({
      word,
      count,
      percentage: Math.round((count / totalWords) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count || compare(a.word, b.word));

  return {
    totalWords,
    uniqueWords: entries.length,
    stopWordCount,
    stopWordShare,
    maxCount: entries[0]?.count ?? 0,
    entries,
  };
}

/**
 * "Classic nausea" (klassicheskaya toshnota), a Russian SEO keyword-stuffing metric, as
 * Advego and text.ru define it: the square root of the occurrence count of the most
 * frequent word. Unlike a percentage it does not fall as
 * the text grows, which is why Russian SEO checkers quote it alongside density.
 */
export function classicNausea(maxCount: number): number {
  return Math.round(Math.sqrt(Math.max(0, maxCount)) * 100) / 100;
}

/** Frequency table as CSV — word, count, percentage — for Excel or Google Sheets. */
export function toCsv(entries: WordFrequencyEntry[], header: [string, string, string]): string {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = entries.map((e) => `${quote(e.word)},${e.count},${e.percentage}`);
  return [header.join(","), ...rows].join("\r\n");
}
