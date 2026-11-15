/**
 * QR code encoder (ISO/IEC 18004): chooses the version, adds Reed-Solomon error correction,
 * places and masks the modules, and returns the module matrix.
 */

export interface QrCodeResult {
  matrix: boolean[][];
  version: number;
  size: number;
  error: string | null;
}

// GF(256) tables for Reed-Solomon
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfPow(x: number, power: number): number {
  return GF_EXP[(GF_LOG[x] * power) % 255];
}

/**
 * Generator polynomial (x - α^0)(x - α^1)…(x - α^(degree-1)), coefficients
 * low-to-high: g[j] is the coefficient of x^j and g[degree] = 1.
 */
function rsGeneratorPoly(degree: number): Uint8Array {
  const g = new Uint8Array(degree + 1);
  g[0] = 1;
  for (let i = 0; i < degree; i++) {
    const root = gfPow(2, i);
    for (let j = i + 1; j > 0; j--) {
      g[j] = g[j - 1] ^ gfMul(g[j], root);
    }
    g[0] = gfMul(g[0], root);
  }
  return g;
}

/**
 * Reed–Solomon error-correction codewords: the remainder of data(x)·x^ecLen
 * divided by the generator. The message is high-to-low (result[i] is the
 * highest remaining term), so the generator is walked from its leading
 * coefficient g[ecLen] down to g[0].
 */
export function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const result = new Uint8Array(data.length + ecLen);
  result.set(data);
  for (let i = 0; i < data.length; i++) {
    const c = result[i];
    if (c !== 0) {
      for (let j = 0; j <= ecLen; j++) {
        result[i + j] ^= gfMul(gen[ecLen - j], c);
      }
    }
  }
  return result.slice(data.length);
}

// ECC level M: [totalDataCodewords, ecPerBlock, g1Blocks, g1DataPerBlock, g2Blocks, g2DataPerBlock]
const EC_TABLE: Array<[number, number, number, number, number, number]> = [
  [0, 0, 0, 0, 0, 0], // v0 placeholder
  [16, 10, 1, 16, 0, 0], // v1
  [28, 16, 1, 28, 0, 0], // v2
  [44, 26, 1, 44, 0, 0], // v3
  [64, 18, 2, 32, 0, 0], // v4
  [86, 24, 2, 43, 0, 0], // v5
  [108, 16, 4, 27, 0, 0], // v6
  [124, 18, 4, 31, 0, 0], // v7
  [154, 22, 2, 38, 2, 39], // v8
  [182, 22, 3, 36, 2, 37], // v9
  [216, 26, 4, 43, 1, 44], // v10
];

// Max bytes capacity in byte mode with ECC-M per version
const BYTE_CAPACITY = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

// Alignment pattern center positions per version
const ALIGN_POS: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// Remainder bits per version (appended after data+EC)
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

function toUtf8(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const lo = str.charCodeAt(++i);
      code = ((code - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function pushBits(arr: number[], val: number, len: number): void {
  for (let i = len - 1; i >= 0; i--) arr.push((val >> i) & 1);
}

function bitsToBytes(bits: number[]): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i * 8 + j] ?? 0);
    bytes[i] = b;
  }
  return bytes;
}

function setMod(
  m: number[][],
  func: boolean[][],
  r: number,
  c: number,
  val: number,
  isFunc: boolean,
): void {
  m[r][c] = val;
  func[r][c] = isFunc;
}

function placeFinderPattern(m: number[][], func: boolean[][], row: number, col: number): void {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const dark =
        r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      setMod(m, func, row + r, col + c, dark ? 1 : 0, true);
    }
  }
}

function placeAlignmentPattern(m: number[][], func: boolean[][], r: number, c: number): void {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
      setMod(m, func, r + dr, c + dc, dark ? 1 : 0, true);
    }
  }
}

