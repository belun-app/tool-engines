/**
 * Converts an amount between two currencies with a table of exchange rates against any
 * common base currency, and reports invalid amounts and unknown currency codes.
 */

export interface RatesTable {
  rates: Record<string, number>;
  updated: string;
}

export interface CurrencyConversionResult {
  amount: number;
  from: string;
  to: string;
  converted: number;
  rate: number;
  inverseRate: number;
  /**
   * Set when nothing was converted; the numbers are then 0. Absent on success.
   * - `invalid-amount`: not a finite number, or below 0.
   * - `unknown-currency`: `from` or `to` has no rate in the table (see `unknownCurrency`).
   */
  error?: CurrencyErrorCode;
  /** The first code that had no rate, with `error: "unknown-currency"`. */
  unknownCurrency?: string;
}

export type CurrencyErrorCode = "invalid-amount" | "unknown-currency";

export const POPULAR_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "RUB",
  "INR",
  "CAD",
  "AUD",
  "CHF",
];

/**
 * Parse a rates API response into a normalized table. Accepts both the
 * open.er-api.com shape ({ rates, base_code, time_last_update_utc }) and the
 * frankfurter.dev shape ({ rates, base, date }). Returns an empty table on
 * anything malformed.
 */
export function parseRates(json: unknown): RatesTable {
  const empty: RatesTable = { rates: {}, updated: "" };
  if (!json || typeof json !== "object") return empty;
  const obj = json as Record<string, unknown>;
  if (!obj.rates || typeof obj.rates !== "object") return empty;

  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(obj.rates as Record<string, unknown>)) {
    const num = typeof value === "number" ? value : Number(value);
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(num) && num > 0) rates[code] = num;
  }

  // Frankfurter omits the base currency from its own rates table.
  const base =
    typeof obj.base_code === "string"
      ? obj.base_code
      : typeof obj.base === "string"
        ? obj.base
        : "";
  if (/^[A-Z]{3}$/.test(base) && !rates[base]) rates[base] = 1;

  const updated =
    typeof obj.time_last_update_utc === "string"
      ? obj.time_last_update_utc
      : typeof obj.date === "string"
        ? obj.date
        : "";

  return { rates, updated };
}

/**
 * Convert an amount between two currencies of a rates table (any common base). Bad input
 * gives zeros and an `error` code instead of throwing.
 */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): CurrencyConversionResult {
  const zero = (error: CurrencyErrorCode, unknownCurrency?: string): CurrencyConversionResult => ({
    amount: 0,
    from,
    to,
    converted: 0,
    rate: 0,
    inverseRate: 0,
    error,
    ...(unknownCurrency === undefined ? {} : { unknownCurrency }),
  });
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return zero("invalid-amount");
  }

  const rateOf = (code: string): number => {
    if (!rates || typeof code !== "string" || !Object.hasOwn(rates, code)) return 0;
    const r = rates[code];
    return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 0;
  };
  const fromRate = rateOf(from);
  const toRate = rateOf(to);
  if (!fromRate) return zero("unknown-currency", String(from));
  if (!toRate) return zero("unknown-currency", String(to));

  const rate = toRate / fromRate;
  return { amount, from, to, converted: amount * rate, rate, inverseRate: fromRate / toRate };
}

/** Localized display name for a currency code, falling back to the code itself. */
export function currencyName(code: string, locale = "en"): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** Format a converted amount with its currency code, e.g. "USD 1,234.56". */
export function formatAmount(value: number, code: string, locale = "en"): string {
  if (!Number.isFinite(value)) return "0";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "code",
    }).format(value);
  } catch {
    return `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} ${code}`;
  }
}

/** Format an exchange rate with enough precision for weak/strong currency pairs. */
export function formatRate(value: number, locale = "en"): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1) return value.toLocaleString(locale, { maximumFractionDigits: 4 });
  return value.toLocaleString(locale, { maximumSignificantDigits: 4 });
}
