import { describe, expect, it } from "vitest";
import { generateQrCode, rsEncode } from "./qr-code-generator.js";

/*
 * The engine is checked by an independent mini-decoder written from ISO/IEC 18004:
 * function-pattern map, format info, zig-zag codeword placement, the 8 data masks,
 * block de-interleaving, a Reed–Solomon syndrome check and byte-mode parsing.
 * If the engine's output decodes here, a real scanner reads it too.
 */

// ---- GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d) ----
const EXP = new Array<number>(512);
const LOG = new Array<number>(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// ISO 18004 table 9, error correction level M: EC codewords per block and data codewords per block.
const LEVEL_M: Record<number, { ec: number; blocks: number[] }> = {
  1: { ec: 10, blocks: [16] },
  2: { ec: 16, blocks: [28] },
  3: { ec: 26, blocks: [44] },
  4: { ec: 18, blocks: [32, 32] },
  5: { ec: 24, blocks: [43, 43] },
  6: { ec: 16, blocks: [27, 27, 27, 27] },
  7: { ec: 18, blocks: [31, 31, 31, 31] },
  8: { ec: 22, blocks: [38, 38, 39, 39] },
  9: { ec: 22, blocks: [36, 36, 36, 37, 37] },
  10: { ec: 26, blocks: [43, 43, 43, 43, 44] },
};
// ISO 18004 annex E: alignment pattern centre coordinates.
const ALIGN: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function functionMap(size: number, version: number): boolean[][] {
  const f = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < size && c < size) f[r][c] = true;
  };
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) mark(r, c); // finder + separator + format
  for (let r = 0; r < 9; r++) for (let c = size - 8; c < size; c++) mark(r, c);
  for (let r = size - 8; r < size; r++) for (let c = 0; c < 9; c++) mark(r, c);
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  const pos = ALIGN[version];
  const n = pos.length;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0)) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) mark(pos[a] + dr, pos[b] + dc);
    }
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        mark(i, size - 11 + j);
        mark(size - 11 + j, i);
      }
    }
  }
  return f;
}

/** Mask condition with x = column, y = row (ISO 18004 table 10). */
function maskHit(mask: number, y: number, x: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function bchFormat(data5: number): number {
  let rem = data5;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data5 << 10) | rem) ^ 0x5412;
}

function readFormat(m: boolean[][]): { copy1: number; copy2: number } {
  const size = m.length;
  const bit = (r: number, c: number) => (m[r][c] ? 1 : 0);
  let copy1 = 0;
  for (let i = 0; i <= 5; i++) copy1 |= bit(i, 8) << i;
  copy1 |= bit(7, 8) << 6;
  copy1 |= bit(8, 8) << 7;
  copy1 |= bit(8, 7) << 8;
  for (let i = 9; i < 15; i++) copy1 |= bit(8, 14 - i) << i;
  let copy2 = 0;
  for (let i = 0; i < 8; i++) copy2 |= bit(8, size - 1 - i) << i;
  for (let i = 8; i < 15; i++) copy2 |= bit(size - 15 + i, 8) << i;
  return { copy1, copy2 };
}

/**
 * Decode a level-M byte-mode QR matrix; throws on any structural error, and on a
 * Reed–Solomon checksum error unless `checkRs` is false.
 */
function decode(m: boolean[][], checkRs = true): string {
  const size = m.length;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || !LEVEL_M[version]) throw new Error(`bad size ${size}`);

  const fmt = readFormat(m).copy1;
  const data5 = (fmt ^ 0x5412) >>> 10;
  if (bchFormat(data5) !== fmt) throw new Error("format BCH mismatch");
  const ecl = data5 >>> 3;
  if (ecl !== 0) throw new Error(`expected level M (00), got ${ecl}`);
  const mask = data5 & 7;

  const fn = functionMap(size, version);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = upward ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        bits.push((m[y][x] ? 1 : 0) ^ (maskHit(mask, y, x) ? 1 : 0));
      }
    }
  }

  const { ec, blocks } = LEVEL_M[version];
  const total = blocks.reduce((a, b) => a + b, 0) + ec * blocks.length;
  const codewords: number[] = [];
  for (let i = 0; i < total; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i * 8 + k];
    codewords.push(b);
  }

  // de-interleave
  const dataBlocks = blocks.map(() => [] as number[]);
  const ecBlocks = blocks.map(() => [] as number[]);
  let p = 0;
  for (let i = 0; i < Math.max(...blocks); i++) {
    for (let b = 0; b < blocks.length; b++) if (i < blocks[b]) dataBlocks[b].push(codewords[p++]);
  }
  for (let i = 0; i < ec; i++)
    for (let b = 0; b < blocks.length; b++) ecBlocks[b].push(codewords[p++]);

  // RS syndromes S_i = C(α^i), i = 0..ec-1, must all vanish
  for (let b = 0; checkRs && b < blocks.length; b++) {
    const cw = [...dataBlocks[b], ...ecBlocks[b]];
    for (let i = 0; i < ec; i++) {
      let s = 0;
      for (const c of cw) s = mul(s, EXP[i]) ^ c;
      if (s !== 0) throw new Error(`RS syndrome ${i} of block ${b} is ${s}`);
    }
  }

  const stream = dataBlocks
    .flat()
    .flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((k) => (byte >> k) & 1));
  let q = 0;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | stream[q++];
    return v;
  };
  const mode = read(4);
  if (mode !== 0b0100) throw new Error(`expected byte mode, got ${mode}`);
  const count = read(version <= 9 ? 8 : 16);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = read(8);
  return new TextDecoder("utf-8", { fatal: true }).decode(out);
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

