/**
 * Roman numeral converter — standard additive/subtractive notation, 1 to 3999.
 *
 * Both directions share one result shape. The breakdown splits a value by place (thousands,
 * hundreds, tens, units) so a UI can show how MMXXIV is built from MM + XX + IV.
 */

export interface RomanBreakdownPart {
  roman: string;
  arabic: number;
}

/**
 * Stable identifier for each failure mode. The `error` field carries English prose; UIs that
 * render in another language switch on this instead of matching strings.
 */
export type RomanErrorCode = "not-integer" | "below-one" | "above-max" | "bad-letters" | "bad-form";

export interface RomanResult {
  ok: boolean;
  /** Canonical Roman numeral (empty when input is blank or invalid). */
  roman: string;
  /** Arabic value, or null when input is blank or invalid. */
  arabic: number | null;
  /** Human-readable problem in English, or "" when there is none. */
  error: string;
  /** Machine-readable form of `error`, or null when there is none. */
  code: RomanErrorCode | null;
  /** Place-value decomposition, e.g. [{roman:"MM",arabic:2000},{roman:"XX",arabic:20}]. */
  breakdown: RomanBreakdownPart[];
  /**
   * For a malformed numeral whose letters still add up to 1..3999 (IIII, IC, VV): the
   * canonical numeral for that value, so a UI can ask "did you mean IV (4)?".
   */
  suggestion?: RomanBreakdownPart;
}

/** The largest value standard Roman numerals represent without a vinculum. */
export const MAX_ROMAN = 3999;

const NUMERALS: Array<[number, string]> = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

const THOUSANDS = ["", "M", "MM", "MMM"];
const HUNDREDS = ["", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM"];
const TENS = ["", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC"];
const ONES = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

/** Canonical form of a number in 1..3999, along with its place-value parts. */
function decompose(n: number): { roman: string; breakdown: RomanBreakdownPart[] } {
  const t = Math.floor(n / 1000);
  const h = Math.floor((n % 1000) / 100);
  const te = Math.floor((n % 100) / 10);
  const o = n % 10;

  const breakdown: RomanBreakdownPart[] = [];
  if (t) breakdown.push({ roman: THOUSANDS[t], arabic: t * 1000 });
  if (h) breakdown.push({ roman: HUNDREDS[h], arabic: h * 100 });
  if (te) breakdown.push({ roman: TENS[te], arabic: te * 10 });
  if (o) breakdown.push({ roman: ONES[o], arabic: o });

  return { roman: THOUSANDS[t] + HUNDREDS[h] + TENS[te] + ONES[o], breakdown };
}

const EMPTY: RomanResult = {
  ok: false,
  roman: "",
  arabic: null,
  error: "",
  code: null,
  breakdown: [],
};

/**
 * A whole number as people type it: digits with an optional sign, thousands optionally
 * grouped by spaces ("2 026"). JavaScript literals such as 1e3, 0x10 or 0b11 are not
 * numbers here, so they are refused instead of silently converted.
 */
const WHOLE_NUMBER = /^[+-]?(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)$/;

/** Converts an Arabic number (or its string form) to a Roman numeral. */
export function arabicToRoman(value: number | string): RomanResult {
  const trimmed = typeof value === "string" ? value.trim() : value;
  if (trimmed === "") return { ...EMPTY };

  const n =
    typeof trimmed === "number"
      ? trimmed
      : WHOLE_NUMBER.test(trimmed)
        ? Number(trimmed.replace(/[ \u00a0\u202f]/g, ""))
        : Number.NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ...EMPTY, error: "Enter a whole number.", code: "not-integer" };
  }
  if (n <= 0) {
    return {
      ...EMPTY,
      error: "Roman numerals start at 1 — there's no symbol for zero or negatives.",
      code: "below-one",
    };
  }
  if (n > MAX_ROMAN) {
    return {
      ...EMPTY,
      error: "Standard Roman numerals stop at 3999 (MMMCMXCIX).",
      code: "above-max",
    };
  }

  const { roman, breakdown } = decompose(n);
  return { ok: true, roman, arabic: n, error: "", code: null, breakdown };
}

/**
 * Cyrillic letters that look exactly like Roman numerals. Russian texts very often type
 * centuries with them («ХХ век»), and the difference is invisible to the reader.
 */
const CYRILLIC_LOOKALIKES: Record<string, string> = {
  Х: "X",
  х: "x",
  С: "C",
  с: "c",
  М: "M",
  м: "m",
  І: "I",
  і: "i",
  Ӏ: "I",
};

/** Text form of an input that should be a string: `null`/`undefined` → "", others `String()`. */
function asText(input: unknown): string {
  if (typeof input === "string") return input;
  return input === null || input === undefined ? "" : String(input);
}

/**
 * Brings look-alike input to plain Latin letters: the Unicode Roman numeral signs
 * (Ⅻ, ⅿ — NFKC turns them into XII, m) and Cyrillic Х, С, М, І.
 */
export function normalizeRomanInput(input: string): string {
  return asText(input)
    .normalize("NFKC")
    .replace(/[ХхСсМмІіӀ]/g, (ch) => CYRILLIC_LOOKALIKES[ch] ?? ch);
}

