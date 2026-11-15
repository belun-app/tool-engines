/**
 * Unbiased random integers, floats, picks and shuffles over Web Crypto, with an optional
 * injectable source for seeded or scripted runs.
 *
 * Every function takes an optional `rng`: a `RandomSource`, which returns a uniformly
 * distributed unsigned 32-bit integer (0 to 2^32 - 1) on each call. Without one, values come
 * from `crypto.getRandomValues`. `seededRandom(seed)` gives a small deterministic source for
 * tests and reproducible output (not for secrets).
 *
 * Integers are drawn by rejection sampling: draws from the incomplete top block of the
 * 32-bit (or 53-bit) range are thrown away, so every result is exactly equally likely,
 * unlike `x % n`. When there is no Web Crypto and no `rng` was given, the functions throw
 * `SecureRandomUnavailableError` (code `"no-secure-random"`); callers that return result
 * objects check `hasSecureRandom()` first and report it in their own style.
 */

/** Returns a uniformly distributed unsigned 32-bit integer (0 to 2^32 - 1) per call. */
export type RandomSource = () => number;

/** Thrown when no `rng` is given and `crypto.getRandomValues` does not exist. */
export class SecureRandomUnavailableError extends Error {
  readonly code = "no-secure-random";
  constructor() {
    super("Secure random numbers are not available: crypto.getRandomValues is missing.");
    this.name = "SecureRandomUnavailableError";
  }
}

const TWO_32 = 2 ** 32;
const TWO_53 = 2 ** 53;

/** True when `crypto.getRandomValues` exists (browsers, Node 19+, Deno, Bun). */
export function hasSecureRandom(): boolean {
  return typeof globalThis.crypto?.getRandomValues === "function";
}

/** The default source: one `crypto.getRandomValues` word per call. */
export const secureRandom: RandomSource = () => {
  if (!hasSecureRandom()) throw new SecureRandomUnavailableError();
  const word = new Uint32Array(1);
  globalThis.crypto.getRandomValues(word);
  return word[0];
};

/** One 32-bit word from `rng`, or from Web Crypto when no source is given. */
export function randomUint32(rng?: RandomSource): number {
  const value = (rng ?? secureRandom)();
  return value >>> 0;
}

/**
 * Integer in [0, n), every value equally likely. `n` must be an integer from 1 to 2^53.
 * Ranges up to 2^32 use one word per draw; wider ranges combine two words into 53 bits.
 * A draw is rejected (and redrawn) when it falls into the last, incomplete multiple of `n`.
 */
export function randomInt(n: number, rng?: RandomSource): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_53) {
    throw new RangeError(`randomInt: n must be an integer from 1 to 2^53, got ${n}`);
  }
  if (n === 1) return 0;
  if (n <= TWO_32) {
    const limit = TWO_32 - (TWO_32 % n);
    for (;;) {
      const x = randomUint32(rng);
      if (x < limit) return x % n;
    }
  }
  const limit = TWO_53 - (TWO_53 % n);
  for (;;) {
    const x = (randomUint32(rng) & 0x1fffff) * TWO_32 + randomUint32(rng);
    if (x < limit) return x % n;
  }
}

/** Float in [0, 1) with 53 random bits (two words), like `Math.random()` but unbiased. */
export function randomFloat(rng?: RandomSource): number {
  const high = randomUint32(rng) >>> 5; // 27 bits
  const low = randomUint32(rng) >>> 6; // 26 bits
  return (high * 2 ** 26 + low) / TWO_53;
}

/** One element of a non-empty array, uniformly. Throws RangeError on an empty array. */
export function pick<T>(items: readonly T[], rng?: RandomSource): T {
  if (items.length === 0) throw new RangeError("pick: empty array");
  return items[randomInt(items.length, rng)];
}

/** A shuffled copy (Fisher–Yates): every order equally likely. The input is not changed. */
export function shuffle<T>(items: readonly T[], rng?: RandomSource): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deterministic source (mulberry32) for tests and reproducible output. Fast and well
 * spread, but predictable: never use it for passwords or keys.
 */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** A source that returns the given words in order, then throws: for tests. */
export function scriptedRandom(words: readonly number[]): RandomSource {
  let i = 0;
  return () => {
    if (i >= words.length) throw new Error("scriptedRandom: out of values");
    return words[i++];
  };
}
