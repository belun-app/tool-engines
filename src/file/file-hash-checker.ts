/**
 * Streaming MD5 / SHA-1 / SHA-256 checksums.
 *
 * Web Crypto can only digest a buffer it already holds in full, which rules it out for
 * multi-gigabyte downloads, and it never shipped MD5 at all. These are block-at-a-time
 * implementations so a caller can feed a file slice by slice and keep memory flat.
 */

export type HashAlgorithm = "md5" | "sha1" | "sha256";

export interface FileHashResult {
  md5: string;
  sha1: string;
  sha256: string;
}

export interface Hasher {
  update(chunk: Uint8Array): void;
  digest(): string;
}

export interface MultiHasher {
  update(chunk: Uint8Array): void;
  digest(): FileHashResult;
}

export interface HashComparison {
  /** Raw text the user pasted. */
  input: string;
  /** The hex run extracted from it, lowercased. Empty when nothing usable was found. */
  normalized: string;
  /** Guessed from the digest length, or null when the length matches nothing. */
  algorithm: HashAlgorithm | null;
  matched: boolean;
  status: "empty" | "invalid" | "match" | "mismatch";
}

const HEX = "0123456789abcdef";

function toHex(words: Int32Array, littleEndian: boolean): string {
  let out = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    for (let b = 0; b < 4; b++) {
      const shift = littleEndian ? b * 8 : 24 - b * 8;
      const byte = (w >>> shift) & 0xff;
      out += HEX[byte >>> 4] + HEX[byte & 0x0f];
    }
  }
  return out;
}

/**
 * Shared plumbing: buffer input into 64-byte blocks, then pad per Merkle-Damgard.
 * `lengthLittleEndian` is the one place MD5 and the SHA family disagree.
 */
function createBlockHasher(
  compress: (block: Uint8Array) => void,
  finish: () => string,
  lengthLittleEndian: boolean,
): Hasher {
  const buffer = new Uint8Array(64);
  let buffered = 0;
  let totalBytes = 0;
  let done = false;

  function update(chunk: Uint8Array): void {
    if (done || chunk.length === 0) return;
    totalBytes += chunk.length;
    let offset = 0;

    if (buffered > 0) {
      const need = 64 - buffered;
      const take = Math.min(need, chunk.length);
      buffer.set(chunk.subarray(0, take), buffered);
      buffered += take;
      offset = take;
      if (buffered < 64) return;
      compress(buffer);
      buffered = 0;
    }

    while (offset + 64 <= chunk.length) {
      compress(chunk.subarray(offset, offset + 64));
      offset += 64;
    }

    if (offset < chunk.length) {
      buffered = chunk.length - offset;
      buffer.set(chunk.subarray(offset), 0);
    }
  }

  function digest(): string {
    if (!done) {
      const tail = new Uint8Array(buffered < 56 ? 64 : 128);
      tail.set(buffer.subarray(0, buffered), 0);
      tail[buffered] = 0x80;

      // Byte counts above 2^32 are real for big ISOs, so split the bit length by hand
      // instead of relying on a 32-bit shift.
      const lo = (totalBytes * 8) >>> 0;
      const hi = Math.floor(totalBytes / 0x20000000) >>> 0;
      const end = tail.length;
      for (let i = 0; i < 4; i++) {
        const loByte = (lo >>> (i * 8)) & 0xff;
        const hiByte = (hi >>> (i * 8)) & 0xff;
        if (lengthLittleEndian) {
          tail[end - 8 + i] = loByte;
          tail[end - 4 + i] = hiByte;
        } else {
          tail[end - 1 - i] = loByte;
          tail[end - 5 - i] = hiByte;
        }
      }

      for (let i = 0; i < tail.length; i += 64) compress(tail.subarray(i, i + 64));
      done = true;
    }
    return finish();
  }

  return { update, digest };
}

const MD5_K = (() => {
  const k = new Int32Array(64);
  for (let i = 0; i < 64; i++) k[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  return k;
})();

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

export function createMd5(): Hasher {
  const state = Int32Array.from([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]);
  const m = new Int32Array(16);

  function compress(block: Uint8Array): void {
    for (let i = 0; i < 16; i++) {
      m[i] =
        block[i * 4] |
        (block[i * 4 + 1] << 8) |
        (block[i * 4 + 2] << 16) |
        (block[i * 4 + 3] << 24);
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }

      const tmp = (f + a + MD5_K[i] + m[g]) | 0;
      const rot = MD5_S[i];
      a = d;
      d = c;
      c = b;
      b = (b + ((tmp << rot) | (tmp >>> (32 - rot)))) | 0;
    }

    state[0] = (state[0] + a) | 0;
    state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0;
    state[3] = (state[3] + d) | 0;
  }

  return createBlockHasher(compress, () => toHex(state, true), true);
}

