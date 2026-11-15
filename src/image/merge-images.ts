import { formatNumber } from "../_num.js";
/**
 * Layout maths for the Merge Images tool.
 *
 * The browser half only decodes files and calls drawImage. Every number it
 * needs — canvas size, per-image rectangles, the safety downscale when a
 * collage would blow past the canvas limit, filenames, status labels — is
 * worked out here, with no DOM and no dependencies.
 */

export type MergeLayout = "horizontal" | "vertical" | "grid";

/** How the cross-axis size of each image is reconciled with its neighbours. */
export type MergeSizing = "original" | "smallest" | "largest";

export type MergeAlign = "start" | "center" | "end";

export type MergeFormat = "png" | "jpeg" | "webp";

export interface MergeFormatInfo {
  value: MergeFormat;
  label: string;
  mime: string;
  ext: string;
  /** PNG and WebP keep an alpha channel; JPEG always needs an opaque fill. */
  supportsAlpha: boolean;
  /** undefined for PNG — canvas.toBlob ignores quality for lossless output. */
  quality?: number;
}

export const MERGE_FORMATS: MergeFormatInfo[] = [
  { value: "png", label: "PNG", mime: "image/png", ext: "png", supportsAlpha: true },
  {
    value: "jpeg",
    label: "JPEG",
    mime: "image/jpeg",
    ext: "jpg",
    supportsAlpha: false,
    quality: 0.92,
  },
  {
    value: "webp",
    label: "WebP",
    mime: "image/webp",
    ext: "webp",
    supportsAlpha: true,
    quality: 0.92,
  },
];

export function getMergeFormat(format: MergeFormat): MergeFormatInfo {
  return MERGE_FORMATS.find((f) => f.value === format) ?? MERGE_FORMATS[0];
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface MergeOptions {
  layout: MergeLayout;
  sizing: MergeSizing;
  align: MergeAlign;
  /** Gap between neighbouring images, in output pixels. */
  spacing: number;
  /** Border around the whole collage, in output pixels. */
  padding: number;
  /** Grid layout only; ignored for rows and columns. */
  columns: number;
  background: string;
  transparent: boolean;
  format: MergeFormat;
}

export const DEFAULT_OPTIONS: MergeOptions = {
  layout: "horizontal",
  sizing: "smallest",
  align: "center",
  spacing: 12,
  padding: 0,
  columns: 2,
  background: "#ffffff",
  transparent: false,
  format: "png",
};

export function defaultOptions(): MergeOptions {
  return { ...DEFAULT_OPTIONS };
}

/** Where one source image lands on the output canvas. */
export interface Placement {
  /** Position in the caller's own array, so the mount can find the bitmap. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Row and column the image occupies (both 0 for a single-line layout). */
  row: number;
  column: number;
}

export interface MergePlan {
  canvas: ImageSize;
  placements: Placement[];
  rows: number;
  columns: number;
  /** 1 when nothing was shrunk; below 1 when the canvas limit forced a downscale. */
  scale: number;
  /** Images dropped because their decoded size was unusable. */
  skipped: number;
}

export const EMPTY_PLAN: MergePlan = {
  canvas: { width: 0, height: 0 },
  placements: [],
  rows: 0,
  columns: 0,
  scale: 1,
  skipped: 0,
};

/**
 * Chrome tops out at 65,535 px per side but refuses canvases over roughly
 * 268 megapixels; Safari on iOS gives up much earlier, somewhere near 16k and
 * 16 MP on older devices. These caps are deliberately conservative: a collage
 * nobody can save is worse than one that was quietly shrunk.
 */
export const MAX_CANVAS_SIDE = 12000;
export const MAX_CANVAS_PIXELS = 60_000_000;

export const MAX_SPACING = 200;
export const MAX_PADDING = 200;
export const MAX_COLUMNS = 8;

export function clampSpacing(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_SPACING, Math.max(0, Math.round(value)));
}

export function clampPadding(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_PADDING, Math.max(0, Math.round(value)));
}

export function clampColumns(value: number, count = MAX_COLUMNS): number {
  if (!Number.isFinite(value)) return 2;
  const upper = Math.max(1, Math.min(MAX_COLUMNS, count));
  return Math.min(upper, Math.max(1, Math.round(value)));
}

