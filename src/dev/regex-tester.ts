/**
 * Runs a JavaScript regular expression against a text and lists every match with its
 * position and capture groups.
 */

export interface RegexMatch {
  value: string;
  index: number;
  length: number;
  groups: Record<string, string | undefined>;
}

export interface RegexTestResult {
  valid: boolean;
  error: string;
  matches: RegexMatch[];
  matchCount: number;
}

/**
 * Run a user-supplied JavaScript regular expression over a text and list up to 1000
 * matches (the `g` flag is always added; flags other than `gimsuy` are dropped).
 *
 * Warning: this runs the pattern with the host's regex engine, synchronously. A
 * catastrophic-backtracking pattern such as `(a+)+$` against a long non-matching text can
 * block the thread for minutes, and nothing here can interrupt it. With untrusted patterns,
 * call this in a Web Worker (or a Node worker thread) and terminate the worker after a
 * timeout.
 */
export function testRegex(pattern: string, flags: string, text: string): RegexTestResult {
  if (typeof pattern !== "string" || typeof text !== "string") {
    return { valid: false, error: "Pattern and text must be strings.", matches: [], matchCount: 0 };
  }
  if (!pattern) {
    return { valid: true, error: "", matches: [], matchCount: 0 };
  }

  const sanitizedFlags = String(flags ?? "").replace(/[^gimsuy]/g, "");
  const effectiveFlags = sanitizedFlags.includes("g") ? sanitizedFlags : `${sanitizedFlags}g`;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, effectiveFlags);
  } catch (e) {
    return { valid: false, error: (e as Error).message, matches: [], matchCount: 0 };
  }

  const matches: RegexMatch[] = [];
  const unicode = regex.unicode;

  while (true) {
    const match = regex.exec(text);
    if (match === null) break;
    // After an empty match step past it the way String.prototype.matchAll does: one code
    // unit, or a whole surrogate pair in unicode mode (stepping into the middle of a pair
    // makes exec snap back to its start, which used to loop forever).
    if (match[0] === "") {
      const cp = text.codePointAt(regex.lastIndex);
      regex.lastIndex += unicode && cp !== undefined && cp > 0xffff ? 2 : 1;
    }

    const groups: Record<string, string | undefined> = {};
    if (match.groups) {
      Object.assign(groups, match.groups);
    }

    matches.push({
      value: match[0],
      index: match.index,
      length: match[0].length,
      groups,
    });

    if (matches.length >= 1000) break;
  }

  return { valid: true, error: "", matches, matchCount: matches.length };
}
