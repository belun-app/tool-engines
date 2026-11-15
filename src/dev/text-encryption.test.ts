import { createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ITERATIONS,
  HEADER_BYTES,
  IV_BYTES,
  SALT_BYTES,
  VERSION,
  armor,
  base64ToBytes,
  bytesToBase64,
  decryptText,
  encryptText,
  looksEncrypted,
} from "./text-encryption.js";

// PBKDF2 is run at the 1,000-iteration floor to keep the suite fast; the default
// (600,000) is only checked as a constant.
const FAST = { iterations: 1000 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("constants", () => {
  it("describe the documented payload layout", () => {
    expect(VERSION).toBe(1);
    expect(SALT_BYTES).toBe(16);
    expect(IV_BYTES).toBe(12);
    expect(HEADER_BYTES).toBe(33);
    expect(DEFAULT_ITERATIONS).toBe(600_000);
  });
});

describe("bytesToBase64 / base64ToBytes", () => {
  it("agree with Buffer for every padding length", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString("base64"));
      if (n > 0) expect(Array.from(base64ToBytes(b64) ?? [])).toEqual(Array.from(bytes));
    }
  });

  it("ignores whitespace/newlines and rejects junk", () => {
    expect(Array.from(base64ToBytes("Zm9v\nYmFy") ?? [])).toEqual([...Buffer.from("foobar")]);
    expect(base64ToBytes("")).toBeNull();
    expect(base64ToBytes("Zm9v!")).toBeNull();
    expect(base64ToBytes("Zm9v-_")).toBeNull(); // base64url alphabet is not accepted
  });
});

describe("armor", () => {
  it("wraps into lines of the given width (minimum 8)", () => {
    expect(armor("a".repeat(130))).toBe(`${"a".repeat(64)}\n${"a".repeat(64)}\n${"a".repeat(2)}`);
    expect(armor("abcdefghij", 2)).toBe("abcdefgh\nij");
    expect(armor("")).toBe("");
  });
});

describe("encryptText / decryptText", () => {
  it("round-trips Unicode text", async () => {
    const text = "Секрет 🔐 — top secret";
    const enc = await encryptText(text, "пароль", FAST);
    expect(enc.ok).toBe(true);
    expect(enc.iterations).toBe(1000);
    expect(looksEncrypted(enc.output)).toBe(true);
    const dec = await decryptText(enc.output, "пароль");
    expect(dec).toEqual({ ok: true, output: text, iterations: 1000 });
  });

  it("writes the documented layout, decryptable by node:crypto independently", async () => {
    const enc = await encryptText("hello", "pw", FAST);
    const bytes = Buffer.from(enc.output, "base64");
    expect(bytes[0]).toBe(1);
    expect(bytes.readUInt32BE(1)).toBe(1000);
    const salt = bytes.subarray(5, 21);
    const iv = bytes.subarray(21, 33);
    const body = bytes.subarray(33);
    // ciphertext = plaintext length + 16-byte GCM tag
    expect(body.length).toBe(5 + 16);
    const key = pbkdf2Sync("pw", salt, 1000, 32, "sha256");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(body.subarray(body.length - 16));
    const plain = Buffer.concat([
      decipher.update(body.subarray(0, body.length - 16)),
      decipher.final(),
    ]);
    expect(plain.toString("utf8")).toBe("hello");
  });

  it("decrypts a payload produced independently by node:crypto", async () => {
    const salt = Buffer.alloc(16, 7);
    const iv = Buffer.alloc(12, 9);
    const key = pbkdf2Sync("secret", salt, 2000, 32, "sha256");
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([
      cipher.update("Привет", "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const header = Buffer.alloc(5);
    header[0] = 1;
    header.writeUInt32BE(2000, 1);
    const payload = Buffer.concat([header, salt, iv, ct]).toString("base64");
    expect(await decryptText(payload, "secret")).toEqual({
      ok: true,
      output: "Привет",
      iterations: 2000,
    });
  });

  it("uses fresh salt and IV each time", async () => {
    const a = await encryptText("same", "pw", FAST);
    const b = await encryptText("same", "pw", FAST);
    expect(a.output).not.toBe(b.output);
  });

  it("clamps iterations to 1,000..5,000,000", async () => {
    expect((await encryptText("x", "p", { iterations: 1 })).iterations).toBe(1000);
    expect((await encryptText("x", "p", { iterations: 1000.4 })).iterations).toBe(1000);
  });

  it("wraps output when asked and still decrypts it", async () => {
    const enc = await encryptText("a".repeat(100), "pw", { ...FAST, wrap: true });
    expect(enc.output).toContain("\n");
    expect(enc.output.split("\n")[0]).toHaveLength(64);
    expect((await decryptText(enc.output, "pw")).ok).toBe(true);
  });

  it("reports wrong password and tampering as wrong-password", async () => {
    const enc = await encryptText("hello", "right", FAST);
    expect(await decryptText(enc.output, "wrong")).toEqual({
      ok: false,
      output: "",
      error: "wrong-password",
    });
    const bytes = Buffer.from(enc.output, "base64");
    bytes[bytes.length - 1] ^= 1;
    expect((await decryptText(bytes.toString("base64"), "right")).error).toBe("wrong-password");
  });

  it("validates inputs without throwing", async () => {
    expect((await encryptText("", "p")).error).toBe("empty-text");
    expect((await encryptText("t", "")).error).toBe("empty-password");
    expect((await decryptText("  ", "p")).error).toBe("bad-format");
    expect((await decryptText("abc", "")).error).toBe("empty-password");
    expect((await decryptText("not base64!", "p")).error).toBe("bad-format");
    // header-only payload is too short
    expect((await decryptText(Buffer.alloc(33, 1).toString("base64"), "p")).error).toBe(
      "bad-format",
    );
    // version 2
    const v2 = Buffer.alloc(40, 0);
    v2[0] = 2;
    expect((await decryptText(v2.toString("base64"), "p")).error).toBe("unsupported-version");
    // iteration count 0 is outside the accepted range
    const zeroIter = Buffer.alloc(40, 0);
    zeroIter[0] = 1;
    expect((await decryptText(zeroIter.toString("base64"), "p")).error).toBe("bad-format");
    expect(looksEncrypted("hello")).toBe(false);
  });

  it("reports no-crypto when Web Crypto is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    expect((await encryptText("t", "p")).error).toBe("no-crypto");
    const payload = Buffer.concat([Buffer.from([1, 0, 0, 3, 232]), Buffer.alloc(40)]).toString(
      "base64",
    );
    expect((await decryptText(payload, "p")).error).toBe("no-crypto");
  });
});
