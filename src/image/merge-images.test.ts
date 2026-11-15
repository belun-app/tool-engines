import { describe, expect, it } from "vitest";
import {
  MAX_CANVAS_PIXELS,
  backgroundFill,
  canMerge,
  clampColumns,
  clampPadding,
  clampSpacing,
  defaultOptions,
  describeLayout,
  describePlan,
  formatFileSize,
  getLimitScale,
  getMergeFormat,
  mergedFilename,
  needsOpaqueBackground,
  normalizeHexColor,
  planMerge,
  sanitizeOptions,
  scalePlan,
} from "./merge-images.js";

// Bitmap decoding and drawImage are in the mount; the layout plan is tested here.

const opts = (over: Partial<ReturnType<typeof defaultOptions>> = {}) => ({
  ...defaultOptions(),
  ...over,
});

const rects = (plan: ReturnType<typeof planMerge>) =>
  plan.placements.map((p) => [p.index, p.x, p.y, p.width, p.height]);

describe("planMerge — side by side", () => {
  const sizes = [
    { width: 400, height: 200 },
    { width: 300, height: 300 },
  ];

  it("scales every image to the smallest height (default)", () => {
    // heights -> 200: 400x200 stays, 300x300 -> 200x200; width 400+12+200 = 612
    const p = planMerge(sizes, opts());
    expect(p.canvas).toEqual({ width: 612, height: 200 });
    expect(rects(p)).toEqual([
      [0, 0, 0, 400, 200],
      [1, 412, 0, 200, 200],
    ]);
    expect([p.rows, p.columns, p.scale, p.skipped]).toEqual([1, 2, 1, 0]);
  });

  it("scales to the largest height", () => {
    // heights -> 300: 400x200 -> 600x300; width 600+12+300 = 912
    const p = planMerge(sizes, opts({ sizing: "largest" }));
    expect(p.canvas).toEqual({ width: 912, height: 300 });
  });

  it("keeps original sizes and aligns on the cross axis", () => {
    // canvas 400+12+300 = 712 x 300; the 200-high image has 100 px free
    const centre = planMerge(sizes, opts({ sizing: "original" }));
    expect(centre.canvas).toEqual({ width: 712, height: 300 });
    expect(centre.placements[0].y).toBe(50);
    expect(planMerge(sizes, opts({ sizing: "original", align: "end" })).placements[0].y).toBe(100);
    expect(planMerge(sizes, opts({ sizing: "original", align: "start" })).placements[0].y).toBe(0);
  });

  it("adds padding around the whole collage", () => {
    const p = planMerge(sizes, opts({ padding: 10, spacing: 0 }));
    expect(p.canvas).toEqual({ width: 620, height: 220 });
    expect(p.placements[1].x).toBe(410);
    expect(p.placements[1].y).toBe(10);
  });
});

describe("planMerge — stacked", () => {
  it("normalises widths to the smallest", () => {
    // widths -> 300: 400x200 -> 300x150; height 150+12+300 = 462
    const p = planMerge(
      [
        { width: 400, height: 200 },
        { width: 300, height: 300 },
      ],
      opts({ layout: "vertical" }),
    );
    expect(p.canvas).toEqual({ width: 300, height: 462 });
    expect(rects(p)).toEqual([
      [0, 0, 0, 300, 150],
      [1, 0, 162, 300, 300],
    ]);
    expect([p.rows, p.columns]).toEqual([2, 1]);
  });
});

describe("planMerge — grid", () => {
  it("contains each image in its cell with per-row/column maxima (hand-computed)", () => {
    // smallest cell 100x100: 100x100, 200x100 -> 100x50, 100x200 -> 50x100
    // columns 2 -> colWidths [100,100], rowHeights [100,100]; spacing 10, padding 5
    const p = planMerge(
      [
        { width: 100, height: 100 },
        { width: 200, height: 100 },
        { width: 100, height: 200 },
      ],
      opts({ layout: "grid", columns: 2, spacing: 10, padding: 5 }),
    );
    expect(p.canvas).toEqual({ width: 220, height: 220 });
    expect(rects(p)).toEqual([
      [0, 5, 5, 100, 100],
      [1, 115, 30, 100, 50],
      [2, 30, 115, 50, 100],
    ]);
    expect([p.rows, p.columns]).toEqual([2, 2]);
  });

  it("never uses more columns than images", () => {
    const p = planMerge(
      [
        { width: 10, height: 10 },
        { width: 10, height: 10 },
      ],
      opts({ layout: "grid", columns: 5, spacing: 0 }),
    );
    expect(p.columns).toBe(2);
    expect(p.canvas).toEqual({ width: 20, height: 10 });
  });

  it("keeps originals in grid mode with sizing original", () => {
    const p = planMerge(
      [
        { width: 30, height: 10 },
        { width: 10, height: 20 },
      ],
      opts({ layout: "grid", sizing: "original", spacing: 0, columns: 1 }),
    );
    expect(p.canvas).toEqual({ width: 30, height: 30 });
  });
});

