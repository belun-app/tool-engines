/**
 * CSS Grid container and item code generation.
 *
 * Pure track-list formatting and declaration building — no DOM. The visual builder
 * feeds a track list plus per-item placements in and gets a paste-ready stylesheet out.
 */

export type TrackUnit = "fr" | "px" | "%" | "auto";

export interface GridTrack {
  value: number;
  unit: TrackUnit;
}

export type GridAlign = "stretch" | "start" | "end" | "center";

/** Placement overrides for a single grid item. A start of 0 means "let the grid place it". */
export interface GridItemPlacement {
  /** 0-based position of the item among the container's children. */
  index: number;
  columnStart: number;
  columnSpan: number;
  rowStart: number;
  rowSpan: number;
}

export interface GridItemRule {
  selector: string;
  /** Declarations for this item, one per line, already indented by the caller. */
  declarations: string[];
}

export interface GridResult {
  columnTemplate: string;
  rowTemplate: string;
  /** Container declarations, one per line, no selector or braces. */
  containerCss: string;
  itemRules: GridItemRule[];
  /** Full stylesheet: container rule followed by any item rules. */
  css: string;
  valid: boolean;
}

const UNITS: TrackUnit[] = ["fr", "px", "%", "auto"];
const ALIGN_VALUES: GridAlign[] = ["stretch", "start", "end", "center"];

const CONTAINER_SELECTOR = ".grid-container";

function clampGap(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(200, Math.max(0, Math.round(value)));
}

function toIndex(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 0;
  return Math.floor(value);
}

function toSpan(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

/** Render a single track as CSS: `1fr`, `240px`, `33.33%`, or `auto`. */
export function formatTrack(track: GridTrack): string {
  const unit = track && UNITS.includes(track.unit) ? track.unit : "fr";
  if (unit === "auto") return "auto";
  const raw = Number.isFinite(track?.value) ? Math.max(0, track.value) : 1;
  const rounded = Math.round(raw * 100) / 100;
  return `${rounded}${unit}`;
}

/**
 * Build a `grid-template-*` value. Identical tracks collapse into `repeat(n, x)`,
 * which is what most people write by hand. An empty list yields `none`.
 */
export function buildTrackTemplate(tracks: GridTrack[]): string {
  const list = (tracks ?? []).filter(Boolean);
  if (list.length === 0) return "none";

  const formatted = list.map(formatTrack);
  const first = formatted[0];
  if (formatted.length > 1 && formatted.every((track) => track === first)) {
    return `repeat(${formatted.length}, ${first})`;
  }
  return formatted.join(" ");
}

/** Declarations for one item. Returns an empty array when the item uses default placement. */
export function buildItemDeclarations(placement: GridItemPlacement): string[] {
  const declarations: string[] = [];
  if (!placement) return declarations;

  const columnStart = toIndex(placement.columnStart);
  const columnSpan = toSpan(placement.columnSpan);
  const rowStart = toIndex(placement.rowStart);
  const rowSpan = toSpan(placement.rowSpan);

  if (columnStart > 0) {
    declarations.push(`grid-column: ${columnStart} / span ${columnSpan};`);
  } else if (columnSpan > 1) {
    declarations.push(`grid-column: span ${columnSpan};`);
  }

  if (rowStart > 0) {
    declarations.push(`grid-row: ${rowStart} / span ${rowSpan};`);
  } else if (rowSpan > 1) {
    declarations.push(`grid-row: span ${rowSpan};`);
  }

  return declarations;
}

export interface GridOptions {
  columns: GridTrack[];
  rows: GridTrack[];
  columnGap: number;
  rowGap: number;
  justifyItems: GridAlign;
  alignItems: GridAlign;
  items?: GridItemPlacement[];
}

/**
 * Build the full grid stylesheet. Properties left at their CSS default are omitted so
 * the output stays close to what a person would write. Invalid input yields a
 * zero-value result rather than throwing.
 */
export function buildGridCss(options: GridOptions): GridResult {
  if (!options || typeof options !== "object") {
    return {
      columnTemplate: "",
      rowTemplate: "",
      containerCss: "",
      itemRules: [],
      css: "",
      valid: false,
    };
  }

  const columnTemplate = buildTrackTemplate(options.columns);
  const rowTemplate = buildTrackTemplate(options.rows);
  const columnGap = clampGap(options.columnGap);
  const rowGap = clampGap(options.rowGap);
  const justifyItems = ALIGN_VALUES.includes(options.justifyItems)
    ? options.justifyItems
    : "stretch";
  const alignItems = ALIGN_VALUES.includes(options.alignItems) ? options.alignItems : "stretch";

  const lines = ["display: grid;", `grid-template-columns: ${columnTemplate};`];
  if (rowTemplate !== "none") {
    lines.push(`grid-template-rows: ${rowTemplate};`);
  }
  if (rowGap === columnGap) {
    if (rowGap > 0) lines.push(`gap: ${rowGap}px;`);
  } else {
    lines.push(`gap: ${rowGap}px ${columnGap}px;`);
  }
  if (justifyItems !== "stretch") lines.push(`justify-items: ${justifyItems};`);
  if (alignItems !== "stretch") lines.push(`align-items: ${alignItems};`);

  const itemRules: GridItemRule[] = [];
  for (const placement of options.items ?? []) {
    const declarations = buildItemDeclarations(placement);
    if (declarations.length === 0) continue;
    itemRules.push({ selector: `.item-${toSpan(placement.index + 1)}`, declarations });
  }

  const blocks = [
    `${CONTAINER_SELECTOR} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}`,
    ...itemRules.map(
      (rule) => `${rule.selector} {\n${rule.declarations.map((d) => `  ${d}`).join("\n")}\n}`,
    ),
  ];

  return {
    columnTemplate,
    rowTemplate,
    containerCss: lines.join("\n"),
    itemRules,
    css: blocks.join("\n\n"),
    valid: true,
  };
}
