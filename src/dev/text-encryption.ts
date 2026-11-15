/**
 * Password-based text encryption using AES-256-GCM with PBKDF2-HMAC-SHA256 key
 * derivation, built on the Web Crypto API.
 *
 * Payload layout (before Base64):
 *   [0]      version byte (1)
 *   [1..4]   PBKDF2 iteration count, uint32 big-endian
 *   [5..20]  16-byte random salt
 *   [21..32] 12-byte random IV
 *   [33..]   AES-GCM ciphertext with the 16-byte authentication tag appended
 */

export const VERSION = 1;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const HEADER_BYTES = 1 + 4 + SALT_BYTES + IV_BYTES;
/** OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const DEFAULT_ITERATIONS = 600_000;
const MIN_ITERATIONS = 1_000;
const MAX_ITERATIONS = 5_000_000;

export type CryptoErrorCode =
  | "empty-text"
  | "empty-password"
  | "bad-format"
  | "wrong-password"
  | "unsupported-version"
  | "no-crypto";

export interface EncryptResult {
  ok: boolean;
  output: string;
  error?: CryptoErrorCode;
  iterations?: number;
}

export interface DecryptResult {
  ok: boolean;
  output: string;
  error?: CryptoErrorCode;
  iterations?: number;
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64_CHARS[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64_CHARS[b2 & 0x3f];
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array | null {
  const clean = value.replace(/[\s\r\n]+/g, "").replace(/=+$/, "");
  if (!clean || /[^A-Za-z0-9+/]/.test(clean)) return null;

  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let index = 0;

  for (const char of clean) {
    const value6 = B64_CHARS.indexOf(char);
    if (value6 < 0) return null;
    acc = (acc << 6) | value6;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (acc >> bits) & 0xff;
    }
  }

  return out.subarray(0, index);
}

/** Wraps a Base64 payload into fixed-width lines so it survives copy-paste in chat and email. */
export function armor(base64: string, lineLength = 64): string {
  const width = Math.max(8, Math.floor(lineLength));
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += width) {
    lines.push(base64.slice(i, i + width));
  }
  return lines.join("\n");
}

/** True when the input parses as a payload this tool could have produced. */
export function looksEncrypted(value: string): boolean {
  const bytes = base64ToBytes(value.trim());
  return !!bytes && bytes.length > HEADER_BYTES && bytes[0] === VERSION;
}

function getCrypto(): Crypto | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.subtle ? c : null;
}

async function deriveKey(
  subtle: SubtleCrypto,
  password: string,
  salt: Uint8Array,
  iterations: number,
  usage: KeyUsage,
): Promise<CryptoKey> {
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export interface EncryptOptions {
  iterations?: number;
  /** Break the Base64 output into 64-character lines. */
  wrap?: boolean;
}

export async function encryptText(
  text: string,
  password: string,
  options: EncryptOptions = {},
): Promise<EncryptResult> {
  if (!text) return { ok: false, output: "", error: "empty-text" };
  if (!password) return { ok: false, output: "", error: "empty-password" };

  const c = getCrypto();
  if (!c) return { ok: false, output: "", error: "no-crypto" };

  const iterations = Math.min(
    MAX_ITERATIONS,
    Math.max(MIN_ITERATIONS, Math.round(options.iterations ?? DEFAULT_ITERATIONS)),
  );

  const salt = c.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = c.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(c.subtle, password, salt, iterations, "encrypt");

  const cipher = new Uint8Array(
    await c.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      new TextEncoder().encode(text) as BufferSource,
    ),
  );

  const payload = new Uint8Array(HEADER_BYTES + cipher.length);
  payload[0] = VERSION;
  payload[1] = (iterations >>> 24) & 0xff;
  payload[2] = (iterations >>> 16) & 0xff;
  payload[3] = (iterations >>> 8) & 0xff;
  payload[4] = iterations & 0xff;
  payload.set(salt, 5);
  payload.set(iv, 5 + SALT_BYTES);
  payload.set(cipher, HEADER_BYTES);

  const base64 = bytesToBase64(payload);
  return {
    ok: true,
    output: options.wrap ? armor(base64) : base64,
    iterations,
  };
}

export async function decryptText(payload: string, password: string): Promise<DecryptResult> {
  const trimmed = payload.trim();
  if (!trimmed) return { ok: false, output: "", error: "bad-format" };
  if (!password) return { ok: false, output: "", error: "empty-password" };

  const bytes = base64ToBytes(trimmed);
  if (!bytes || bytes.length <= HEADER_BYTES) {
    return { ok: false, output: "", error: "bad-format" };
  }
  if (bytes[0] !== VERSION) {
    return { ok: false, output: "", error: "unsupported-version" };
  }

  const c = getCrypto();
  if (!c) return { ok: false, output: "", error: "no-crypto" };

  const iterations = ((bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    return { ok: false, output: "", error: "bad-format" };
  }

  const salt = bytes.slice(5, 5 + SALT_BYTES);
  const iv = bytes.slice(5 + SALT_BYTES, HEADER_BYTES);
  const cipher = bytes.slice(HEADER_BYTES);

  try {
    const key = await deriveKey(c.subtle, password, salt, iterations, "decrypt");
    const plain = await c.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
    return { ok: true, output: new TextDecoder().decode(plain), iterations };
  } catch {
    // AES-GCM fails the authentication tag check on a wrong password or on any
    // tampering with the payload; the two are indistinguishable by design.
    return { ok: false, output: "", error: "wrong-password" };
  }
}