/** Hex guard for the background picker; anything odd falls back to white. */
export function normalizeHexColor(value: string, fallback = "#ffffff"): string {
  const trimmed = (value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

/** A merge needs at least two pictures to be a merge. */
export function canMerge(count: number): boolean {
  return count >= 2;
}

/** JPEG has no alpha, so "transparent" is not an option there. */
export function needsOpaqueBackground(options: MergeOptions): boolean {
  if (!getMergeFormat(options.format).supportsAlpha) return true;
  return !options.transparent;
}

/** Colour to paint behind the collage, or null to leave the canvas clear. */
export function backgroundFill(options: MergeOptions): string | null {
  if (!needsOpaqueBackground(options)) return null;
  return normalizeHexColor(options.background);
}

interface Usable {
  index: number;
  width: number;
  height: number;
}

function usableSizes(sizes: ImageSize[]): Usable[] {
  const out: Usable[] = [];
  sizes.forEach((s, index) => {
    const width = Math.round(s?.width ?? 0);
    const height = Math.round(s?.height ?? 0);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      out.push({ index, width, height });
    }
  });
  return out;
}

/** The common cross-axis measurement every image is scaled to. */
function targetCross(values: number[], sizing: MergeSizing): number {
  if (sizing === "smallest") return Math.min(...values);
  if (sizing === "largest") return Math.max(...values);
  return 0;
}

function offsetFor(align: MergeAlign, free: number): number {
  if (free <= 0) return 0;
  if (align === "center") return free / 2;
  if (align === "end") return free;
  return 0;
}

/**
 * Lay the images out and return every rectangle the canvas needs.
 *
 * Side by side normalises heights, stacked normalises widths, and the grid
 * scales each picture to fit its cell. With sizing "original" nothing is
 * resampled at all — the collage simply grows to the widest and tallest
 * picture, which is what you want when the inputs already match.
 */
export function planMerge(sizes: ImageSize[], raw: MergeOptions): MergePlan {
  const options = sanitizeOptions(raw, sizes.length);
  const items = usableSizes(sizes);
  const skipped = sizes.length - items.length;
  if (items.length === 0) return { ...EMPTY_PLAN, skipped };

  const drawn =
    options.layout === "grid" ? drawnSizesGrid(items, options) : drawnSizesLinear(items, options);

  const plan =
    options.layout === "grid" ? layoutGrid(drawn, options) : layoutLinear(drawn, options);

  plan.skipped = skipped;
  return fitToCanvasLimits(plan);
}

interface Drawn extends Usable {
  drawWidth: number;
  drawHeight: number;
}

function drawnSizesLinear(items: Usable[], options: MergeOptions): Drawn[] {
  const horizontal = options.layout === "horizontal";
  const cross = targetCross(
    items.map((i) => (horizontal ? i.height : i.width)),
    options.sizing,
  );
  return items.map((item) => {
    if (cross <= 0) {
      return { ...item, drawWidth: item.width, drawHeight: item.height };
    }
    if (horizontal) {
      const factor = cross / item.height;
      return {
        ...item,
        drawWidth: Math.max(1, Math.round(item.width * factor)),
        drawHeight: Math.max(1, Math.round(cross)),
      };
    }
    const factor = cross / item.width;
    return {
      ...item,
      drawWidth: Math.max(1, Math.round(cross)),
      drawHeight: Math.max(1, Math.round(item.height * factor)),
    };
  });
}

function drawnSizesGrid(items: Usable[], options: MergeOptions): Drawn[] {
  if (options.sizing === "original") {
    return items.map((item) => ({ ...item, drawWidth: item.width, drawHeight: item.height }));
  }
  const widths = items.map((i) => i.width);
  const heights = items.map((i) => i.height);
  const cellW = options.sizing === "smallest" ? Math.min(...widths) : Math.max(...widths);
  const cellH = options.sizing === "smallest" ? Math.min(...heights) : Math.max(...heights);
  return items.map((item) => {
    // Contain, never crop: the whole picture has to stay inside its cell.
    const factor = Math.min(cellW / item.width, cellH / item.height);
    return {
      ...item,
      drawWidth: Math.max(1, Math.round(item.width * factor)),
      drawHeight: Math.max(1, Math.round(item.height * factor)),
    };
  });
}

function layoutLinear(drawn: Drawn[], options: MergeOptions): MergePlan {
  const horizontal = options.layout === "horizontal";
  const { spacing, padding } = options;
  const gaps = spacing * Math.max(0, drawn.length - 1);
  const main = drawn.reduce((sum, d) => sum + (horizontal ? d.drawWidth : d.drawHeight), 0);
  const cross = Math.max(...drawn.map((d) => (horizontal ? d.drawHeight : d.drawWidth)));

  const canvas: ImageSize = horizontal
    ? { width: main + gaps + padding * 2, height: cross + padding * 2 }
    : { width: cross + padding * 2, height: main + gaps + padding * 2 };

  const placements: Placement[] = [];
  let cursor = padding;
  drawn.forEach((d, i) => {
    if (horizontal) {
      placements.push({
        index: d.index,
        x: cursor,
        y: padding + offsetFor(options.align, cross - d.drawHeight),
        width: d.drawWidth,
        height: d.drawHeight,
        row: 0,
        column: i,
      });
      cursor += d.drawWidth + spacing;
    } else {
      placements.push({
        index: d.index,
        x: padding + offsetFor(options.align, cross - d.drawWidth),
        y: cursor,
        width: d.drawWidth,
        height: d.drawHeight,
        row: i,
        column: 0,
      });
      cursor += d.drawHeight + spacing;
    }
  });

  return {
    canvas,
    placements,
    rows: horizontal ? 1 : drawn.length,
    columns: horizontal ? drawn.length : 1,
    scale: 1,
    skipped: 0,
  };
}

function layoutGrid(drawn: Drawn[], options: MergeOptions): MergePlan {
  const columns = clampColumns(options.columns, drawn.length);
  const rows = Math.ceil(drawn.length / columns);
  const { spacing, padding } = options;

  // Per-column and per-row maxima rather than one uniform cell: a grid of
  // mixed portrait and landscape shots wastes far less space this way.
  const colWidths = new Array<number>(columns).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  drawn.forEach((d, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    colWidths[col] = Math.max(colWidths[col], d.drawWidth);
    rowHeights[row] = Math.max(rowHeights[row], d.drawHeight);
  });

  const colX: number[] = [];
  let x = padding;
  for (let c = 0; c < columns; c++) {
    colX.push(x);
    x += colWidths[c] + spacing;
  }
  const rowY: number[] = [];
  let y = padding;
  for (let r = 0; r < rows; r++) {
    rowY.push(y);
    y += rowHeights[r] + spacing;
  }

  const canvas: ImageSize = {
    width: colWidths.reduce((a, b) => a + b, 0) + spacing * (columns - 1) + padding * 2,
    height: rowHeights.reduce((a, b) => a + b, 0) + spacing * (rows - 1) + padding * 2,
  };

  const placements: Placement[] = drawn.map((d, i) => {
    const column = i % columns;
    const row = Math.floor(i / columns);
    return {
      index: d.index,
      x: colX[column] + offsetFor(options.align, colWidths[column] - d.drawWidth),
      y: rowY[row] + offsetFor(options.align, rowHeights[row] - d.drawHeight),
      width: d.drawWidth,
      height: d.drawHeight,
      row,
      column,
    };
  });

  return { canvas, placements, rows, columns, scale: 1, skipped: 0 };
}

/** How much the whole plan has to shrink to stay inside the canvas caps. */
export function getLimitScale(canvas: ImageSize): number {
  if (canvas.width <= 0 || canvas.height <= 0) return 1;
  const bySide = Math.min(MAX_CANVAS_SIDE / canvas.width, MAX_CANVAS_SIDE / canvas.height);
  const area = canvas.width * canvas.height;
  const byArea = area > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / area) : 1;
  return Math.min(1, bySide, byArea);
}

