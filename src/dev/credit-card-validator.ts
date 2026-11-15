/**
 * Credit card number validation.
 *
 * Pure arithmetic and pattern matching — no DOM, no network. The Luhn checksum catches
 * typos and transpositions; the brand rules come from published IIN (issuer identification
 * number) ranges. A number that passes both is well-formed, not necessarily a live account.
 */

export type CardBrand =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "jcb"
  | "diners"
  | "unionpay"
  | "maestro"
  | "mir"
  | "unknown";

export interface BrandInfo {
  brand: CardBrand;
  label: string;
  /** Valid total digit lengths for this brand. */
  lengths: number[];
  /** Length of the CVV / CVC / CID security code. */
  cvvLength: number;
  /** Digit grouping used when the number is formatted for display. */
  gaps: number[];
}

export interface CardValidationResult {
  /** Input with every non-digit stripped out. */
  digits: string;
  /** Digits regrouped for display, e.g. "4111 1111 1111 1111". */
  formatted: string;
  brand: CardBrand;
  brandLabel: string;
  /** True when the Luhn check digit matches. */
  luhnValid: boolean;
  /** True when the digit count is valid for the detected brand. */
  lengthValid: boolean;
  /** Luhn passes, length fits the brand, and the brand is recognised. */
  valid: boolean;
  length: number;
  /** Expected lengths for the detected brand; empty when the brand is unknown. */
  expectedLengths: number[];
  cvvLength: number;
  /** The first 6 digits, which identify the issuer. Empty if fewer than 6 digits. */
  iin: string;
  /** Machine-readable reason the number was rejected, or "" when valid. */
  issue: "" | "empty" | "non-digits" | "unknown-brand" | "bad-length" | "luhn";
}

const BRANDS: BrandInfo[] = [
  { brand: "visa", label: "Visa", lengths: [13, 16, 19], cvvLength: 3, gaps: [4, 8, 12] },
  { brand: "mastercard", label: "Mastercard", lengths: [16], cvvLength: 3, gaps: [4, 8, 12] },
  { brand: "amex", label: "American Express", lengths: [15], cvvLength: 4, gaps: [4, 10] },
  { brand: "discover", label: "Discover", lengths: [16, 19], cvvLength: 3, gaps: [4, 8, 12] },
  { brand: "jcb", label: "JCB", lengths: [16, 17, 18, 19], cvvLength: 3, gaps: [4, 8, 12] },
  { brand: "diners", label: "Diners Club", lengths: [14, 16, 19], cvvLength: 3, gaps: [4, 10] },
  {
    brand: "unionpay",
    label: "UnionPay",
    lengths: [16, 17, 18, 19],
    cvvLength: 3,
    gaps: [4, 8, 12],
  },
  {
    brand: "maestro",
    label: "Maestro",
    lengths: [12, 13, 14, 15, 16, 17, 18, 19],
    cvvLength: 3,
    gaps: [4, 8, 12],
  },
  { brand: "mir", label: "Mir", lengths: [16, 17, 18, 19], cvvLength: 3, gaps: [4, 8, 12] },
];

const UNKNOWN: BrandInfo = {
  brand: "unknown",
  label: "Unknown",
  lengths: [],
  cvvLength: 3,
  gaps: [4, 8, 12],
};

export function getBrandInfo(brand: CardBrand): BrandInfo {
  return BRANDS.find((entry) => entry.brand === brand) ?? UNKNOWN;
}

export function listBrands(): BrandInfo[] {
  return BRANDS.map((entry) => ({ ...entry, lengths: [...entry.lengths], gaps: [...entry.gaps] }));
}

/** Numeric value of the first `count` digits, used for range comparisons. */
function prefix(digits: string, count: number): number {
  return Number.parseInt(digits.slice(0, count).padEnd(count, "0"), 10);
}

/**
 * Detect the card brand from its IIN prefix. Works on partial input so the UI can
 * show a brand while the user is still typing.
 */
export function detectBrand(digits: string): CardBrand {
  if (digits.length === 0) return "unknown";

  if (digits.startsWith("4")) return "visa";
  if (/^3[47]/.test(digits)) return "amex";

  const p2 = prefix(digits, 2);
  const p4 = prefix(digits, 4);
  const p6 = prefix(digits, 6);

  if (p2 >= 51 && p2 <= 55) return "mastercard";
  if (p6 >= 222100 && p6 <= 272099) return "mastercard";

  if (digits.startsWith("6011")) return "discover";
  if (p2 === 65) return "discover";
  if (p6 >= 644000 && p6 <= 649999) return "discover";
  if (p6 >= 622126 && p6 <= 622925) return "discover";

  if (p4 >= 2200 && p4 <= 2204) return "mir";
  if (p2 === 62 || p2 === 81) return "unionpay";
  if (/^35/.test(digits)) return "jcb";
  if (p2 === 36 || p2 === 38 || p2 === 39) return "diners";
  if (p4 >= 3000 && p4 <= 3059) return "diners";
  if (p2 === 50 || (p2 >= 56 && p2 <= 58) || p2 === 67) return "maestro";

  return "unknown";
}

/**
 * Luhn (mod 10) checksum. Doubles every second digit from the right, subtracts 9 from
 * any result above 9, and requires the total to be divisible by 10.
 */
export function luhnCheck(digits: string): boolean {
  if (digits.length < 2 || !/^\d+$/.test(digits)) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

export function formatCardNumber(digits: string, gaps: number[]): string {
  if (digits.length === 0) return "";
  const parts: string[] = [];
  let start = 0;
  for (const gap of gaps) {
    if (gap >= digits.length) break;
    parts.push(digits.slice(start, gap));
    start = gap;
  }
  parts.push(digits.slice(start));
  return parts.filter(Boolean).join(" ");
}

export function validateCardNumber(input: string): CardValidationResult {
  const digits = input.replace(/\D/g, "");
  const hadNonDigits = input.trim().length > 0 && /[^\d\s-]/.test(input);
  const brand = detectBrand(digits);
  const info = getBrandInfo(brand);
  const formatted = formatCardNumber(digits, info.gaps);

  const base = {
    digits,
    formatted,
    brand,
    brandLabel: info.label,
    length: digits.length,
    expectedLengths: [...info.lengths],
    cvvLength: info.cvvLength,
    iin: digits.length >= 6 ? digits.slice(0, 6) : "",
  };

  if (digits.length === 0) {
    return {
      ...base,
      luhnValid: false,
      lengthValid: false,
      valid: false,
      issue: input.trim().length > 0 ? "non-digits" : "empty",
    };
  }

  const luhnValid = luhnCheck(digits);
  const lengthValid = info.lengths.includes(digits.length);
  const valid = luhnValid && lengthValid && brand !== "unknown";

  let issue: CardValidationResult["issue"] = "";
  if (!valid) {
    if (hadNonDigits && brand === "unknown") issue = "non-digits";
    else if (brand === "unknown") issue = "unknown-brand";
    else if (!lengthValid) issue = "bad-length";
    else issue = "luhn";
  }

  return { ...base, luhnValid, lengthValid, valid, issue };
}