/** Alignment patterns are skipped only where they would overlap a finder pattern. */
function skipAlignment(r: number, c: number, size: number): boolean {
  return (r <= 8 && c <= 8) || (r <= 8 && c >= size - 8) || (r >= size - 8 && c <= 8);
}

/** 18-bit version information (ISO/IEC 18004 §7.10): 6-bit version + BCH(18,6) remainder. */
function versionInfo(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | (rem & 0xfff);
}

/** Both 6×3 version-information blocks, required from version 7 up. */
function placeVersionInfo(m: number[][], func: boolean[][], version: number, size: number): void {
  if (version < 7) return;
  const bits = versionInfo(version);
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setMod(m, func, b, a, bit, true); // top-right block
    setMod(m, func, a, b, bit, true); // bottom-left block
  }
}

function formatInfo(mask: number): number {
  // ECC-M = 00 in QR format
  const data = mask;
  let poly = data << 10;
  for (let i = 14; i >= 10; i--) {
    if (poly & (1 << i)) poly ^= 0x537 << (i - 10);
  }
  return ((data << 10) | (poly & 0x3ff)) ^ 0x5412;
}

function writeFormatInfo(m: number[][], maskId: number, size: number): void {
  const bits = formatInfo(maskId);
  // Around top-left finder
  const positions = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const b = (bits >> (14 - i)) & 1;
    const [r, c] = positions[i];
    m[r][c] = b;
  }
  // Second copy: bits 0–7 along the top-right, bits 8–14 down the bottom-left
  for (let i = 0; i < 8; i++) {
    m[8][size - 1 - i] = (bits >> i) & 1;
  }
  for (let i = 8; i < 15; i++) {
    m[size - 15 + i][8] = (bits >> i) & 1;
  }
}

function maskFn(maskId: number, r: number, c: number): boolean {
  switch (maskId) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function applyMask(m: number[][], func: boolean[][], maskId: number, size: number): void {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!func[r][c] && maskFn(maskId, r, c)) m[r][c] ^= 1;
    }
  }
}

function calcPenalty(m: number[][], size: number): number {
  let penalty = 0;

  // Rule 1: runs of 5+ same color in rows and columns
  for (let r = 0; r < size; r++) {
    for (let isCol = 0; isCol < 2; isCol++) {
      let run = 1;
      let cur = isCol ? m[0][r] : m[r][0];
      for (let i = 1; i < size; i++) {
        const val = isCol ? m[i][r] : m[r][i];
        if (val === cur) {
          run++;
          if (run === 5) penalty += 3;
          else if (run > 5) penalty += 1;
        } else {
          cur = val;
          run = 1;
        }
      }
    }
  }

  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) penalty += 3;
    }
  }

  // Rule 3: finder-like patterns
  const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < size; r++) {
    for (let isCol = 0; isCol < 2; isCol++) {
      for (let c = 0; c <= size - 11; c++) {
        let m1 = true;
        let m2 = true;
        for (let k = 0; k < 11; k++) {
          const v = isCol ? m[c + k][r] : m[r][c + k];
          if (v !== p1[k]) m1 = false;
          if (v !== p2[k]) m2 = false;
        }
        if (m1) penalty += 40;
        if (m2) penalty += 40;
      }
    }
  }

  // Rule 4: dark module ratio
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  const pct = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return penalty;
}

