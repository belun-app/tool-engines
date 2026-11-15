/**
 * Find and replace in text by plain string or regular expression, with case-sensitive,
 * whole-word, first-match-only and case-preserving options.
 */

export interface FindAndReplaceOptions {
  /** Treat the search string as a JavaScript regular expression. */
  useRegex?: boolean;
  caseSensitive?: boolean;
  /** Only match when the hit is not glued to surrounding letters or digits. */
  wholeWord?: boolean;
  /** Copy the capitalisation of each match onto its replacement. */
  preserveCase?: boolean;
  /** Replace only the first match; later matches are still counted. */
  firstOnly?: boolean;
}

export interface FindAndReplaceResult {
  output: string;
  /** Matches found, including ones skipped because of firstOnly. */
  matchCount: number;
  /** Matches actually rewritten. */
  replacements: number;
  /** How many distinct lines contain at least one replacement. */
  linesAffected: number;
  valid: boolean;
  error: string;
  /** True when the match cap was hit and scanning stopped early. */
  limitReached: boolean;
}

const MAX_MATCHES = 100_000;

/** Letters, digits and underscore in any script — not the ASCII-only \w. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function emptyResult(text: string): FindAndReplaceResult {
  return {
    output: text,
    matchCount: 0,
    replacements: 0,
    linesAffected: 0,
    valid: true,
    error: "",
    limitReached: false,
  };
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}

/** Same rule as \b, but Unicode-aware, so Cyrillic and accented words bound correctly. */
function atWordBoundary(text: string, start: number, matched: string): boolean {
  if (!matched) return true;
  const end = start + matched.length;
  if (isWordChar(matched[0]) && isWordChar(text[start - 1])) return false;
  if (isWordChar(matched[matched.length - 1]) && isWordChar(text[end])) return false;
  return true;
}

/**
 * Mirror the capitalisation of the match onto the replacement:
 * ALL CAPS stays all caps, Capitalised stays capitalised, lower stays lower.
 */
function matchCase(matched: string, replacement: string): string {
  if (!matched || !replacement) return replacement;

  const upper = matched.toUpperCase();
  const lower = matched.toLowerCase();

  if (upper === lower) return replacement;
  if (matched === lower) return replacement.toLowerCase();
  if (matched === upper && matched.length > 1) return replacement.toUpperCase();
  if (matched[0] === upper[0] && matched.slice(1) === lower.slice(1)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Expand $1, $<name>, $&, $`, $' and $$ the way String.prototype.replace does. */
function expandReplacement(template: string, match: RegExpExecArray, input: string): string {
  if (!template.includes("$")) return template;

  const groupCount = match.length - 1;

  return template.replace(
    /\$(\$|&|`|'|<([^>]*)>|\d{1,2})/g,
    (whole, token: string, name?: string) => {
      if (token === "$") return "$";
      if (token === "&") return match[0];
      if (token === "`") return input.slice(0, match.index);
      if (token === "'") return input.slice(match.index + match[0].length);
      if (name !== undefined) return match.groups?.[name] ?? "";

      const index = Number.parseInt(token, 10);
      if (index >= 1 && index <= groupCount) return match[index] ?? "";
      if (token.length === 2) {
        const single = Number.parseInt(token[0], 10);
        if (single >= 1 && single <= groupCount) return `${match[single] ?? ""}${token[1]}`;
      }
      return whole;
    },
  );
}

export function findAndReplace(
  text: string,
  find: string,
  replace: string,
  options: FindAndReplaceOptions = {},
): FindAndReplaceResult {
  if (!text || !find) return emptyResult(text ?? "");

  const source = options.useRegex ? find : escapeRegExp(find);
  const flags = `gm${options.caseSensitive ? "" : "i"}`;

  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch (error) {
    return {
      output: text,
      matchCount: 0,
      replacements: 0,
      linesAffected: 0,
      valid: false,
      error: (error as Error).message,
      limitReached: false,
    };
  }

  // Match indices only ever move forward, so line numbers can be counted in one pass.
  let scanPos = 0;
  let scanLine = 0;
  const lineAt = (index: number): number => {
    while (scanPos < index) {
      if (text.charCodeAt(scanPos) === 10) scanLine++;
      scanPos++;
    }
    return scanLine;
  };

  const affectedLines = new Set<number>();
  let output = "";
  let lastEnd = 0;
  let matchCount = 0;
  let replacements = 0;
  let limitReached = false;

  let match = regex.exec(text);
  while (match !== null) {
    const matched = match[0];

    if (!options.wholeWord || atWordBoundary(text, match.index, matched)) {
      matchCount++;

      if (!options.firstOnly || replacements === 0) {
        const raw = options.useRegex ? expandReplacement(replace, match, text) : replace;
        const value = options.preserveCase ? matchCase(matched, raw) : raw;

        output += text.slice(lastEnd, match.index) + value;
        lastEnd = match.index + matched.length;
        replacements++;
        affectedLines.add(lineAt(match.index));
      }

      if (matchCount >= MAX_MATCHES) {
        limitReached = true;
        break;
      }
    }

    // A zero-length match leaves lastIndex where it is, which would loop forever.
    if (matched.length === 0) {
      regex.lastIndex++;
      if (regex.lastIndex > text.length) break;
    }

    match = regex.exec(text);
  }

  output += text.slice(lastEnd);

  return {
    output,
    matchCount,
    replacements,
    linesAffected: affectedLines.size,
    valid: true,
    error: "",
    limitReached,
  };
}