/** Multiply every rectangle by `factor`, keeping at least one pixel per image. */
export function scalePlan(plan: MergePlan, factor: number): MergePlan {
  if (!Number.isFinite(factor) || factor >= 1 || factor <= 0) return plan;
  return {
    ...plan,
    canvas: {
      width: Math.max(1, Math.round(plan.canvas.width * factor)),
      height: Math.max(1, Math.round(plan.canvas.height * factor)),
    },
    placements: plan.placements.map((p) => ({
      ...p,
      x: Math.round(p.x * factor),
      y: Math.round(p.y * factor),
      width: Math.max(1, Math.round(p.width * factor)),
      height: Math.max(1, Math.round(p.height * factor)),
    })),
    scale: plan.scale * factor,
  };
}

function fitToCanvasLimits(plan: MergePlan): MergePlan {
  const factor = getLimitScale(plan.canvas);
  return factor < 1 ? scalePlan(plan, factor) : plan;
}

/** Keep stray values out of the layout maths before anything is measured. */
export function sanitizeOptions(options: MergeOptions, count = MAX_COLUMNS): MergeOptions {
  const layout: MergeLayout =
    options.layout === "vertical" || options.layout === "grid" ? options.layout : "horizontal";
  const sizing: MergeSizing =
    options.sizing === "original" || options.sizing === "largest" ? options.sizing : "smallest";
  const align: MergeAlign =
    options.align === "start" || options.align === "end" ? options.align : "center";
  return {
    layout,
    sizing,
    align,
    spacing: clampSpacing(options.spacing),
    padding: clampPadding(options.padding),
    columns: clampColumns(options.columns, count),
    background: normalizeHexColor(options.background),
    transparent: Boolean(options.transparent),
    format: getMergeFormat(options.format).value,
  };
}