export function generateQrCode(text: string): QrCodeResult {
  if (!text) return { matrix: [], version: 0, size: 0, error: null };

  const bytes = toUtf8(text);

  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (bytes.length <= BYTE_CAPACITY[v]) {
      version = v;
      break;
    }
  }
  if (version === 0)
    return { matrix: [], version: 0, size: 0, error: "Text too long (max ~213 characters)" };

  const [totalData, ecPerBlock, g1Blocks, g1DataPerBlock, g2Blocks, g2DataPerBlock] =
    EC_TABLE[version];

  // Build data bitstream
  const bits: number[] = [];
  pushBits(bits, 0b0100, 4); // byte mode
  pushBits(bits, bytes.length, version <= 9 ? 8 : 16); // char count
  for (const b of bytes) pushBits(bits, b, 8);
  const termLen = Math.min(4, totalData * 8 - bits.length);
  for (let i = 0; i < termLen; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (bits.length < totalData * 8) pushBits(bits, padBytes[pi++ % 2], 8);

  const dataBytes = bitsToBytes(bits);

  // Build blocks + EC
  const allDataBlocks: Uint8Array[] = [];
  const allEcBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < g1Blocks; b++) {
    const block = dataBytes.slice(offset, offset + g1DataPerBlock);
    allDataBlocks.push(block);
    allEcBlocks.push(rsEncode(block, ecPerBlock));
    offset += g1DataPerBlock;
  }
  for (let b = 0; b < g2Blocks; b++) {
    const block = dataBytes.slice(offset, offset + g2DataPerBlock);
    allDataBlocks.push(block);
    allEcBlocks.push(rsEncode(block, ecPerBlock));
    offset += g2DataPerBlock;
  }

  // Interleave
  const finalBits: number[] = [];
  const maxDataLen = Math.max(...allDataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of allDataBlocks) {
      if (i < block.length) pushBits(finalBits, block[i], 8);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of allEcBlocks) pushBits(finalBits, block[i], 8);
  }
  for (let i = 0; i < REMAINDER_BITS[version]; i++) finalBits.push(0);

  // Build matrix
  const size = 17 + 4 * version;
  const matrix: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  const func: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  // Finder patterns
  placeFinderPattern(matrix, func, 0, 0);
  placeFinderPattern(matrix, func, size - 7, 0);
  placeFinderPattern(matrix, func, 0, size - 7);

  // Separators
  for (let i = 0; i < 8; i++) {
    setMod(matrix, func, 7, i, 0, true);
    setMod(matrix, func, i, 7, 0, true);
    setMod(matrix, func, size - 8, i, 0, true);
    setMod(matrix, func, i, size - 8, 0, true);
    setMod(matrix, func, 7, size - 8 + i, 0, true);
    setMod(matrix, func, size - 8 + i, 7, 0, true);
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setMod(matrix, func, 6, i, i % 2 === 0 ? 1 : 0, true);
    setMod(matrix, func, i, 6, i % 2 === 0 ? 1 : 0, true);
  }

  // Alignment patterns
  const apos = ALIGN_POS[version];
  for (const r of apos) {
    for (const c of apos) {
      if (!skipAlignment(r, c, size)) placeAlignmentPattern(matrix, func, r, c);
    }
  }

  // Dark module
  setMod(matrix, func, 4 * version + 9, 8, 1, true);

  // Version information (versions 7+)
  placeVersionInfo(matrix, func, version, size);

  // Format info placeholders (reserved, written later)
  const fmtPositions = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  for (const [r, c] of fmtPositions) setMod(matrix, func, r, c, 0, true);
  for (let i = 0; i < 8; i++) setMod(matrix, func, 8, size - 1 - i, 0, true);
  for (let i = 0; i < 7; i++) setMod(matrix, func, size - 7 + i, 8, 0, true);

  // Place data bits (fill non-function modules)
  let bitIdx = 0;
  let up = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (let dc = 0; dc <= 1; dc++) {
        const c = col - dc;
        if (!func[row][c]) {
          matrix[row][c] = bitIdx < finalBits.length ? finalBits[bitIdx++] : 0;
        }
      }
    }
    up = !up;
  }

  // Try all 8 masks, pick best
  let bestMatrix: number[][] | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let maskId = 0; maskId < 8; maskId++) {
    const m = matrix.map((row) => [...row]);
    applyMask(m, func, maskId, size);
    writeFormatInfo(m, maskId, size);
    const p = calcPenalty(m, size);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestMatrix = m;
    }
  }

  const boolMatrix = (bestMatrix ?? matrix).map((row) => row.map((v) => v === 1));
  return { matrix: boolMatrix, version, size, error: null };
}
