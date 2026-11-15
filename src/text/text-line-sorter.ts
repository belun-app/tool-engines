/**
 * Sorts the lines of a text alphabetically, by length or numerically, or reverses them, with
 * options for case, trimming, empty lines and duplicates.
 */

export type LineSortMode =
  | "alpha-asc"
  | "alpha-desc"
  | "length-asc"
  | "length-desc"
  | "numeric-asc"
  | "numeric-desc"
  | "reverse";

export interface LineSortOptions {
  /** Sort order. Default `"alpha-asc"`. */
  mode?: LineSortMode;
  caseSensitive?: boolean;
  removeDuplicates?: boolean;
  trimLines?: boolean;
  removeEmpty?: boolean;
  /**
   * Locale (BCP 47 tag or list) for alphabetical comparison, e.g. `"en"` or `"ru"`.
   * Default: the host's default locale, so the order can differ between machines; pass a
   * locale for reproducible output.
   */
  locale?: string | string[];
}

export interface LineSortResult {
  output: string;
  inputLines: number;
  outputLines: number;
  duplicatesRemoved: number;
  emptyRemoved: number;
}

const EMPTY_RESULT: LineSortResult = {
  output: "",
  inputLines: 0,
  outputLines: 0,
  duplicatesRemoved: 0,
  emptyRemoved: 0,
};

/** First number found anywhere in the line, or null. Accepts "1.5" and "1,5". */
function firstNumber(line: string): number | null {
  const match = line.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0].replace(",", "."));
  return Number.isNaN(value) ? null : value;
}

type Compare = (a: string, b: string) => number;

function makeAlpha(caseSensitive: boolean, locale: string | string[] | undefined): Compare {
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(locale);
  } catch {
    collator = new Intl.Collator();
  }
  if (caseSensitive) return (a, b) => collator.compare(a, b);
  return (a, b) => collator.compare(a.toLowerCase(), b.toLowerCase());
}

/** Lines without a number always sink to the bottom, in both directions. */
function compareNumeric(a: string, b: string, alpha: Compare, descending: boolean): number {
  const na = firstNumber(a);
  const nb = firstNumber(b);
  if (na === null && nb === null) return alpha(a, b);
  if (na === null) return 1;
  if (nb === null) return -1;
  if (na !== nb) return descending ? nb - na : na - nb;
  return alpha(a, b);
}

function applySort(lines: string[], mode: LineSortMode, alpha: Compare): string[] {
  const sorted = [...lines];

  switch (mode) {
    case "reverse":
      return sorted.reverse();
    case "alpha-desc":
      return sorted.sort((a, b) => alpha(b, a));
    case "length-asc":
      return sorted.sort((a, b) => a.length - b.length || alpha(a, b));
    case "length-desc":
      return sorted.sort((a, b) => b.length - a.length || alpha(a, b));
    case "numeric-asc":
      return sorted.sort((a, b) => compareNumeric(a, b, alpha, false));
    case "numeric-desc":
      return sorted.sort((a, b) => compareNumeric(a, b, alpha, true));
    default:
      return sorted.sort((a, b) => alpha(a, b));
  }
}

/**
 * Sort the lines of a text (alphabetically, by length, by the first number in each line, or
 * reversed), optionally trimming lines and removing empty lines and duplicates. A non-string
 * `text` gives the empty result.
 */
export function sortLines(text: string, options: LineSortOptions = {}): LineSortResult {
  if (typeof text !== "string" || !text) return { ...EMPTY_RESULT };
  const opts = options ?? {};

  const caseSensitive = opts.caseSensitive === true;
  let lines = text.split(/\r?\n/);
  const inputLines = lines.length;

  if (opts.trimLines) lines = lines.map((line) => line.trim());

  let emptyRemoved = 0;
  if (opts.removeEmpty) {
    const before = lines.length;
    lines = lines.filter((line) => line.trim().length > 0);
    emptyRemoved = before - lines.length;
  }

  let duplicatesRemoved = 0;
  if (opts.removeDuplicates) {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const line of lines) {
      const key = caseSensitive ? line : line.toLowerCase();
      if (seen.has(key)) {
        duplicatesRemoved++;
        continue;
      }
      seen.add(key);
      unique.push(line);
    }
    lines = unique;
  }

  lines = applySort(lines, opts.mode ?? "alpha-asc", makeAlpha(caseSensitive, opts.locale));

  return {
    output: lines.join("\n"),
    inputLines,
    outputLines: lines.length,
    duplicatesRemoved,
    emptyRemoved,
  };
}
