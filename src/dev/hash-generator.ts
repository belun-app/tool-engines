/**
 * MD5, SHA-1, SHA-256 and SHA-512 hex digests of UTF-8 text: MD5 is implemented here, the
 * SHA family uses Web Crypto.
 */

export interface HashResult {
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function computeMd5(input: Uint8Array): string {
  const bytes: number[] = Array.from(input);
  const msgLen = bytes.length;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLen = msgLen * 8;
  for (let i = 0; i < 4; i++) bytes.push((bitLen >>> (i * 8)) & 0xff);
  for (let i = 0; i < 4; i++) bytes.push(0);

  const K = Array.from({ length: 64 }, (_, i) => (Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);
  const S = [
    [7, 12, 17, 22],
    [5, 9, 14, 20],
    [4, 11, 16, 23],
    [6, 10, 15, 21],
  ];

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let i = 0; i < bytes.length; i += 64) {
    const M = Array.from(
      { length: 16 },
      (_, j) =>
        (bytes[i + j * 4] |
          (bytes[i + j * 4 + 1] << 8) |
          (bytes[i + j * 4 + 2] << 16) |
          (bytes[i + j * 4 + 3] << 24)) >>>
        0,
    );

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let j = 0; j < 64; j++) {
      let F: number;
      let g: number;
      if (j < 16) {
        F = ((B & C) | (~B & D)) >>> 0;
        g = j;
      } else if (j < 32) {
        F = ((D & B) | (~D & C)) >>> 0;
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = (B ^ C ^ D) >>> 0;
        g = (3 * j + 5) % 16;
      } else {
        F = (C ^ (B | ~D)) >>> 0;
        g = (7 * j) % 16;
      }

      const rot = S[Math.floor(j / 16)][j % 4];
      const tmp = (F + A + K[j] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((tmp << rot) | (tmp >>> (32 - rot)))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  return [a0, b0, c0, d0]
    .flatMap((n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff])
    .map((b) => (b & 0xff).toString(16).padStart(2, "0"))
    .join("");
}

export async function generateHashes(text: string): Promise<HashResult> {
  if (!text) return { md5: "", sha1: "", sha256: "", sha512: "" };

  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  const [sha1Buf, sha256Buf, sha512Buf] = await Promise.all([
    crypto.subtle.digest("SHA-1", data),
    crypto.subtle.digest("SHA-256", data),
    crypto.subtle.digest("SHA-512", data),
  ]);

  return {
    md5: computeMd5(data),
    sha1: bufToHex(sha1Buf),
    sha256: bufToHex(sha256Buf),
    sha512: bufToHex(sha512Buf),
  };
}
