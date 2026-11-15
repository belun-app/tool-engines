/**
 * Encodes Code 128, EAN-13 and UPC-A barcodes as bar patterns, checking lengths and check
 * digits.
 */

export type BarcodeSymbology = "code128" | "ean13" | "upca";

/**
 * Why a value was refused. Pages show their own text for each code (data-msg-*); the
 * English `error` is a fallback.
 */
export type BarcodeErrorCode =
  | "ean13-length"
  | "upca-length"
  | "check-digit"
  | "too-long"
  | "non-ascii";

export interface BarcodeResult {
  ok: boolean;
  error: string | null;
  errorCode: BarcodeErrorCode | null;
  /** For "check-digit": the digit the first 11/12 digits call for, and the one typed. */
  expectedCheckDigit?: string;
  typedCheckDigit?: string;
  symbology: BarcodeSymbology;
  /** The exact value encoded, including any computed check digit */
  text: string;
  /** Human-friendly grouped version of `text` for display under the bars */
  displayText: string;
  /** Module widths of alternating bar/space runs, starting with a bar (index 0) */
  widths: number[];
  /** Quiet zone to the left of the bars, in modules */
  quietZoneModules: number;
  /** Quiet zone to the right of the bars, in modules */
  quietZoneRightModules: number;
}

/**
 * Quiet zones in modules, left / right. GS1 General Specifications: EAN-13 needs at
 * least 11 / 7 and UPC-A 9 / 9; Code 128 needs 10 / 10 (ISO/IEC 15417). EAN-13 gets 11 / 9
 * so the symbol keeps the same overall width as before (95 + 20 modules).
 */
const QUIET_ZONES: Record<BarcodeSymbology, { left: number; right: number }> = {
  code128: { left: 10, right: 10 },
  ean13: { left: 11, right: 9 },
  upca: { left: 10, right: 10 },
};

function emptyResult(symbology: BarcodeSymbology): BarcodeResult {
  return {
    ok: false,
    error: null,
    errorCode: null,
    symbology,
    text: "",
    displayText: "",
    widths: [],
    quietZoneModules: QUIET_ZONES[symbology].left,
    quietZoneRightModules: QUIET_ZONES[symbology].right,
  };
}

function errorResult(
  symbology: BarcodeSymbology,
  errorCode: BarcodeErrorCode,
  error: string,
  extra: Partial<BarcodeResult> = {},
): BarcodeResult {
  return { ...emptyResult(symbology), error, errorCode, ...extra };
}

/**
 * A full EAN/UPC whose last digit is not the GS1 check digit of the others is a typo
 * somewhere. Encoding the "corrected" number would print someone else's product, so it
 * is refused with the digit the first part calls for.
 */
function checkDigitError(
  symbology: BarcodeSymbology,
  typed: string,
  expected: number,
): BarcodeResult {
  return errorResult(
    symbology,
    "check-digit",
    `The check digit should be ${expected}, not ${typed}. Check the other digits, or leave the last one off and it will be calculated.`,
    { expectedCheckDigit: String(expected), typedCheckDigit: typed },
  );
}