const VALUE: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** Reads letters the naive way (a smaller letter before a larger one subtracts). */
function looseValue(letters: string): number {
  let total = 0;
  for (let i = 0; i < letters.length; i++) {
    const v = VALUE[letters[i]];
    const next = VALUE[letters[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

/**
 * Converts a Roman numeral string to its Arabic value, validating canonical form. A
 * non-string input is read as its `String()` form (`null`/`undefined` as empty).
 */
export function romanToArabic(input: string): RomanResult {
  const cleaned = normalizeRomanInput(input).trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) return { ...EMPTY };

  if (!/^[MDCLXVI]+$/.test(cleaned)) {
    return {
      ...EMPTY,
      roman: cleaned,
      error: "Use only the letters M, D, C, L, X, V and I.",
      code: "bad-letters",
    };
  }
  if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(cleaned)) {
    const loose = looseValue(cleaned);
    const suggestion =
      loose >= 1 && loose <= MAX_ROMAN
        ? { roman: decompose(loose).roman, arabic: loose }
        : undefined;
    return {
      ...EMPTY,
      roman: cleaned,
      error: `"${cleaned}" isn't a valid Roman numeral — check the order and repeats (e.g. IIII should be IV).`,
      code: "bad-form",
      ...(suggestion ? { suggestion } : {}),
    };
  }

  let rest = cleaned;
  let total = 0;
  for (const [val, sym] of NUMERALS) {
    while (rest.startsWith(sym)) {
      total += val;
      rest = rest.slice(sym.length);
    }
  }

  return {
    ok: true,
    roman: cleaned,
    arabic: total,
    error: "",
    code: null,
    breakdown: decompose(total).breakdown,
  };
}

export type DateOrder = "dmy" | "mdy";

export type RomanDateErrorCode = "bad-date" | "bad-day" | "bad-month";

export interface RomanDateResult {
  ok: boolean;
  /** Which way the input was read: digits to numerals, or numerals back to digits. */
  direction: "toRoman" | "toArabic" | null;
  /** The converted date with `separator` between the parts. */
  output: string;
  /** The parts in the order they were typed, in both notations. */
  parts: RomanBreakdownPart[];
  code: RomanDateErrorCode | null;
}

const DATE_SPLIT = /\s*[./\\·\-–—]\s*|\s+/;

/**
 * Converts a date written with digits (14.11.2026, 11/14/2026) into Roman numerals
 * part by part (XIV.XI.MMXXVI), or a Roman date back into digits. `order` says where the
 * day and the month are, so 31.13.2026 is refused rather than converted. Two parts are
 * read as month and year (XI.MMXXVI); a day and month without a year are not a date here.
 * A year-first date (ISO 2026-11-14) is read as year-month-day and keeps that order.
 */
export function convertRomanDate(
  input: string,
  order: DateOrder = "dmy",
  separator = ".",
): RomanDateResult {
  const empty: RomanDateResult = { ok: false, direction: null, output: "", parts: [], code: null };
  const trimmed = asText(input).trim();
  if (!trimmed) return empty;

  const raw = trimmed.split(DATE_SPLIT).filter(Boolean);
  if (raw.length < 2 || raw.length > 3) return { ...empty, code: "bad-date" };

  const digits = raw.every((p) => /^\d+$/.test(p));
  const parts: RomanBreakdownPart[] = [];
  for (const p of raw) {
    const r = digits ? arabicToRoman(p) : romanToArabic(p);
    if (!r.ok || r.arabic === null) return { ...empty, code: "bad-date" };
    parts.push({ roman: r.roman, arabic: r.arabic });
  }

  // A first part above 31 can be neither a day nor a month: the date is year first, as in
  // ISO 2026-11-14 (or MMXXVI.XI.XIV), whatever the page's usual order.
  const roles: Array<"day" | "month" | "year"> =
    parts.length === 2
      ? ["month", "year"]
      : parts[0].arabic > 31
        ? ["year", "month", "day"]
        : order === "dmy"
          ? ["day", "month", "year"]
          : ["month", "day", "year"];
  for (let i = 0; i < parts.length; i++) {
    const v = parts[i].arabic;
    if (roles[i] === "day" && v > 31) return { ...empty, code: "bad-day" };
    if (roles[i] === "month" && v > 12) return { ...empty, code: "bad-month" };
  }
  // Day 31 in a 30-day month, or 29 February in a common year.
  const day = roles.indexOf("day");
  const month = roles.indexOf("month");
  const year = roles.indexOf("year");
  if (day >= 0) {
    const y = parts[year].arabic;
    const m = parts[month].arabic;
    const daysIn = new Date(Date.UTC(2000, m, 0)).getUTCDate();
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const max = m === 2 ? (leap ? 29 : 28) : daysIn;
    if (parts[day].arabic > max) return { ...empty, code: "bad-day" };
  }

  const output = digits
    ? parts.map((p) => p.roman).join(separator)
    : parts
        .map((p, i) => (roles[i] === "year" ? String(p.arabic) : String(p.arabic).padStart(2, "0")))
        .join(separator);
  return { ok: true, direction: digits ? "toRoman" : "toArabic", output, parts, code: null };
}
