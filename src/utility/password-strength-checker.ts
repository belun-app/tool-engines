/**
 * Estimates password strength: character pool and entropy, penalties for common passwords,
 * sequences and repeats, a 0-4 score, crack time and hints.
 */

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export type PasswordLabel = "very-weak" | "weak" | "fair" | "strong" | "very-strong";

export type CrackTimeUnit =
  | "instant"
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "month"
  | "year"
  | "century";

export type PasswordFeedback =
  | "common"
  | "sequence"
  | "repeats"
  | "add-length"
  | "mix-case"
  | "add-numbers"
  | "add-symbols"
  | "excellent";

export interface CrackTime {
  value: number;
  unit: CrackTimeUnit;
}

export interface PasswordStrengthResult {
  length: number;
  hasLower: boolean;
  hasUpper: boolean;
  hasDigit: boolean;
  hasSymbol: boolean;
  /** Number of distinct characters the guessing pool would need to cover */
  poolSize: number;
  /** Raw Shannon-style entropy: length * log2(poolSize) */
  entropyBits: number;
  /** Entropy after penalising common passwords and obvious patterns */
  effectiveEntropyBits: number;
  score: PasswordScore;
  label: PasswordLabel;
  /** Estimated time for an offline attacker at 10 billion guesses/second */
  crackTimeSeconds: number;
  crackTime: CrackTime;
  feedback: PasswordFeedback[];
}

// A short list of the passwords that top every breach corpus. Attackers try
// these before anything else, so any hit collapses the strength to near zero.
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "12345",
  "111111",
  "000000",
  "123123",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "1q2w3e4r",
  "zaq12wsx",
  "abc123",
  "admin",
  "letmein",
  "welcome",
  "monkey",
  "dragon",
  "iloveyou",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "master",
  "hello",
  "freedom",
  "whatever",
  "trustno1",
  "starwars",
]);

// Keyboard rows and ordered runs used to detect predictable sequences.
const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];

const GUESSES_PER_SECOND = 1e10;
const SECONDS_PER_YEAR = 31_557_600;

function hasSequence(lower: string): boolean {
  for (const seq of SEQUENCES) {
    const reversed = [...seq].reverse().join("");
    for (const line of [seq, reversed]) {
      for (let i = 0; i + 4 <= line.length; i++) {
        if (lower.includes(line.slice(i, i + 4))) return true;
      }
    }
  }
  return false;
}

function bucketCrackTime(seconds: number): CrackTime {
  if (seconds < 1) return { value: 0, unit: "instant" };
  if (seconds >= SECONDS_PER_YEAR * 100) return { value: 0, unit: "century" };

  const units: [number, CrackTimeUnit][] = [
    [SECONDS_PER_YEAR, "year"],
    [2_629_800, "month"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];

  for (const [size, unit] of units) {
    if (seconds >= size) return { value: Math.round(seconds / size), unit };
  }
  return { value: 0, unit: "instant" };
}

const EMPTY: PasswordStrengthResult = {
  length: 0,
  hasLower: false,
  hasUpper: false,
  hasDigit: false,
  hasSymbol: false,
  poolSize: 0,
  entropyBits: 0,
  effectiveEntropyBits: 0,
  score: 0,
  label: "very-weak",
  crackTimeSeconds: 0,
  crackTime: { value: 0, unit: "instant" },
  feedback: [],
};

export function checkPasswordStrength(password: string): PasswordStrengthResult {
  if (!password) return { ...EMPTY, feedback: [] };

  const length = password.length;
  // Case is checked in any script, so a mixed-case Russian password is not told to "mix case".
  // The entropy pool below still counts ASCII letters only; other letters are symbols there.
  const hasLower = /\p{Ll}/u.test(password);
  const hasUpper = /\p{Lu}/u.test(password);
  const hasDigit = /[0-9]/.test(password);
  // Anything that is not a letter, digit, or whitespace counts as a symbol.
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (hasDigit) poolSize += 10;
  if (hasSymbol) poolSize += 33;
  if (poolSize === 0) poolSize = 1;

  const entropyBits = length * Math.log2(poolSize);

  const lower = password.toLowerCase();
  const isCommon = COMMON_PASSWORDS.has(lower);
  const hasRepeats = /(.)\1{2,}/.test(password);
  const hasSeq = hasSequence(lower);

  let effectiveEntropyBits = entropyBits;
  if (isCommon) effectiveEntropyBits = Math.min(effectiveEntropyBits, 8);
  if (hasRepeats) effectiveEntropyBits -= 8;
  if (hasSeq) effectiveEntropyBits -= 8;
  effectiveEntropyBits = Math.max(0, effectiveEntropyBits);

  let score: PasswordScore;
  if (effectiveEntropyBits < 28) score = 0;
  else if (effectiveEntropyBits < 36) score = 1;
  else if (effectiveEntropyBits < 60) score = 2;
  else if (effectiveEntropyBits < 120) score = 3;
  else score = 4;

  const label: PasswordLabel = (["very-weak", "weak", "fair", "strong", "very-strong"] as const)[
    score
  ];

  const crackTimeSeconds = 2 ** effectiveEntropyBits / (2 * GUESSES_PER_SECOND);

  const feedback: PasswordFeedback[] = [];
  if (isCommon) feedback.push("common");
  if (hasSeq) feedback.push("sequence");
  if (hasRepeats) feedback.push("repeats");
  if (length < 12) feedback.push("add-length");
  if (!hasLower || !hasUpper) feedback.push("mix-case");
  if (!hasDigit) feedback.push("add-numbers");
  if (!hasSymbol) feedback.push("add-symbols");
  if (feedback.length === 0 && score === 4) feedback.push("excellent");

  return {
    length,
    hasLower,
    hasUpper,
    hasDigit,
    hasSymbol,
    poolSize,
    entropyBits: Math.round(entropyBits),
    effectiveEntropyBits: Math.round(effectiveEntropyBits),
    score,
    label,
    crackTimeSeconds,
    crackTime: bucketCrackTime(crackTimeSeconds),
    feedback,
  };
}