describe("generateQrCode — result shape", () => {
  it("returns an empty, error-free result for empty text", () => {
    expect(generateQrCode("")).toEqual({ matrix: [], version: 0, size: 0, error: null });
  });

  it("picks the smallest version that fits (byte mode, level M capacities)", () => {
    expect(generateQrCode("a".repeat(14))).toMatchObject({ version: 1, size: 21 });
    expect(generateQrCode("a".repeat(15))).toMatchObject({ version: 2, size: 25 });
    expect(generateQrCode("a".repeat(106))).toMatchObject({ version: 6, size: 41 });
    expect(generateQrCode("a".repeat(213))).toMatchObject({ version: 10, size: 57 });
    // Cyrillic is 2 UTF-8 bytes per letter: 7 letters = 14 bytes -> v1, 8 -> v2
    expect(generateQrCode("абвгдеж").version).toBe(1);
    expect(generateQrCode("абвгдежз").version).toBe(2);
  });

  it("reports an error past 213 bytes", () => {
    const r = generateQrCode("a".repeat(214));
    expect(r.matrix).toEqual([]);
    expect(r.error).toMatch(/too long/);
  });

  it("draws the three finder patterns and timing patterns", () => {
    const { matrix: m, size } = generateQrCode("finder check");
    const finder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const dark =
            r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          expect(m[r0 + r][c0 + c]).toBe(dark);
        }
      }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    // the always-dark module next to the bottom-left finder
    expect(m[size - 8][8]).toBe(true);
  });
});

describe("generateQrCode — data placement decodes back to the input (versions 1–10)", () => {
  const samples = [
    "a",
    "Hello, World!",
    "https://belun.app/",
    "Привет, мир! 👋",
    "WIFI:T:WPA;S:MyNet;P:secret;;",
    "x".repeat(14),
    "y".repeat(15),
    "The quick brown fox jumps over the lazy dog. 0123456789 ".repeat(1).trim(),
    "z".repeat(62),
    "q".repeat(84),
    "w".repeat(106),
    "v".repeat(107),
    "v".repeat(122),
    "8".repeat(123),
    "8".repeat(152),
    "9".repeat(153),
    "9".repeat(180),
    "t".repeat(181),
    "t".repeat(213),
    "Привет, мир! ".repeat(8),
  ];
  for (const text of samples) {
    it(`round-trips ${utf8Length(text)} bytes: ${JSON.stringify(text.slice(0, 24))}`, () => {
      const r = generateQrCode(text);
      expect(r.error).toBeNull();
      // placement, masking, format, byte-mode encoding and every RS block are verified
      expect(decode(r.matrix)).toBe(text);
    });
  }
});

describe("generateQrCode — spec details", () => {
  // Regression: rsEncode used to walk the generator polynomial low-to-high as if it were high-to-low, so every EC codeword was wrong
  it("emits valid Reed–Solomon error-correction codewords", () => {
    expect(decode(generateQrCode("Hello, World!").matrix, true)).toBe("Hello, World!");
  });

  it("matches the ISO/IEC 18004 'HELLO WORLD' 1-M reference EC codewords", () => {
    // annex I example: alphanumeric "HELLO WORLD", version 1-M
    const data = Uint8Array.from([
      32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
    ]);
    expect([...rsEncode(data, 10)]).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  // Regression: versions 7–10 used to omit the version-information blocks and skip the alignment patterns at (6, x)/(x, 6)
  it("round-trips a 107-byte payload (version 7)", () => {
    const text = "v".repeat(107);
    expect(decode(generateQrCode(text).matrix, false)).toBe(text);
  });

  it("writes both version-information blocks on versions 7–10 (ISO 18004 annex D)", () => {
    const expected: Record<number, number> = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
    const lengths: Record<number, number> = { 7: 107, 8: 123, 9: 153, 10: 181 };
    for (const v of [7, 8, 9, 10]) {
      const { matrix: m, version, size } = generateQrCode("a".repeat(lengths[v]));
      expect(version).toBe(v);
      let topRight = 0;
      let bottomLeft = 0;
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        topRight |= (m[b][a] ? 1 : 0) << i;
        bottomLeft |= (m[a][b] ? 1 : 0) << i;
      }
      expect(topRight).toBe(expected[v]);
      expect(bottomLeft).toBe(expected[v]);
    }
  });

  it("draws the alignment pattern centred at (6, 22) on version 7", () => {
    const { matrix: m } = generateQrCode("v".repeat(107));
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
        expect(m[6 + dr][22 + dc]).toBe(dark);
      }
    }
  });

  // Regression: the bottom-left copy of the format information used to hold bits 0–6 instead of bits 8–14 (ISO 18004 fig. 25)
  it("writes both copies of the format information identically", () => {
    const { copy1, copy2 } = readFormat(generateQrCode("format copies").matrix);
    expect(copy2).toBe(copy1);
  });
});
