/**
 * Locale-aware number formatting and parsing in English or Russian notation.
 *
 * Pure and DOM-free: callers pass the page language (a browser wrapper can read it
 * from `document.documentElement.lang`).
 *
 * Formatting
 * - EN: "1,172,270.80", money "$1,172,270.80", percent "16.5%".
 * - RU: "1 172 270,80" (no-break space groups), money "1 172 270,80 ₽",
 *   percent "16,5 %" (no-break space before the sign, as Russian typography asks).
 * - Non-finite numbers format as "—" instead of "NaN" / "∞".
 *
 * Parsing (`parseDecimal`) accepts what people actually type or paste:
 * "3,5", "3.5", "1 000,50", "1,000.50", "1.000,50", NBSP / thin-space / narrow
 * NBSP / apostrophe grouping, a leading "+", "-" or "−", ".5", ",5", "5.",
 * and a stray currency or percent sign around the number. Anything else is
 * rejected with `{ ok: false }`, never guessed at.
 *
 * Ambiguous input is decided like this (documented and unit-tested):
 * - Exactly one comma followed by exactly three digits ("1,999", "12,500"):
 *   EN reads it as thousands grouping (1999), because that is how an English
 *   speaker writes the number; RU reads it as a decimal comma (1.999), because
 *   in Russian the comma is always the decimal sign. "0,999" is 0.999 everywhere
 *   (a group never starts with a lone 0).
 * - Exactly one dot ("1.999", "3.5") is always a decimal point, in both
 *   languages: a dot is what the numeric keypad types, and RU users who
 *   group thousands use spaces, not dots.
 * - Two or more of the same separator ("1,000,000", "1.000.000") is grouping
 *   and must form valid groups of three; otherwise the input is rejected.
 * - Both separators present: the last one is the decimal sign, the other is
 *   grouping (validated the same way). "1,000.50" and "1.000,50" are both 1000.5.
 * - Spaces are only accepted as grouping between valid groups of three:
 *   "1 000" is 1000, "12 5" is rejected (it is not silently 125).
 * - Exponents ("1e3") are rejected: nobody types them into a calculator field,
 *   and accepting them would let typos like "1e" pass.
 */

export type NumLang = "en" | "ru";

