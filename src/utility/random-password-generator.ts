/**
 * Random passwords from selected character classes, drawn without modulo bias, with at
 * least one character of every selected class, and an exact entropy estimate.
 */
import { type RandomSource, hasSecureRandom, randomInt, shuffle } from "../_random.js";

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  /** Source of random 32-bit words; defaults to `crypto.getRandomValues` (see `_random`). */
  rng?: RandomSource;
}

export type PasswordStrength = "weak" | "fair" | "strong" | "very-strong";

export type PasswordErrorCode = "" | "no-charset" | "invalid-length" | "no-secure-random";

export interface PasswordResult {
  password: string;
  strength: PasswordStrength;
  /** Bits of entropy of the generated password, rounded (see `generatePassword`). */
  entropy: number;
  charsetSize: number;
  /** True when the requested length was outside MIN..MAX_PASSWORD_LENGTH or fractional. */
  clamped: boolean;
  /** Why no password was produced; "" on success. */
  errorCode: PasswordErrorCode;
}

export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 128;

const CHARS_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHARS_LOWER = "abcdefghijklmnopqrstuvwxyz";
const CHARS_NUMBERS = "0123456789";
const CHARS_SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?";

/** Rejection rounds before falling back to placing one character per class (see below). */
const MAX_ATTEMPTS = 1000;

const empty = (errorCode: PasswordErrorCode): PasswordResult => ({
  password: "",
  strength: "weak",
  entropy: 0,
  charsetSize: 0,
  clamped: false,
  errorCode,
});

/**
 * log2 of the number of strings of `length` over the union of `classes` that contain at
 * least one character of each class (inclusion–exclusion), computed as
 * length * log2(C) + log2(sum of (-1)^|S| * ((C - |S|) / C)^length) to stay in range.
 */
export function passwordEntropy(classSizes: readonly number[], length: number): number {
  const total = classSizes.reduce((a, b) => a + b, 0);
  if (total === 0 || length < 1) return 0;
  let sum = 0;
  const k = classSizes.length;
  for (let mask = 0; mask < 1 << k; mask++) {
    let excluded = 0;
    let bits = 0;
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i)) {
        excluded += classSizes[i];
        bits++;
      }
    }
    sum += (bits % 2 ? -1 : 1) * ((total - excluded) / total) ** length;
  }
  return sum > 0 ? length * Math.log2(total) + Math.log2(sum) : 0;
}

/**
 * Generate a password. Characters are drawn uniformly from the union of the selected
 * classes with rejection sampling (no `x % n` bias); a draw that misses a selected class is
 * thrown away and redrawn, so the result is uniform over all passwords that contain every
 * selected class. `entropy` counts exactly those passwords. The length is clamped to
 * MIN..MAX_PASSWORD_LENGTH (`clamped: true`). Without Web Crypto and without `rng`, the
 * result is empty with `errorCode: "no-secure-random"`.
 */
export function generatePassword(options: PasswordOptions): PasswordResult {
  const { length, uppercase, lowercase, numbers, symbols, rng } = options;

  const classes: string[] = [];
  if (uppercase) classes.push(CHARS_UPPER);
  if (lowercase) classes.push(CHARS_LOWER);
  if (numbers) classes.push(CHARS_NUMBERS);
  if (symbols) classes.push(CHARS_SYMBOLS);
  const charset = classes.join("");

  if (!charset) return empty("no-charset");
  // NaN (an empty or garbled length field) fails every comparison, so test it explicitly.
  if (!Number.isFinite(length) || length < 1) return empty("invalid-length");
  if (!rng && !hasSecureRandom()) return empty("no-secure-random");

  const safeLength = Math.min(
    Math.max(Math.floor(length), MIN_PASSWORD_LENGTH),
    MAX_PASSWORD_LENGTH,
  );
  const clamped = safeLength !== length;

  const draw = () => {
    let out = "";
    for (let i = 0; i < safeLength; i++) out += charset[randomInt(charset.length, rng)];
    return out;
  };
  const hasEveryClass = (pw: string) =>
    classes.every((cls) => [...pw].some((ch) => cls.includes(ch)));

  let password = draw();
  for (let attempt = 1; !hasEveryClass(password) && attempt < MAX_ATTEMPTS; attempt++) {
    password = draw();
  }
  if (!hasEveryClass(password)) {
    // Only reachable with a degenerate injected source: one character from each class,
    // the rest from the whole charset, then shuffled into random positions.
    const chars = classes.map((cls) => cls[randomInt(cls.length, rng)]);
    while (chars.length < safeLength) chars.push(charset[randomInt(charset.length, rng)]);
    password = shuffle(chars, rng).join("");
  }

  const entropy = passwordEntropy(
    classes.map((c) => c.length),
    safeLength,
  );

  let strength: PasswordStrength;
  if (entropy < 40) strength = "weak";
  else if (entropy < 60) strength = "fair";
  else if (entropy < 80) strength = "strong";
  else strength = "very-strong";

  return {
    password,
    strength,
    entropy: Math.round(entropy),
    charsetSize: charset.length,
    clamped,
    errorCode: "",
  };
}
