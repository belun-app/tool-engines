/**
 * JSON pretty-printer, minifier and validator that never changes the data.
 *
 * The input is re-indented token by token, so numbers (big integers, `1.0`, `1e400`, `-0`)
 * and strings (including backslash-u escapes) are copied exactly as written, and duplicate
 * keys and key order are kept. `JSON.parse` is used only to validate and to produce the
 * error message.
 */

export interface FormatResult {
  formatted: string | null;
  error: string | null;
  isValid: boolean;
}

/** `JSON.parse` error message for invalid input, or null when the input is valid JSON. */
function parseError(input: string): string | null {
  try {
    JSON.parse(input);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid JSON";
  }
}

/** Indent unit the way `JSON.stringify` reads its `space` argument (at most 10 characters). */
function indentUnit(indent: number | string): string {
  if (typeof indent === "string") return indent.slice(0, 10);
  const n = Math.min(10, Math.max(0, Math.floor(Number.isFinite(indent) ? indent : 0)));
  return " ".repeat(n);
}

const isWs = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/**
 * Re-indent valid JSON text. One linear pass with no recursion, so any nesting depth that
 * `JSON.parse` accepts is fine. Layout matches `JSON.stringify(value, null, unit)`.
 */
function reindent(input: string, unit: string): string {
  const out: string[] = [];
  const n = input.length;
  let depth = 0;
  let i = 0;
  // After an opening bracket the line break is written lazily, so that `{}` and `[]`
  // stay on one line as JSON.stringify writes them.
  let pendingOpen = false;
  const newline = () => {
    if (unit) out.push(`\n${unit.repeat(depth)}`);
  };
  const flushOpen = () => {
    if (pendingOpen) {
      pendingOpen = false;
      newline();
    }
  };
  while (i < n) {
    const c = input.charCodeAt(i);
    if (isWs(c)) {
      i++;
      continue;
    }
    const ch = input[i];
    if (ch === "{" || ch === "[") {
      flushOpen();
      out.push(ch);
      depth++;
      pendingOpen = true;
      i++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (pendingOpen) pendingOpen = false;
      else newline();
      out.push(ch);
      i++;
    } else if (ch === ",") {
      out.push(",");
      newline();
      i++;
    } else if (ch === ":") {
      out.push(unit ? ": " : ":");
      i++;
    } else if (ch === '"') {
      flushOpen();
      let j = i + 1;
      while (j < n && input[j] !== '"') j += input[j] === "\\" ? 2 : 1;
      out.push(input.slice(i, j + 1));
      i = j + 1;
    } else {
      // Number or literal (true / false / null): copy the lexeme verbatim.
      flushOpen();
      let j = i;
      while (j < n && !isWs(input.charCodeAt(j)) && !",:]}".includes(input[j])) j++;
      out.push(input.slice(i, j));
      i = j;
    }
  }
  return out.join("");
}

function run(input: string, unit: string): FormatResult {
  const error = parseError(input);
  if (error !== null) return { formatted: null, error, isValid: false };
  return { formatted: reindent(input, unit), error: null, isValid: true };
}

/**
 * Pretty-print JSON with `indent` spaces (or an indent string, as `JSON.stringify` takes
 * it); 0 gives the compact form. Number and string lexemes are kept verbatim.
 */
export function formatJSON(input: string, indent: number | string = 2): FormatResult {
  return run(input, indentUnit(indent));
}

/** Remove all insignificant whitespace; number and string lexemes are kept verbatim. */
export function minifyJSON(input: string): FormatResult {
  return run(input, "");
}

export function validateJSON(input: string): { isValid: boolean; error: string | null } {
  const error = parseError(input);
  return { isValid: error === null, error };
}
