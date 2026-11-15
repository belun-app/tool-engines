/**
 * Markdown table generation and parsing.
 *
 * Pure string work — no DOM. The visual grid editor feeds a 2D array of cells plus
 * per-column alignment in and gets GitHub-flavored Markdown out. The parser goes the
 * other way so an existing table (or a pasted CSV/TSV block) can be loaded into the grid.
 */

export type ColumnAlign = "none" | "left" | "center" | "right";

export interface MarkdownTableOptions {
  /** Row 0 is the header row. Every row is padded or truncated to the header width. */
  rows: string[][];
  /** One alignment per column. Missing entries default to "none". */
  aligns: ColumnAlign[];
  /** Pad cells with spaces so the raw source lines up in a monospace editor. */
  pretty: boolean;
  /** Wrap every row in leading and trailing pipes (GitHub renders both forms). */
  outerPipes: boolean;
  /** Escape pipe characters inside cell text so they do not split the cell. */
  escapePipes: boolean;
}

export interface MarkdownTableResult {
  markdown: string;
  rowCount: number;
  columnCount: number;
  /** True when there is at least one column and one header row. */
  valid: boolean;
}

const ALIGNS: ColumnAlign[] = ["none", "left", "center", "right"];

export function isColumnAlign(value: string): value is ColumnAlign {
  return (ALIGNS as string[]).includes(value);
}

function cellWidth(text: string): number {
  return [...text].length;
}

function padCell(text: string, width: number, align: ColumnAlign): string {
  const pad = Math.max(0, width - cellWidth(text));
  if (pad === 0) return text;
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + text + " ".repeat(pad - left);
  }
  return text + " ".repeat(pad);
}

/** Delimiter cell for one column, sized to match the padded body when pretty is on. */
function delimiterCell(align: ColumnAlign, width: number): string {
  const left = align === "left" || align === "center" ? ":" : "";
  const right = align === "right" || align === "center" ? ":" : "";
  const dashes = Math.max(3, width - left.length - right.length);
  return left + "-".repeat(dashes) + right;
}

function normalizeCell(text: string, escapePipes: boolean): string {
  const flattened = text.replace(/\r?\n/g, "<br>").trim();
  return escapePipes ? flattened.replace(/\|/g, "\\|") : flattened;
}

export function generateMarkdownTable(options: MarkdownTableOptions): MarkdownTableResult {
  const { rows, aligns, pretty, outerPipes, escapePipes } = options;

  const columnCount = rows[0]?.length ?? 0;
  if (columnCount === 0 || rows.length === 0) {
    return { markdown: "", rowCount: 0, columnCount: 0, valid: false };
  }

  const grid = rows.map((row) => {
    const cells: string[] = [];
    for (let c = 0; c < columnCount; c += 1) {
      cells.push(normalizeCell(row[c] ?? "", escapePipes));
    }
    return cells;
  });

  const columnAligns: ColumnAlign[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    columnAligns.push(aligns[c] ?? "none");
  }

  const widths: number[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    // Room for at least three dashes plus the alignment colons (":---:" is 5 wide), so the
    // delimiter row is never wider than the padded cells in pretty mode.
    const colons = { left: 1, right: 1, center: 2, none: 0 }[columnAligns[c]] ?? 0;
    let width = pretty ? 3 + colons : 3;
    if (pretty) {
      for (const row of grid) width = Math.max(width, cellWidth(row[c]));
    }
    widths.push(width);
  }

  const joinRow = (cells: string[]): string => {
    const inner = pretty ? cells.join(" | ") : cells.join("|");
    if (!outerPipes) return inner;
    return pretty ? `| ${inner} |` : `|${inner}|`;
  };

  const lines: string[] = [];
  const header = grid[0].map((cell, c) =>
    pretty ? padCell(cell, widths[c], columnAligns[c]) : cell,
  );
  lines.push(joinRow(header));
  lines.push(joinRow(columnAligns.map((align, c) => delimiterCell(align, pretty ? widths[c] : 3))));

  for (let r = 1; r < grid.length; r += 1) {
    const body = grid[r].map((cell, c) =>
      pretty ? padCell(cell, widths[c], columnAligns[c]) : cell,
    );
    lines.push(joinRow(body));
  }

  return {
    markdown: lines.join("\n"),
    rowCount: grid.length,
    columnCount,
    valid: true,
  };
}

export interface ParsedTable {
  rows: string[][];
  aligns: ColumnAlign[];
  /** How the input was read: an existing Markdown table, or a delimited paste. */
  source: "markdown" | "delimited" | "empty";
}

function alignFromDelimiter(cell: string): ColumnAlign {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "none";
}

function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/** Split one Markdown table line into cells, honouring backslash-escaped pipes. */
function splitPipeRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);

  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter !== ",") return line.split(delimiter).map((cell) => cell.trim());

  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function rectangular(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    const copy = row.slice(0, width);
    while (copy.length < width) copy.push("");
    return copy;
  });
}

/**
 * Read a Markdown table, or a CSV/TSV paste, into a grid the editor can load.
 * Returns an empty result rather than throwing on anything it cannot make sense of.
 */
export function parseTable(input: string): ParsedTable {
  // Lines are not trimmed here: a TSV row pasted from a spreadsheet may start with an empty
  // cell ("\tB"), and trimming would drop it. Each splitter trims its own cells.
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) return { rows: [], aligns: [], source: "empty" };

  const pipeLines = lines.filter((line) => line.includes("|"));
  if (pipeLines.length >= 2 && pipeLines.length === lines.length) {
    const parsed = lines.map(splitPipeRow);
    if (parsed.length > 1 && isDelimiterRow(parsed[1])) {
      const aligns = parsed[1].map(alignFromDelimiter);
      const rows = rectangular([parsed[0], ...parsed.slice(2)]);
      const width = rows[0]?.length ?? 0;
      while (aligns.length < width) aligns.push("none");
      return { rows, aligns: aligns.slice(0, width), source: "markdown" };
    }
  }

  const tabCount = lines.filter((line) => line.includes("\t")).length;
  const delimiter = tabCount >= lines.length / 2 ? "\t" : ",";
  const rows = rectangular(lines.map((line) => splitDelimitedLine(line, delimiter)));
  if (rows.length === 0 || (rows[0]?.length ?? 0) === 0) {
    return { rows: [], aligns: [], source: "empty" };
  }
  return { rows, aligns: rows[0].map((): ColumnAlign => "none"), source: "delimited" };
}