export function normalizeLang(lang: string | null | undefined): NumLang {
  return typeof lang === "string" && lang.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function localeFor(lang: string | null | undefined): string {
  return normalizeLang(lang) === "ru" ? "ru-RU" : "en-US";
}

export interface FormatNumberOptions {
  /** Fixed number of fraction digits (sets both min and max). */
  decimals?: number;
  /** Minimum fraction digits. Default 0. */
  minDecimals?: number;
  /** Maximum fraction digits. Default 2. */
  maxDecimals?: number;
  /** Thousands grouping. Default true. */
  grouping?: boolean;
}

/** What non-finite values (NaN, ±Infinity) are shown as. */
export const NOT_A_NUMBER = "—";

const NBSP = "\u00a0";

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(locale: string, min: number, max: number, grouping: boolean) {
  const key = `${locale}|${min}|${max}|${grouping ? 1 : 0}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      useGrouping: grouping,
    });
    formatterCache.set(key, f);
  }
  return f;
}

function clampDigits(n: number): number {
  return Math.min(20, Math.max(0, Math.round(n)));
}

/**
 * Formats a plain number for the page language.
 * `formatNumber(1234.5, "ru")` -> "1 234,5"; `formatNumber(1234.5, "en")` -> "1,234.5".
 */
export function formatNumber(
  n: number,
  lang: string | null | undefined,
  options: FormatNumberOptions = {},
): string {
  if (!Number.isFinite(n)) return NOT_A_NUMBER;
  let min = clampDigits(options.decimals ?? options.minDecimals ?? 0);
  let max = clampDigits(options.decimals ?? options.maxDecimals ?? Math.max(2, min));
  if (max < min) max = min;
  if (min > max) min = max;
  const out = getFormatter(localeFor(lang), min, max, options.grouping ?? true).format(n);
  // "-0" after rounding reads as a bug; show "0".
  return /^-0(?:[.,]0+)?$/.test(out) ? out.slice(1) : out;
}

export interface FormatMoneyOptions {
  /** Fraction digits. Default 2. */
  decimals?: number;
}

/**
 * Formats an amount with a currency symbol placed the way the page language
 * places it: "$1,172,270.80" on EN, "1 172 270,80 ₽" on RU. The symbol is
 * whatever the tool's currency picker holds ("$", "€", "₽", "₸", ...).
 */
export function formatMoney(
  n: number,
  symbol: string,
  lang: string | null | undefined,
  options: FormatMoneyOptions = {},
): string {
  if (!Number.isFinite(n)) return NOT_A_NUMBER;
  const decimals = options.decimals ?? 2;
  const body = formatNumber(Math.abs(n), lang, { decimals });
  const negative = n < 0 && body !== formatNumber(0, lang, { decimals });
  const sign = negative ? "-" : "";
  const sym = symbol.trim();
  if (!sym) return sign + body;
  if (normalizeLang(lang) === "ru") return `${sign}${body}${NBSP}${sym}`;
  // A word-like code ("USD", "CHF") needs a space; a sign ("$", "€") does not.
  return /^[A-Za-z]{2,}$/.test(sym) ? `${sign}${sym}${NBSP}${body}` : `${sign}${sym}${body}`;
}

/**
 * Formats a value that is already in percent units (16.5 means 16.5 %).
 * EN "16.5%", RU "16,5 %".
 */
export function formatPercent(
  n: number,
  lang: string | null | undefined,
  options: FormatNumberOptions = {},
): string {
  if (!Number.isFinite(n)) return NOT_A_NUMBER;
  const body = formatNumber(n, lang, { maxDecimals: 1, ...options });
  return normalizeLang(lang) === "ru" ? `${body}${NBSP}%` : `${body}%`;
}

export type ParseDecimalError = "empty" | "invalid";

export type ParseDecimalResult =
  | { ok: true; value: number }
  | { ok: false; error: ParseDecimalError };

// Space-like characters people (and Intl output) use to group digits.
const GROUP_SPACES = /[\s\u00a0\u2007\u2009\u202f'’]/g;
const HAS_GROUP_SPACE = /[\s\u00a0\u2007\u2009\u202f'’]/;
const CURRENCY_OR_PERCENT = /^[$€£¥₽₸₴₹₩¢%]+|[$€£¥₽₸₴₹₩¢%]+$/g;

function validGroups(intPart: string, sep: string): boolean {
  const groups = intPart.split(sep);
  if (groups.length === 1) return /^\d+$/.test(intPart);
  if (!/^\d{1,3}$/.test(groups[0])) return false;
  for (let i = 1; i < groups.length; i++) {
    if (!/^\d{3}$/.test(groups[i])) return false;
  }
  return true;
}

/**
 * Parses a decimal typed on an EN or RU page. See the module comment for the
 * exact rules on ambiguous input.
 */
export function parseDecimal(
  input: string | null | undefined,
  lang: string | null | undefined,
): ParseDecimalResult {
  if (input == null) return { ok: false, error: "empty" };
  let s = String(input).trim();
  if (s === "") return { ok: false, error: "empty" };

  // Currency / percent decorations around the number, then surrounding spaces.
  s = s.replace(CURRENCY_OR_PERCENT, "").trim();
  if (s === "") return { ok: false, error: "invalid" };

  let negative = false;
  if (/^[-−–+]/.test(s)) {
    negative = s[0] !== "+";
    s = s.slice(1).trim();
  }
  // A sign written after a currency symbol: "$-5" is rare; "-$5" is handled above.
  s = s.replace(CURRENCY_OR_PERCENT, "").trim();
  if (s === "") return { ok: false, error: "invalid" };

  // Space grouping: only between digits, and the groups must be valid.
  let spaceGrouped = false;
  if (HAS_GROUP_SPACE.test(s)) {
    const firstSep = s.search(/[.,]/);
    const intRaw = firstSep === -1 ? s : s.slice(0, firstSep);
    const rest = firstSep === -1 ? "" : s.slice(firstSep);
    if (HAS_GROUP_SPACE.test(rest)) return { ok: false, error: "invalid" };
    const normalized = intRaw.replace(GROUP_SPACES, " ").replace(/ +/g, " ");
    if (!validGroups(normalized, " ")) return { ok: false, error: "invalid" };
    s = normalized.replace(/ /g, "") + rest;
    spaceGrouped = true;
  }

  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return { ok: false, error: "invalid" };

  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let intPart: string;
  let fracPart = "";

  if (commas > 0 && dots > 0) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    const decSep = lastComma > lastDot ? "," : ".";
    const groupSep = decSep === "," ? "." : ",";
    if ((decSep === "," ? commas : dots) !== 1) return { ok: false, error: "invalid" };
    const at = s.lastIndexOf(decSep);
    intPart = s.slice(0, at);
    fracPart = s.slice(at + 1);
    if (spaceGrouped || !validGroups(intPart, groupSep)) return { ok: false, error: "invalid" };
    intPart = intPart.split(groupSep).join("");
  } else if (commas + dots === 0) {
    intPart = s;
  } else {
    const sep = commas > 0 ? "," : ".";
    const count = commas + dots;
    if (count > 1) {
      // Repeated separator: thousands grouping only.
      if (spaceGrouped || !validGroups(s, sep)) return { ok: false, error: "invalid" };
      intPart = s.split(sep).join("");
    } else {
      const at = s.indexOf(sep);
      const before = s.slice(0, at);
      const after = s.slice(at + 1);
      const looksGrouped =
        sep === "," &&
        normalizeLang(lang) === "en" &&
        !spaceGrouped &&
        /^\d{3}$/.test(after) &&
        /^[1-9]\d{0,2}$/.test(before);
      if (looksGrouped) {
        intPart = before + after;
      } else {
        intPart = before;
        fracPart = after;
      }
    }
  }

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return { ok: false, error: "invalid" };
  if (intPart === "" && fracPart === "") return { ok: false, error: "invalid" };

  const value = Number(`${intPart || "0"}.${fracPart || "0"}`);
  if (!Number.isFinite(value)) return { ok: false, error: "invalid" };
  return { ok: true, value: negative && value !== 0 ? -value : value };
}

/** `parseDecimal` that returns the number or NaN — a drop-in for `Number.parseFloat`. */
export function parseDecimalOrNaN(
  input: string | null | undefined,
  lang: string | null | undefined,
): number {
  const r = parseDecimal(input, lang);
  return r.ok ? r.value : Number.NaN;
}
