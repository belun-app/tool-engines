/** Fair random draw of one or more winners from a list of names (no repeats). */
import { type RandomSource, hasSecureRandom, randomInt } from "../_random.js";

export interface NamePickResult {
  /** The drawn names, in pick order */
  winners: string[];
  /** The list with the winners removed, original order preserved */
  remaining: string[];
  /** How many usable names were in the list */
  total: number;
  /** Set (and no winners drawn) when there is no Web Crypto and no `rng` was given. */
  error?: "no-secure-random";
}

export interface PickOptions {
  /** Source of random 32-bit words; defaults to `crypto.getRandomValues` (see `_random`). */
  rng?: RandomSource;
}

/** Split pasted text into one trimmed, non-empty name per line. */
export function parseNames(text: string): string[] {
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Draw `count` winners from a list of names with a partial Fisher–Yates
 * shuffle over crypto.getRandomValues, so every name has exactly the same
 * chance. Pure logic — no DOM. An empty list or non-positive count yields
 * empty winners rather than an error.
 */
export function pickNames(
  names: string[],
  count: number,
  options: PickOptions = {},
): NamePickResult {
  const list = Array.isArray(names) ? names.filter((n) => typeof n === "string" && n !== "") : [];
  const total = list.length;
  const wanted = Number.isFinite(count) ? Math.floor(count) : 0;

  if (total === 0 || wanted < 1) {
    return { winners: [], remaining: list, total };
  }

  const { rng } = options;
  if (!rng && !hasSecureRandom()) {
    return { winners: [], remaining: list, total, error: "no-secure-random" };
  }

  const n = Math.min(wanted, total);
  const indices = list.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(total - i, rng);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const picked = new Set(indices.slice(0, n));
  return {
    winners: indices.slice(0, n).map((i) => list[i]),
    remaining: list.filter((_, i) => !picked.has(i)),
    total,
  };
}
