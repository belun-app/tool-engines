/**
 * Converts CSV to JSON: quoted fields, delimiter auto-detection (comma, semicolon, tab,
 * pipe), a header row as object keys, and optional number and boolean typing.
 */

export interface CsvToJsonResult {
  /** Pretty-printed (or compact) JSON string ready to copy. */
  json: string;
  /** Number of data records emitted (header row not counted in header mode). */
  rows: number;
  /** Number of columns detected. */
  columns: number;
  /** The delimiter actually used, useful when auto-detection is on. */
  delimiter: string;
  /** Non-empty when the input could not be converted. */
  error: string;
}

export interface CsvToJsonOptions {
  /**
   * Field separator. Pass ",", ";" or "\t" to force a dialect. Leave undefined
   * to auto-detect from the first line.
   */
  delimiter?: string;
  /** Treat the first row as column names. Defaults to true. */
  header?: boolean;
  /** Convert numbers and booleans to real JSON types. Defaults to true. */
  typed?: boolean;
  /** Pretty-print with two-space indentation. Defaults to true. */
  pretty?: boolean;
}

const EMPTY: CsvToJsonResult = { json: "", rows: 0, columns: 0, delimiter: ",", error: "" };

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"];

/** Pick the delimiter that appears most often in the first non-empty line. */
export function detectDelimiter(input: string): string {
  const firstLine = input.split(/\r\n|\r|\n/).find((line) => line.trim().length > 0) ?? "";
  let best = ",";
  let bestCount = -1;
  for (const candidate of CANDIDATE_DELIMITERS) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/** RFC 4180 parser: handles quoted fields, escaped quotes, and newlines in cells. */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      pushRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // Flush the last record unless the input ended on a clean row break.
  if (field !== "" || row.length > 0) pushRow();

  // Drop blank lines (every cell empty) so trailing newlines don't add junk rows.
  return rows.filter((cells) => cells.some((cell) => cell !== ""));
}

function typeCell(value: string, typed: boolean): unknown {
  if (!typed || value === "") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  // Only plain integers/decimals without leading zeros, so codes like "007" or
  // phone numbers keep their original form.
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    // More than 15 significant digits (long IDs, order numbers, 20-digit account codes)
    // cannot survive a JS number, so those stay strings instead of silently losing digits.
    const significant = value.replace(/^-/, "").replace(".", "").replace(/^0+/, "");
    if (significant.length > 15) return value;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return value;
}

export function csvToJson(input: string, options: CsvToJsonOptions = {}): CsvToJsonResult {
  if (!input.trim()) return EMPTY;

  const header = options.header ?? true;
  const typed = options.typed ?? true;
  const pretty = options.pretty ?? true;
  const delimiter = options.delimiter ?? detectDelimiter(input);

  const grid = parseCsv(input, delimiter);
  if (grid.length === 0) return { ...EMPTY, delimiter };

  let value: unknown;
  let columns: number;
  let rows: number;

  if (header) {
    const headers = grid[0];
    columns = headers.length;
    const records = grid.slice(1).map((cells) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((key, col) => {
        // defineProperty, not assignment: a "__proto__" column must stay an ordinary key.
        Object.defineProperty(obj, key, {
          value: typeCell(cells[col] ?? "", typed),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      });
      return obj;
    });
    rows = records.length;
    value = records;
  } else {
    columns = grid.reduce((max, cells) => Math.max(max, cells.length), 0);
    const records = grid.map((cells) => cells.map((cell) => typeCell(cell, typed)));
    rows = records.length;
    value = records;
  }

  return {
    json: JSON.stringify(value, null, pretty ? 2 : 0),
    rows,
    columns,
    delimiter,
    error: "",
  };
}
