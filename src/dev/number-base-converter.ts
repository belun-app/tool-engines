export type Base = 2 | 8 | 10 | 16;

/** Why an input could not be converted; the page shows a message for each code. */
export type BaseConvertError =
  /** A character that is not a digit of this base ("102" in binary, "G" in hex). */
  | "bad-digit"
  /** A minus sign: only non-negative whole numbers are converted. */
  | "negative"
  /** A decimal point or comma: fractions are not converted. */
  | "fraction"
  /** Longer than MAX_BITS bits. */
  | "too-large";

export interface BaseConvertResult {
  binary: string;
  octal: string;
  decimal: string;
  hex: string;
  isValid: boolean;
  /** Null when the field is valid or empty. */
  error: BaseConvertError | null;
  /** The value itself, for the step-by-step solution. */
  value: bigint | null;
}

const BASE_PATTERN: Record<Base, RegExp> = {
  2: /^[01]+$/,
  8: /^[0-7]+$/,
  10: /^[0-9]+$/,
  16: /^[0-9a-f]+$/i,
};

/** The prefix each base may be written with: 0b1010, 0o17, 0xFF. */
const PREFIX: Record<Base, RegExp | null> = {
  2: /^0b/i,
  8: /^0o/i,
  10: null,
  16: /^0x/i,
};

/** Largest accepted value: 2^64 − 1, the unsigned 64-bit range (as the page documents). */
export const MAX_BITS = 64;
const MAX_VALUE = (1n << BigInt(MAX_BITS)) - 1n;

function result(error: BaseConvertError | null, value: bigint | null = null): BaseConvertResult {
  if (value === null) {
    return { binary: "", octal: "", decimal: "", hex: "", isValid: false, error, value: null };
  }
  return {
    binary: value.toString(2),
    octal: value.toString(8),
    decimal: value.toString(10),
    hex: value.toString(16).toUpperCase(),
    isValid: true,
    error: null,
    value,
  };
}

/**
 * Reads a whole non-negative number written in `fromBase` and returns it in all
 * four bases, exactly (BigInt), up to MAX_BITS bits. Spaces and underscores
 * between digits are ignored ("1101 0011", "1_000"), and the usual prefix is
 * accepted (0b, 0o, 0x).
 */
export function convertBase(value: string, fromBase: Base): BaseConvertResult {
  let digits = value.trim().replace(/[\s_]/g, "");
  const prefix = PREFIX[fromBase];
  const hadPrefix = prefix ? prefix.test(digits) : false;
  if (prefix) digits = digits.replace(prefix, "");
  if (!digits) return result(hadPrefix ? "bad-digit" : null);

  if (!BASE_PATTERN[fromBase].test(digits)) {
    if (/^[-−]/.test(digits)) return result("negative");
    if (/[.,]/.test(digits)) return result("fraction");
    return result("bad-digit");
  }

  const radix = { 2: "0b", 8: "0o", 10: "", 16: "0x" }[fromBase];
  const n = BigInt(`${radix}${digits}`);
  if (n > MAX_VALUE) return result("too-large");
  return result(null, n);
}

/* ---------------------------------------------------------------------------
 * Step-by-step solution. The engine returns numbers and digits only; the page
 * writes the words ("remainder", "read the remainders bottom-up") in its own language.
 * ------------------------------------------------------------------------- */

const digitChar = (d: number) => d.toString(16).toUpperCase();

/** X → 10: every digit times its power of the base, then the sum. */
export interface PositionalSolution {
  kind: "positional";
  from: Base;
  terms: Array<{ digit: string; digitValue: number; power: number; product: bigint }>;
  result: bigint;
}

/** 10 → Y: repeated division by the base; the remainders read bottom-up. */
export interface DivisionSolution {
  kind: "division";
  to: Base;
  rows: Array<{ dividend: bigint; quotient: bigint; remainder: number; digit: string }>;
  result: string;
}

/** 2 ↔ 8 / 16: groups of 3 or 4 bits, each one digit. */
export interface GroupSolution {
  kind: "group";
  /** "pack": binary → octal/hex; "unpack": octal/hex → binary. */
  direction: "pack" | "unpack";
  groupBits: 3 | 4;
  groups: Array<{ bits: string; digit: string }>;
  binary: string;
  result: string;
}

/** 8 ↔ 16: through binary, unpacking then packing. */
export interface ViaBinarySolution {
  kind: "via-binary";
  first: GroupSolution;
  second: GroupSolution;
}

export type BaseSolution =
  | PositionalSolution
  | DivisionSolution
  | GroupSolution
  | ViaBinarySolution;

/** Steps are shown up to 64 bits; longer numbers would print hundreds of rows. */
export const SOLUTION_MAX_BITS = 64;

function groups(value: bigint, groupBits: 3 | 4) {
  let bin = value.toString(2);
  const pad = (groupBits - (bin.length % groupBits)) % groupBits;
  bin = "0".repeat(pad) + bin;
  const out: Array<{ bits: string; digit: string }> = [];
  for (let i = 0; i < bin.length; i += groupBits) {
    const bits = bin.slice(i, i + groupBits);
    out.push({ bits, digit: digitChar(Number.parseInt(bits, 2)) });
  }
  return out;
}

function group(value: bigint, base: 8 | 16, direction: "pack" | "unpack"): GroupSolution {
  const groupBits = base === 8 ? 3 : 4;
  return {
    kind: "group",
    direction,
    groupBits,
    groups: groups(value, groupBits),
    binary: value.toString(2),
    result: direction === "pack" ? value.toString(base).toUpperCase() : value.toString(2),
  };
}

/**
 * How to convert `value` from one base to another by hand, or null when the
 * bases are equal or the number is longer than SOLUTION_MAX_BITS.
 */
export function solveConversion(value: bigint, from: Base, to: Base): BaseSolution | null {
  if (from === to || value < 0n || value >= 1n << BigInt(SOLUTION_MAX_BITS)) return null;

  if (to === 10) {
    if (from === 10) return null;
    const digits = value.toString(from).toUpperCase();
    const terms = [...digits].map((digit, i) => {
      const power = digits.length - 1 - i;
      const digitValue = Number.parseInt(digit, from);
      return {
        digit,
        digitValue,
        power,
        product: BigInt(digitValue) * BigInt(from) ** BigInt(power),
      };
    });
    return { kind: "positional", from, terms, result: value };
  }

  if (from === 10) {
    const rows: DivisionSolution["rows"] = [];
    let n = value;
    const b = BigInt(to);
    do {
      const quotient = n / b;
      const remainder = Number(n % b);
      rows.push({ dividend: n, quotient, remainder, digit: digitChar(remainder) });
      n = quotient;
    } while (n > 0n);
    return { kind: "division", to, rows, result: value.toString(to).toUpperCase() };
  }

  if (from === 2) return group(value, to as 8 | 16, "pack");
  if (to === 2) return group(value, from as 8 | 16, "unpack");
  return {
    kind: "via-binary",
    first: group(value, from as 8 | 16, "unpack"),
    second: group(value, to as 8 | 16, "pack"),
  };
}
