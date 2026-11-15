/**
 * Repeats a text a given number of times with a separator, optional numbering and escape
 * sequences, within a maximum count and output size.
 */

export interface RepeatTextOptions {
  /** How many copies of the input to produce. Clamped to 1…MAX_REPETITIONS. */
  count: number;
  /**
   * Text placed between copies. Backslash escapes `\n`, `\t` and `\\` are expanded,
   * so a separator of "\n" produces a real line break.
   */
  separator?: string;
  /** Prefix every copy with its ordinal, e.g. "1. text". */
  numbered?: boolean;
  /** Append the separator after the final copy too. */
  trailingSeparator?: boolean;
}

export interface RepeatTextResult {
  text: string;
  repetitions: number;
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  /** True when the result hit MAX_OUTPUT_CHARACTERS and was cut short. */
  truncated: boolean;
}

export const MAX_REPETITIONS = 100_000;
export const MAX_OUTPUT_CHARACTERS = 2_000_000;

const EMPTY: RepeatTextResult = {
  text: "",
  repetitions: 0,
  characters: 0,
  charactersNoSpaces: 0,
  words: 0,
  lines: 0,
  truncated: false,
};

/** Turn the literal two-character sequences \n, \r, \t and \\ into the characters they name. */
export function expandEscapes(raw: string): string {
  return raw.replace(/\\(.)/g, (match, char: string) => {
    if (char === "n") return "\n";
    if (char === "r") return "\r";
    if (char === "t") return "\t";
    if (char === "\\") return "\\";
    return match;
  });
}

export function repeatText(input: string, options: RepeatTextOptions): RepeatTextResult {
  const requested = Math.floor(Number(options.count));

  if (!input || !Number.isFinite(requested) || requested < 1) {
    return { ...EMPTY };
  }

  const count = Math.min(requested, MAX_REPETITIONS);
  const separator = expandEscapes(options.separator ?? "");
  const numbered = options.numbered === true;
  const trailingSeparator = options.trailingSeparator === true;

  const parts: string[] = [];
  let length = 0;
  let repetitions = 0;
  let truncated = false;

  for (let i = 0; i < count; i++) {
    const piece = numbered ? `${i + 1}. ${input}` : input;
    const chunk = i === 0 ? piece : separator + piece;

    if (length + chunk.length > MAX_OUTPUT_CHARACTERS) {
      truncated = true;
      break;
    }

    parts.push(chunk);
    length += chunk.length;
    repetitions++;
  }

  if (trailingSeparator && !truncated && separator) {
    parts.push(separator);
  }

  const text = parts.join("");

  return {
    text,
    repetitions,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, "").length,
    words: text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0,
    lines: text ? text.split(/\r\n|\r|\n/).length : 0,
    truncated,
  };
}
