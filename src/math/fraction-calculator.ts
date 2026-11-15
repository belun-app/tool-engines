export type FractionOperation = "add" | "subtract" | "multiply" | "divide";

export interface Fraction {
  numerator: number;
  denominator: number;
}

/**
 * Why a calculation has no result:
 * - `empty`: an operand is blank.
 * - `bad-input`: an operand is not a number, fraction, mixed number or short decimal, or the
 *   operation is unknown.
 * - `divide-by-zero`: dividing by a zero fraction.
 * - `overflow`: an operand or the simplified result does not fit in a safe integer
 *   (±9 007 199 254 740 991), so it cannot be shown exactly.
 */
export type FractionErrorCode = "empty" | "bad-input" | "divide-by-zero" | "overflow";

export interface FractionResult {
  valid: boolean;
  /** Reason when invalid ({@link FractionErrorCode}), "" when valid. */
  error: FractionErrorCode | "";
  /** Simplified numerator; carries the sign. */
  numerator: number;
  /** Simplified denominator; always positive when valid. */
  denominator: number;
  /** Whole part of the mixed-number form (0 for proper fractions). */
  whole: number;
  /** Numerator of the fractional part of the mixed-number form. */
  mixedNumerator: number;
  decimal: number;
  /** Improper-fraction form, e.g. "7/4" or "3". */
  text: string;
  /** Mixed-number form, e.g. "1 3/4". Equals `text` when there is no whole part. */
  mixedText: string;
}

function invalidResult(error: FractionErrorCode): FractionResult {
  return {
    valid: false,
    error,
    numerator: 0,
    denominator: 1,
    whole: 0,
    mixedNumerator: 0,
    decimal: 0,
    text: "",
    mixedText: "",
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1n;
}

export function simplify(fraction: Fraction): Fraction {
  let { numerator, denominator } = fraction;
  if (denominator < 0) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

/** An exact fraction with arbitrary-size parts, denominator > 0, in lowest terms. */
interface BigFraction {
  n: bigint;
  d: bigint;
}

function simplifyBig(numerator: bigint, denominator: bigint): BigFraction {
  const n = denominator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const g = gcdBig(n, d);
  return { n: n / g, d: d / g };
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const isSafe = (v: bigint) => v <= MAX_SAFE && v >= -MAX_SAFE;

/** Exact parse into a big fraction, or null when the text is not a recognisable number. */
function parseBig(input: string): BigFraction | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  const mixed = text.match(/^(-?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const sign = mixed[1] === "-" ? -1n : 1n;
    const den = BigInt(mixed[4]);
    if (den === 0n) return null;
    return simplifyBig(sign * (BigInt(mixed[2]) * den + BigInt(mixed[3])), den);
  }

  const fraction = text.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fraction) {
    const den = BigInt(fraction[2]);
    if (den === 0n) return null;
    return simplifyBig(BigInt(fraction[1]), den);
  }

  const decimal = text.match(/^(-?)(\d*)\.(\d+)$/);
  if (decimal) {
    const digits = decimal[3];
    if (digits.length > 9) return null;
    const sign = decimal[1] === "-" ? -1n : 1n;
    const den = 10n ** BigInt(digits.length);
    const whole = decimal[2] ? BigInt(decimal[2]) : 0n;
    return simplifyBig(sign * (whole * den + BigInt(digits)), den);
  }

  if (/^-?\d+$/.test(text)) return { n: BigInt(text), d: 1n };

  return null;
}

/**
 * Parse "3", "-3/4", "1 1/2", "-2 1/3", "0.75", or ".5" into a simplified fraction.
 * Returns null when the text is not a recognisable number, or when the simplified parts do
 * not fit in a safe integer.
 */
export function parseFraction(input: string): Fraction | null {
  const big = parseBig(input);
  if (!big || !isSafe(big.n) || !isSafe(big.d)) return null;
  return { numerator: Number(big.n), denominator: Number(big.d) };
}

function buildResult(fraction: BigFraction): FractionResult {
  const { n, d } = simplifyBig(fraction.n, fraction.d);
  if (!isSafe(n) || !isSafe(d)) return invalidResult("overflow");
  const numerator = Number(n);
  const denominator = Number(d);

  const whole = Number(n / d);
  const mixedNumerator = Math.abs(Number(n % d));
  const decimal = numerator / denominator;
  const text = denominator === 1 ? String(numerator) : `${numerator}/${denominator}`;

  let mixedText = text;
  if (denominator !== 1 && whole !== 0) {
    mixedText = `${whole} ${mixedNumerator}/${denominator}`;
  }

  return {
    valid: true,
    error: "",
    numerator,
    denominator,
    whole,
    mixedNumerator,
    decimal,
    text,
    mixedText,
  };
}

/**
 * Apply an arithmetic operation to two fraction strings.
 * Accepts whole numbers, fractions, mixed numbers, and decimals in either operand. The
 * arithmetic is exact (BigInt); a result too large to show exactly is the `overflow` error.
 */
export function calculateFractions(
  first: string,
  operation: FractionOperation,
  second: string,
): FractionResult {
  if (typeof first !== "string" || typeof second !== "string") return invalidResult("bad-input");
  if (!first.trim() || !second.trim()) return invalidResult("empty");

  const a = parseBig(first);
  const b = parseBig(second);
  if (!a || !b) return invalidResult("bad-input");
  if (!isSafe(a.n) || !isSafe(a.d) || !isSafe(b.n) || !isSafe(b.d)) {
    return invalidResult("overflow");
  }

  switch (operation) {
    case "add":
      return buildResult({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
    case "subtract":
      return buildResult({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
    case "multiply":
      return buildResult({ n: a.n * b.n, d: a.d * b.d });
    case "divide":
      if (b.n === 0n) return invalidResult("divide-by-zero");
      return buildResult({ n: a.n * b.d, d: a.d * b.n });
    default:
      return invalidResult("bad-input");
  }
}