/** GS1 mod-10 check digit: weight of the rightmost data digit is 3, alternating leftward. */
function gs1CheckDigit(dataDigits: string): number {
  let sum = 0;
  for (let i = 0; i < dataDigits.length; i++) {
    const posFromRight = dataDigits.length - 1 - i;
    const weight = posFromRight % 2 === 0 ? 3 : 1;
    sum += Number(dataDigits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

function runLengthEncode(binary: string): number[] {
  const widths: number[] = [];
  let i = 0;
  while (i < binary.length) {
    let j = i;
    while (j < binary.length && binary[j] === binary[i]) j++;
    widths.push(j - i);
    i = j;
  }
  return widths;
}

// --- EAN-13 / UPC-A shared tables ---

const L_CODE = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const G_CODE = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
const R_CODE = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];
/** For each EAN-13 leading digit, the L/G pattern used for the following 6 digits. */
const EAN13_PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

function groupEan13(digits: string): string {
  return `${digits.slice(0, 1)} ${digits.slice(1, 7)} ${digits.slice(7, 13)}`;
}

function groupUpcA(digits: string): string {
  return `${digits.slice(0, 1)} ${digits.slice(1, 6)} ${digits.slice(6, 11)} ${digits.slice(11, 12)}`;
}

function generateEan13(rawInput: string): BarcodeResult {
  const digits = rawInput.replace(/\D/g, "");
  if (!digits) return emptyResult("ean13");
  if (digits.length !== 12 && digits.length !== 13) {
    return errorResult(
      "ean13",
      "ean13-length",
      "EAN-13 needs 12 digits (the 13th check digit is calculated for you).",
    );
  }
  const data = digits.slice(0, 12);
  const check = gs1CheckDigit(data);
  if (digits.length === 13 && digits[12] !== String(check)) {
    return checkDigitError("ean13", digits[12], check);
  }
  const full = data + check;

  const parity = EAN13_PARITY[Number(full[0])];
  let binary = "101";
  for (let i = 1; i <= 6; i++) {
    const table = parity[i - 1] === "L" ? L_CODE : G_CODE;
    binary += table[Number(full[i])];
  }
  binary += "01010";
  for (let i = 7; i <= 12; i++) binary += R_CODE[Number(full[i])];
  binary += "101";

  return {
    ok: true,
    error: null,
    symbology: "ean13",
    text: full,
    displayText: groupEan13(full),
    widths: runLengthEncode(binary),
    errorCode: null,
    quietZoneModules: QUIET_ZONES.ean13.left,
    quietZoneRightModules: QUIET_ZONES.ean13.right,
  };
}

function generateUpcA(rawInput: string): BarcodeResult {
  const digits = rawInput.replace(/\D/g, "");
  if (!digits) return emptyResult("upca");
  if (digits.length !== 11 && digits.length !== 12) {
    return errorResult(
      "upca",
      "upca-length",
      "UPC-A needs 11 digits (the 12th check digit is calculated for you).",
    );
  }
  const data = digits.slice(0, 11);
  const check = gs1CheckDigit(data);
  if (digits.length === 12 && digits[11] !== String(check)) {
    return checkDigitError("upca", digits[11], check);
  }
  const full = data + check;

  let binary = "101";
  for (let i = 0; i < 6; i++) binary += L_CODE[Number(full[i])];
  binary += "01010";
  for (let i = 6; i < 12; i++) binary += R_CODE[Number(full[i])];
  binary += "101";

  return {
    ok: true,
    error: null,
    symbology: "upca",
    text: full,
    displayText: groupUpcA(full),
    widths: runLengthEncode(binary),
    errorCode: null,
    quietZoneModules: QUIET_ZONES.upca.left,
    quietZoneRightModules: QUIET_ZONES.upca.right,
  };
}

// --- Code 128 ---

const CODE128_PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412", // 103 START A
  "211214", // 104 START B
  "211232", // 105 START C
  "2331112", // 106 STOP
];
const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_CODE_C = 99;
const CODE128_CODE_B = 100;
const CODE128_STOP = 106;
const CODE128_MAX_LENGTH = 48;

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";

function digitRun(text: string, from: number): number {
  let i = from;
  while (isDigit(text[i])) i++;
  return i - from;
}

/**
 * Symbol values for `text`, switching between subset B (one character per symbol) and
 * subset C (two digits per symbol) the way label printers do: a digit run goes into C
 * when that saves symbols — 4+ digits at the end of the text, 6+ in the middle, the whole
 * text when it is an even number of digits. An odd run gives its first digit to B, so
 * "123456789" is 1 in B then 23 45 67 89 in C instead of nine B symbols.
 */
function code128Symbols(text: string): number[] {
  const n = text.length;
  const leading = digitRun(text, 0);
  const symbols: number[] = [];
  let set: "B" | "C";
  if ((leading === n && n % 2 === 0) || (leading >= 4 && leading % 2 === 0)) {
    symbols.push(CODE128_START_C);
    set = "C";
  } else {
    symbols.push(CODE128_START_B);
    set = "B";
  }

  let i = 0;
  while (i < n) {
    if (set === "C") {
      if (digitRun(text, i) >= 2) {
        symbols.push(Number(text.slice(i, i + 2)));
        i += 2;
      } else {
        symbols.push(CODE128_CODE_B);
        set = "B";
      }
      continue;
    }
    const run = digitRun(text, i);
    const even = run - (run % 2);
    const atEnd = i + run === n;
    if ((atEnd && even >= 4) || (!atEnd && even >= 6)) {
      if (run % 2 === 1) {
        symbols.push(text.charCodeAt(i) - 32);
        i++;
      }
      symbols.push(CODE128_CODE_C);
      set = "C";
      continue;
    }
    symbols.push(text.charCodeAt(i) - 32);
    i++;
  }
  return symbols;
}

function generateCode128(rawInput: string): BarcodeResult {
  const text = rawInput.trim();
  if (!text) return emptyResult("code128");
  if (text.length > CODE128_MAX_LENGTH) {
    return errorResult(
      "code128",
      "too-long",
      `Text is too long — Code 128 supports up to ${CODE128_MAX_LENGTH} characters here.`,
    );
  }

  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch.length > 1 || code < 32 || code > 126) {
      return errorResult(
        "code128",
        "non-ascii",
        "Code 128 only supports standard keyboard characters (ASCII 32–126).",
      );
    }
  }

  const symbols = code128Symbols(text);
  let checksum = symbols[0];
  for (let i = 1; i < symbols.length; i++) checksum += symbols[i] * i;
  symbols.push(checksum % 103);
  symbols.push(CODE128_STOP);

  const widths = symbols.flatMap((value) => CODE128_PATTERNS[value].split("").map(Number));

  return {
    ok: true,
    error: null,
    errorCode: null,
    symbology: "code128",
    text,
    displayText: text,
    widths,
    quietZoneModules: QUIET_ZONES.code128.left,
    quietZoneRightModules: QUIET_ZONES.code128.right,
  };
}

export function generateBarcode(rawInput: string, symbology: BarcodeSymbology): BarcodeResult {
  if (symbology === "ean13") return generateEan13(rawInput);
  if (symbology === "upca") return generateUpcA(rawInput);
  return generateCode128(rawInput);
}
