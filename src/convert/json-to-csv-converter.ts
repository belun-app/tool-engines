/**
 * Converts a JSON array of objects (or one object) to CSV: a header row from the union of
 * keys, quoting where needed, and nested values written as JSON.
 */

export interface JsonToCsvResult {
  csv: string;
  /** Number of data rows (header row not counted). */
  rows: number;
  /** Number of columns in the output. */
  columns: number;
  /** Non-empty when the input could not be converted. */
  error: string;
}

export interface JsonToCsvOptions {
  /** Field separator. Defaults to a comma. Use ";" or "\t" for other dialects. */
  delimiter?: string;
  /** Whether to emit a header row built from the object keys. Defaults to true. */
  includeHeader?: boolean;
}

const EMPTY: JsonToCsvResult = { csv: "", rows: 0, columns: 0, error: "" };

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  // Nested objects and arrays are serialised back to JSON so a cell never loses data.
  return JSON.stringify(value);
}

function escapeField(field: string, delimiter: string): string {
  const mustQuote =
    field.includes(delimiter) ||
    field.includes('"') ||
    field.includes("\n") ||
    field.includes("\r");
  return mustQuote ? `"${field.replace(/"/g, '""')}"` : field;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function jsonToCsv(input: string, options: JsonToCsvOptions = {}): JsonToCsvResult {
  const delimiter = options.delimiter ?? ",";
  const includeHeader = options.includeHeader ?? true;

  if (!input.trim()) return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";
    return { ...EMPTY, error: message };
  }

  // Normalise the top-level value into a list of rows. A bare object becomes a
  // single row; a primitive becomes a single-cell row.
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

  if (items.length === 0) {
    return { ...EMPTY, error: "The JSON array is empty — there is nothing to convert." };
  }

  const allObjects = items.every(isPlainObject);

  let headers: string[];
  let toCells: (item: unknown) => string[];

  if (allObjects) {
    // Union of keys, preserving first-seen order across every object.
    const seen = new Set<string>();
    headers = [];
    for (const item of items) {
      for (const key of Object.keys(item as Record<string, unknown>)) {
        if (!seen.has(key)) {
          seen.add(key);
          headers.push(key);
        }
      }
    }
    toCells = (item) => {
      const record = item as Record<string, unknown>;
      return headers.map((key) => (Object.hasOwn(record, key) ? cellToString(record[key]) : ""));
    };
  } else {
    // Mixed or primitive/array data collapses to a single "value" column.
    headers = ["value"];
    toCells = (item) => [cellToString(item)];
  }

  const lines: string[] = [];
  if (includeHeader) {
    lines.push(headers.map((header) => escapeField(header, delimiter)).join(delimiter));
  }
  for (const item of items) {
    lines.push(
      toCells(item)
        .map((cell) => escapeField(cell, delimiter))
        .join(delimiter),
    );
  }

  return {
    csv: lines.join("\r\n"),
    rows: items.length,
    columns: headers.length,
    error: "",
  };
}