describe("planMerge — bad input and limits", () => {
  it("skips undecodable sizes but keeps the caller's indices", () => {
    const p = planMerge(
      [
        { width: 0, height: 0 },
        { width: Number.NaN, height: 5 },
        { width: 100, height: 100 },
      ],
      opts(),
    );
    expect(p.skipped).toBe(2);
    expect(p.placements.map((x) => x.index)).toEqual([2]);
  });

  it("returns the empty plan when nothing is usable", () => {
    const p = planMerge([{ width: -1, height: 10 }], opts());
    expect(p.placements).toEqual([]);
    expect(p.canvas).toEqual({ width: 0, height: 0 });
    expect(p.skipped).toBe(1);
    expect(planMerge([], opts()).skipped).toBe(0);
  });

  it("computes the limit scale from side and area caps", () => {
    expect(getLimitScale({ width: 24000, height: 1000 })).toBe(0.5); // 12000 / 24000
    // 10000² = 1e8 px > 6e7 -> sqrt(0.6)
    expect(getLimitScale({ width: 10000, height: 10000 })).toBeCloseTo(Math.sqrt(0.6));
    expect(getLimitScale({ width: 100, height: 100 })).toBe(1);
    expect(getLimitScale({ width: 0, height: 100 })).toBe(1);
  });

  it("shrinks an oversize collage under the caps", () => {
    const p = planMerge(
      [
        { width: 8000, height: 8000 },
        { width: 8000, height: 8000 },
      ],
      opts({ sizing: "original", spacing: 0 }),
    );
    expect(p.scale).toBeLessThan(1);
    expect(p.canvas.width).toBeLessThanOrEqual(12000);
    expect(p.canvas.width * p.canvas.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.001);
  });

  it("scalePlan ignores factors outside (0, 1)", () => {
    const plan = planMerge([{ width: 10, height: 10 }], opts());
    expect(scalePlan(plan, 1)).toBe(plan);
    expect(scalePlan(plan, 0)).toBe(plan);
    expect(scalePlan(plan, Number.NaN)).toBe(plan);
    expect(scalePlan(plan, 0.01).placements[0]).toMatchObject({ width: 1, height: 1 });
  });
});

describe("options", () => {
  it("clamps spacing, padding and columns", () => {
    expect(clampSpacing(999)).toBe(200);
    expect(clampSpacing(-5)).toBe(0);
    expect(clampSpacing(12.6)).toBe(13);
    expect(clampPadding(Number.NaN)).toBe(0);
    expect(clampColumns(Number.NaN)).toBe(2);
    expect(clampColumns(20)).toBe(8);
    expect(clampColumns(0)).toBe(1);
    expect(clampColumns(4, 3)).toBe(3);
  });

  it("sanitises garbage options to defaults", () => {
    const s = sanitizeOptions({
      layout: "diagonal",
      sizing: "huge",
      align: "middle",
      spacing: Number.NaN,
      padding: 5000,
      columns: 3,
      background: "blue",
      transparent: 1,
      format: "gif",
    } as unknown as ReturnType<typeof defaultOptions>);
    expect(s).toEqual({
      layout: "horizontal",
      sizing: "smallest",
      align: "center",
      spacing: 0,
      padding: 200,
      columns: 3,
      background: "#ffffff",
      transparent: true,
      format: "png",
    });
  });

  it("background depends on format alpha and the transparent switch", () => {
    expect(needsOpaqueBackground(opts({ format: "jpeg", transparent: true }))).toBe(true);
    expect(backgroundFill(opts({ format: "png", transparent: true }))).toBeNull();
    expect(backgroundFill(opts({ format: "webp", background: "#ABC" }))).toBe("#aabbcc");
    expect(getMergeFormat("jpeg").quality).toBe(0.92);
  });

  it("needs at least two images", () => {
    expect(canMerge(1)).toBe(false);
    expect(canMerge(2)).toBe(true);
  });

  it("normalises hex colours", () => {
    expect(normalizeHexColor(" #FfF ")).toBe("#ffffff");
    expect(normalizeHexColor(undefined as unknown as string, "#000000")).toBe("#000000");
  });
});

describe("describePlan / describeLayout", () => {
  const plan = (w: number, h: number, scale = 1, skipped = 0) => ({
    canvas: { width: w, height: h },
    placements: [],
    rows: 1,
    columns: 1,
    scale,
    skipped,
  });

  it("reports dimensions and megapixels", () => {
    // 2400·1600 = 3.84 MP -> "3.8 MP"; 4000·3000 = 12 MP -> "12 MP"
    expect(describePlan(plan(2400, 1600), "horizontal")).toEqual({
      dimensions: "2400 × 1600 px",
      megapixels: "3.8 MP",
      layout: "Side by side",
      notice: "",
    });
    expect(describePlan(plan(4000, 3000), "grid").megapixels).toBe("12 MP");
    expect(describePlan(plan(2400, 1600), "grid", "ru").megapixels).toBe("3,8 Мп");
  });

  it("adds shrink and skip notices in both languages", () => {
    expect(describePlan(plan(10, 10, 0.5, 1), "grid").notice).toBe(
      "Scaled to 50% so the canvas stays within browser limits. 1 file(s) could not be decoded and were skipped.",
    );
    const ru = describePlan(plan(10, 10, 1, 2), "vertical", "ru");
    expect(ru.layout).toBe("Друг под другом");
    expect(ru.notice).toBe("Не удалось декодировать файлов: 2. Они пропущены.");
    expect(describeLayout("grid", "ru")).toBe("Сетка");
  });
});

describe("formatFileSize / mergedFilename", () => {
  it("formats sizes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(100)).toBe("100 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.00 MB");
  });

  it("uses a shared prefix without the half-consumed counter", () => {
    expect(mergedFilename(["holiday-01.jpg", "holiday-02.jpg"], "horizontal", "png")).toBe(
      "holiday-merged.png",
    );
    expect(mergedFilename(["IMG_0001.JPG", "IMG_0002.JPG"], "grid", "jpg")).toBe("img-merged.jpg");
    expect(mergedFilename(["Отпуск 1.jpg", "Отпуск 2.jpg"], "grid", "png")).toBe(
      "отпуск-merged.png",
    );
  });

  it("falls back to a count-based name", () => {
    expect(mergedFilename(["a.jpg", "b.jpg"], "grid", "png")).toBe("merged-2-images-grid.png");
    expect(mergedFilename([], "vertical", "webp")).toBe("merged-1-images-vertical.webp");
  });
});
