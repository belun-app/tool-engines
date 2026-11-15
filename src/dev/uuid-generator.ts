/**
 * Version-4 UUIDs (RFC 9562) from cryptographically random bytes, in batches of up to
 * MAX_UUIDS.
 */
import { type RandomSource, hasSecureRandom, randomUint32 } from "../_random.js";

export interface UuidGenerateResult {
  uuids: string[];
  /** True when the requested count was outside MIN_UUIDS..MAX_UUIDS, fractional or not a number. */
  clamped: boolean;
  /** "no-secure-random" when there is no Web Crypto and no `rng`; "" otherwise. */
  error: "" | "no-secure-random";
}

export interface UuidOptions {
  /** Source of random 32-bit words; defaults to `crypto.getRandomValues` (see `_random`). */
  rng?: RandomSource;
}

export const MIN_UUIDS = 1;
export const MAX_UUIDS = 100;

/**
 * RFC 9562 (formerly 4122) version-4 UUID from 16 random bytes, with the version nibble
 * set to 4 and the variant bits to 10.
 */
function generateUuidV4(rng?: RandomSource): string {
  const bytes = new Uint8Array(16);
  if (rng) {
    for (let i = 0; i < 16; i += 4) {
      const word = randomUint32(rng);
      bytes[i] = word >>> 24;
      bytes[i + 1] = (word >>> 16) & 0xff;
      bytes[i + 2] = (word >>> 8) & 0xff;
      bytes[i + 3] = word & 0xff;
    }
  } else {
    globalThis.crypto.getRandomValues(bytes);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate `count` v4 UUIDs. The count is floored and clamped to MIN_UUIDS..MAX_UUIDS
 * (a missing or non-numeric count gives one UUID); `clamped` says when that happened.
 */
export function generateUuids(
  count: number,
  uppercase = false,
  options: UuidOptions = {},
): UuidGenerateResult {
  const floored = Math.floor(count);
  const n = Math.max(MIN_UUIDS, Math.min(MAX_UUIDS, floored || MIN_UUIDS));
  const clamped = n !== count;
  const rng = options.rng;
  if (!rng && !hasSecureRandom()) return { uuids: [], clamped, error: "no-secure-random" };
  const uuids: string[] = [];
  for (let i = 0; i < n; i++) {
    const uuid = generateUuidV4(rng);
    uuids.push(uppercase ? uuid.toUpperCase() : uuid);
  }
  return { uuids, clamped, error: "" };
}