export type MergeLang = "en" | "ru";

export interface PlanSummary {
  /** "2400 × 1600 px" */
  dimensions: string;
  /** "3.8 MP" */
  megapixels: string;
  /** Layout name in the page language. */
  layout: string;
  /** Empty unless the canvas cap forced a downscale. */
  notice: string;
}

const WORDS: Record<MergeLang, Record<string, string>> = {
  en: {
    horizontal: "Side by side",
    vertical: "Stacked",
    grid: "Grid",
    megapixels: "MP",
    shrunk: "Scaled to {pct}% so the canvas stays within browser limits.",
    skipped: "{n} file(s) could not be decoded and were skipped.",
  },
  ru: {
    horizontal: "В ряд",
    vertical: "Друг под другом",
    grid: "Сетка",
    megapixels: "Мп",
    shrunk: "Уменьшено до {pct}%, чтобы холст остался в пределах возможностей браузера.",
    skipped: "Не удалось декодировать файлов: {n}. Они пропущены.",
  },
};

export function describeLayout(layout: MergeLayout, lang: MergeLang = "en"): string {
  const w = WORDS[lang] ?? WORDS.en;
  return w[layout] ?? layout;
}

export function describePlan(
  plan: MergePlan,
  layout: MergeLayout,
  lang: MergeLang = "en",
): PlanSummary {
  const w = WORDS[lang] ?? WORDS.en;
  const mp = (plan.canvas.width * plan.canvas.height) / 1_000_000;
  const notices: string[] = [];
  if (plan.scale < 1) {
    notices.push(w.shrunk.replace("{pct}", String(Math.round(plan.scale * 100))));
  }
  if (plan.skipped > 0) {
    notices.push(w.skipped.replace("{n}", String(plan.skipped)));
  }
  return {
    dimensions: `${plan.canvas.width} × ${plan.canvas.height} px`,
    megapixels: `${formatNumber(mp, lang, { decimals: mp >= 10 ? 0 : 1 })} ${w.megapixels}`,
    layout: describeLayout(layout, lang),
    notice: notices.join(" "),
  };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Filename for the download.
 *
 * Two files with a shared prefix ("holiday-01", "holiday-02") produce
 * "holiday-merged"; anything else falls back to the picture count.
 */
export function mergedFilename(names: string[], layout: MergeLayout, ext: string): string {
  const bases = names
    .map((n) => (n ?? "").replace(/\.[^.]+$/, "").trim())
    .filter((n) => n.length > 0);
  // Trim the half-consumed counter: "holiday-01" and "holiday-02" share
  // "holiday-0", and "holiday-0-merged.png" reads like a mistake.
  const prefix = commonPrefix(bases).replace(/[\s._\-\d]+$/, "");
  if (prefix.length >= 3) return `${slugifyName(prefix)}-merged.${ext}`;
  const count = Math.max(bases.length, 1);
  return `merged-${count}-images-${layout}.${ext}`;
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }
  return prefix;
}

function slugifyName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9Ѐ-ӿ]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "images"
  );
}