export function createSha1(): Hasher {
  const state = Int32Array.from([
    0x67452301,
    0xefcdab89 | 0,
    0x98badcfe | 0,
    0x10325476,
    0xc3d2e1f0 | 0,
  ]);
  const w = new Int32Array(80);

  function compress(block: Uint8Array): void {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (block[i * 4] << 24) |
        (block[i * 4 + 1] << 16) |
        (block[i * 4 + 2] << 8) |
        block[i * 4 + 3];
    }
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc | 0;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6 | 0;
      }

      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }

    state[0] = (state[0] + a) | 0;
    state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0;
    state[3] = (state[3] + d) | 0;
    state[4] = (state[4] + e) | 0;
  }

  return createBlockHasher(compress, () => toHex(state, false), false);
}

const SHA256_K = Int32Array.from([
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf | 0,
  0xe9b5dba5 | 0,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4 | 0,
  0xab1c5ed5 | 0,
  0xd807aa98 | 0,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe | 0,
  0x9bdc06a7 | 0,
  0xc19bf174 | 0,
  0xe49b69c1 | 0,
  0xefbe4786 | 0,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152 | 0,
  0xa831c66d | 0,
  0xb00327c8 | 0,
  0xbf597fc7 | 0,
  0xc6e00bf3 | 0,
  0xd5a79147 | 0,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e | 0,
  0x92722c85 | 0,
  0xa2bfe8a1 | 0,
  0xa81a664b | 0,
  0xc24b8b70 | 0,
  0xc76c51a3 | 0,
  0xd192e819 | 0,
  0xd6990624 | 0,
  0xf40e3585 | 0,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814 | 0,
  0x8cc70208 | 0,
  0x90befffa | 0,
  0xa4506ceb | 0,
  0xbef9a3f7 | 0,
  0xc67178f2 | 0,
]);

export function createSha256(): Hasher {
  const state = Int32Array.from([
    0x6a09e667,
    0xbb67ae85 | 0,
    0x3c6ef372,
    0xa54ff53a | 0,
    0x510e527f,
    0x9b05688c | 0,
    0x1f83d9ab,
    0x5be0cd19,
  ]);
  const w = new Int32Array(64);

  function compress(block: Uint8Array): void {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (block[i * 4] << 24) |
        (block[i * 4 + 1] << 16) |
        (block[i * 4 + 2] << 8) |
        block[i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];

    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i] + w[i]) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    state[0] = (state[0] + a) | 0;
    state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0;
    state[3] = (state[3] + d) | 0;
    state[4] = (state[4] + e) | 0;
    state[5] = (state[5] + f) | 0;
    state[6] = (state[6] + g) | 0;
    state[7] = (state[7] + h) | 0;
  }

  return createBlockHasher(compress, () => toHex(state, false), false);
}

/** Feeds every chunk to all three algorithms in one pass over the file. */
export function createFileHasher(): MultiHasher {
  const md5 = createMd5();
  const sha1 = createSha1();
  const sha256 = createSha256();

  return {
    update(chunk: Uint8Array): void {
      md5.update(chunk);
      sha1.update(chunk);
      sha256.update(chunk);
    },
    digest(): FileHashResult {
      return { md5: md5.digest(), sha1: sha1.digest(), sha256: sha256.digest() };
    },
  };
}

/** One-shot convenience wrapper for data already in memory. */
export function hashBytes(bytes: Uint8Array): FileHashResult {
  const hasher = createFileHasher();
  hasher.update(bytes);
  return hasher.digest();
}

const HASH_LENGTHS: Record<number, HashAlgorithm> = {
  32: "md5",
  40: "sha1",
  64: "sha256",
};

export const ALGORITHM_LABELS: Record<HashAlgorithm, string> = {
  md5: "MD5",
  sha1: "SHA-1",
  sha256: "SHA-256",
};

/**
 * Pull a digest out of whatever the user pasted. `sha256sum` prints
 * `<hash>  *filename`, Windows `certutil` prints the hash in spaced pairs, and
 * download pages love wrapping it in markup — all of those should still work.
 */
export function normalizeHash(input: string): string {
  const lower = input.toLowerCase();
  const direct = lower.match(/\b[0-9a-f]{32}\b|\b[0-9a-f]{40}\b|\b[0-9a-f]{64}\b/);
  if (direct) return direct[0];

  // certutil-style output: pairs of hex digits separated by spaces.
  const spaced = lower.replace(/[^0-9a-f]/g, "");
  if (HASH_LENGTHS[spaced.length]) return spaced;
  return "";
}

export function detectHashAlgorithm(hash: string): HashAlgorithm | null {
  return HASH_LENGTHS[hash.length] ?? null;
}

export function compareHash(result: FileHashResult | null, expected: string): HashComparison {
  const input = expected.trim();
  if (!input) {
    return { input, normalized: "", algorithm: null, matched: false, status: "empty" };
  }

  const normalized = normalizeHash(input);
  const algorithm = normalized ? detectHashAlgorithm(normalized) : null;
  if (!normalized || !algorithm) {
    return { input, normalized, algorithm: null, matched: false, status: "invalid" };
  }

  const matched = result !== null && result[algorithm] === normalized;
  return { input, normalized, algorithm, matched, status: matched ? "match" : "mismatch" };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}
