/**
 * Keyword density of a text: the most frequent one-, two- and three-word phrases with their
 * share of the text, and how often given target keywords occur.
 */

import { STOP_WORDS } from "../text/_stop-words.js";

export interface KeywordEntry {
  /** The word or phrase, lowercased. */
  keyword: string;
  /** How many times it occurs in the text. */
  count: number;
  /** Share of all n-gram positions of the same size, in percent, rounded to 0.1. */
  density: number;
  /** Number of words in the phrase: 1, 2, or 3. */
  words: number;
}

export type TargetStatus = "empty" | "missing" | "low" | "good" | "high";

export interface TargetKeywordResult {
  keyword: string;
  count: number;
  density: number;
  status: TargetStatus;
}

export interface KeywordDensityResult {
  totalWords: number;
  uniqueWords: number;
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  oneWord: KeywordEntry[];
  twoWord: KeywordEntry[];
  threeWord: KeywordEntry[];
  target: TargetKeywordResult | null;
}

export interface KeywordDensityOptions {
  /** Drop single stop words, and phrases that start or end with one. Default true. */
  ignoreStopWords?: boolean;
  /** Hide entries that occur fewer times than this. Default 1 for words, 2 for phrases. */
  minCount?: number;
  /** Maximum entries per list. Default 25. */
  limit?: number;
  /** Optional focus keyword to measure separately. */
  target?: string;
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

const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(WORD_RE);
  return matches ?? [];
}

function emptyResult(text: string): KeywordDensityResult {
  return {
    totalWords: 0,
    uniqueWords: 0,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, "").length,
    sentences: 0,
    oneWord: [],
    twoWord: [],
    threeWord: [],
    target: null,
  };
}

function buildNGrams(
  tokens: string[],
  size: number,
  ignoreStopWords: boolean,
  minCount: number,
  limit: number,
  compare: (a: string, b: string) => number,
): KeywordEntry[] {
  const slots = tokens.length - size + 1;
  if (slots < 1) return [];

  const counts = new Map<string, number>();
  for (let i = 0; i < slots; i++) {
    const parts = tokens.slice(i, i + size);
    if (ignoreStopWords) {
      // A single stop word is noise; so is a phrase hinged on one at either end.
      if (STOP_WORDS.has(parts[0])) continue;
      if (STOP_WORDS.has(parts[size - 1])) continue;
    }
    const key = parts.join(" ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([keyword, count]) => ({
      keyword,
      count,
      density: Math.round((count / slots) * 1000) / 10,
      words: size,
    }))
    .sort((a, b) => b.count - a.count || compare(a.keyword, b.keyword))
    .slice(0, limit);
}

function measureTarget(tokens: string[], raw: string): TargetKeywordResult {
  const parts = tokenize(raw);
  if (parts.length === 0) {
    return { keyword: raw.trim(), count: 0, density: 0, status: "empty" };
  }

  const slots = tokens.length - parts.length + 1;
  let count = 0;
  for (let i = 0; i < slots; i++) {
    let hit = true;
    for (let j = 0; j < parts.length; j++) {
      if (tokens[i + j] !== parts[j]) {
        hit = false;
        break;
      }
    }
    if (hit) count++;
  }

  const density = slots > 0 ? Math.round((count / slots) * 1000) / 10 : 0;
  let status: TargetStatus;
  if (count === 0) status = "missing";
  else if (density < 0.5) status = "low";
  else if (density <= 2.5) status = "good";
  else status = "high";

  return { keyword: parts.join(" "), count, density, status };
}

export function analyzeKeywordDensity(
  text: string,
  options: KeywordDensityOptions = {},
): KeywordDensityResult {
  const { ignoreStopWords = true, minCount, limit = 25, target = "", locale } = options;
  const compare = textCompare(locale);

  const tokens = tokenize(text);
  if (tokens.length === 0) {
    const base = emptyResult(text);
    return target.trim() ? { ...base, target: measureTarget(tokens, target) } : base;
  }

  const wordMin = Math.max(1, minCount ?? 1);
  const phraseMin = Math.max(minCount ?? 2, 1);

  const result: KeywordDensityResult = {
    totalWords: tokens.length,
    uniqueWords: new Set(tokens).size,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, "").length,
    sentences: text.split(/[.!?…]+/).filter((s) => s.trim().length > 0).length,
    oneWord: buildNGrams(tokens, 1, ignoreStopWords, wordMin, limit, compare),
    twoWord: buildNGrams(tokens, 2, ignoreStopWords, phraseMin, limit, compare),
    threeWord: buildNGrams(tokens, 3, ignoreStopWords, phraseMin, limit, compare),
    target: target.trim() ? measureTarget(tokens, target) : null,
  };

  return result;
}
