import { describe, expect, it } from "vitest";
import {
  fitCanvas,
  formatBytes,
  normalizeWatermarkText,
  planWatermark,
  resolveWatermarkOutput,
  rotatedBounds,
  watermarkFileName,
  watermarkFontString,
} from "./image-watermark-tool.js";

// measureText and drawing are in the mount; the placement geometry is tested here.

const base = { canvasWidth: 1000, canvasHeight: 500, markWidth: 200, markHeight: 50 };

describe("rotatedBounds", () => {
  it("is the rectangle itself at 0° and swapped at 90°", () => {
    expect(rotatedBounds(100, 50, 0)).toEqual({ width: 100, height: 50 });
    const r = rotatedBounds(100, 50, 90);
    expect(r.width).toBeCloseTo(50);
    expect(r.height).toBeCloseTo(100);
  });

  it("grows at 45°: (w + h)·√½", () => {
    const r = rotatedBounds(100, 50, 45);
    expect(r.width).toBeCloseTo(150 * Math.SQRT1_2);
    expect(r.height).toBeCloseTo(150 * Math.SQRT1_2);
  });

  it("treats negative and non-finite input as zero", () => {
    expect(rotatedBounds(-5, Number.NaN, 30)).toEqual({ width: 0, height: 0 });
  });
});

describe("planWatermark — single anchors", () => {
  // scale = 1000·25% / 200 = 1.25 -> 250 × 62.5; margin = 500·3% = 15
  it("defaults to bottom-right at 25% width with a 3% margin", () => {
    const p = planWatermark(base);
    expect(p.empty).toBe(false);
    expect(p.scale).toBe(1.25);
    expect(p.width).toBe(250);
    expect(p.height).toBe(62.5);
    // cx = 1000 - 15 - 125, cy = 500 - 15 - 31.25
    expect(p.stamps).toEqual([{ cx: 860, cy: 453.75 }]);
  });

  it.each([
    ["top-left", 140, 46.25],
    ["top-center", 500, 46.25],
    ["middle-left", 140, 250],
    ["center", 500, 250],
    ["middle-right", 860, 250],
    ["bottom-left", 140, 453.75],
    ["bottom-center", 500, 453.75],
  ] as const)("%s -> (%d, %d)", (anchor, cx, cy) => {
    expect(planWatermark({ ...base, anchor }).stamps).toEqual([{ cx, cy }]);
  });

  it("centres a mark that is wider than the frame minus margins", () => {
    const p = planWatermark({ ...base, sizePercent: 100, anchor: "bottom-right" });
    expect(p.stamps[0].cx).toBe(500);
  });

  it("shrinks a rotated mark that would overflow the height", () => {
    // 90°: rotated height = 250 > 100 -> scale 1.25 · 100/250 = 0.5
    const p = planWatermark({ ...base, canvasHeight: 100, rotation: 90 });
    expect(p.scale).toBeCloseTo(0.5);
    expect(p.width).toBeCloseTo(100);
    expect(p.boundingHeight).toBeCloseTo(100);
    expect(p.rotationRad).toBeCloseTo(Math.PI / 2);
  });

  it("clamps size, rotation and margin to their ranges", () => {
    expect(planWatermark({ ...base, sizePercent: 500 }).width).toBe(1000);
    expect(planWatermark({ ...base, sizePercent: 0 }).width).toBe(10);
    expect(planWatermark({ ...base, rotation: 999 }).rotationRad).toBeCloseTo(Math.PI);
    // margin 99% -> 25% of 500 = 125: top-left cx = 125 + 125
    expect(planWatermark({ ...base, anchor: "top-left", marginPercent: 99 }).stamps[0].cx).toBe(
      250,
    );
  });
});

describe("planWatermark — tile", () => {
  it("lays out a centred, staggered brick grid (hand-computed)", () => {
    // stamp 250×62.5, gap 60% -> stepX = 400, stepY = 100
    // cols = ceil(1000/400)+1 = 4, rows = ceil(500/100)+1 = 6
    // originX = 500 - 3·400/2 = -100, originY = 250 - 5·100/2 = 0
    const p = planWatermark({ ...base, anchor: "tile" });
    expect(p.stamps).toHaveLength(24);
    expect(p.stamps[0]).toEqual({ cx: -100, cy: 0 });
    expect(p.stamps[1]).toEqual({ cx: 300, cy: 0 });
    expect(p.stamps[4]).toEqual({ cx: 100, cy: 100 }); // row 1 offset by half a step
  });

  it("caps the grid at about 20 tiles per axis for tiny marks", () => {
    const p = planWatermark({
      ...base,
      markWidth: 1,
      markHeight: 1,
      sizePercent: 1,
      anchor: "tile",
    });
    // stepX = max(16, 1000/20 = 50) -> 21 columns; stepY = max(16, 25) -> 21 rows
    expect(p.stamps).toHaveLength(21 * 21);
  });
});

describe("planWatermark — empty", () => {
  it("returns the empty plan when there is nothing to draw", () => {
    for (const over of [{ canvasWidth: 0 }, { markWidth: 0 }, { markHeight: Number.NaN }]) {
      const p = planWatermark({ ...base, ...over });
      expect(p.empty).toBe(true);
      expect(p.stamps).toEqual([]);
    }
  });

  it("does not share the stamps array between empty plans", () => {
    const a = planWatermark({ ...base, canvasWidth: 0 });
    a.stamps.push({ cx: 1, cy: 1 });
    try {
      expect(planWatermark({ ...base, canvasWidth: 0 }).stamps).toEqual([]);
    } finally {
      // Undo the mutation: while the bug exists it lands in the engine's shared
      // EMPTY_PLAN and would break other tests in any order.
      a.stamps.length = 0;
    }
  });
});

describe("text and font helpers", () => {
  it("collapses captions to one line", () => {
    expect(normalizeWatermarkText("  © 2026\n  Jane\tDoe ")).toBe("© 2026 Jane Doe");
    expect(normalizeWatermarkText(null as unknown as string)).toBe("");
  });

  it("builds the canvas font shorthand", () => {
    expect(watermarkFontString(48.4, "Georgia")).toBe("bold 48px Georgia");
    expect(watermarkFontString(Number.NaN, " ", false)).toBe("1px Arial, Helvetica, sans-serif");
  });
});

describe("resolveWatermarkOutput", () => {
  it("keeps JPEG and WebP sources and falls back to PNG otherwise", () => {
    expect(resolveWatermarkOutput("image/jpeg").ext).toBe("jpg");
    expect(resolveWatermarkOutput("IMAGE/JPG").ext).toBe("jpg");
    expect(resolveWatermarkOutput("image/webp").ext).toBe("webp");
    expect(resolveWatermarkOutput("image/gif")).toEqual({
      mime: "image/png",
      ext: "png",
      lossy: false,
    });
    expect(resolveWatermarkOutput("").ext).toBe("png");
  });

  it("an explicit choice wins", () => {
    expect(resolveWatermarkOutput("image/png", "jpeg").mime).toBe("image/jpeg");
    expect(resolveWatermarkOutput("image/jpeg", "png").lossy).toBe(false);
  });
});

describe("watermarkFileName / fitCanvas / formatBytes", () => {
  it("slugs the source name", () => {
    expect(watermarkFileName("beach photo.JPG", "jpg")).toBe("beach-photo-watermarked.jpg");
    expect(watermarkFileName("Пляж 2026.png", "png")).toBe("пляж-2026-watermarked.png");
    expect(watermarkFileName("!!!.png", "png")).toBe("image-watermarked.png");
    expect(watermarkFileName("", "png", "tiled")).toBe("image-tiled.png");
  });

  it("limits the longest side", () => {
    // 6000×4000 -> scale 4096/6000, height 2730.67 -> 2731
    expect(fitCanvas(6000, 4000)).toEqual({ width: 4096, height: 2731, scale: 4096 / 6000 });
    expect(fitCanvas(100, 50)).toEqual({ width: 100, height: 50, scale: 1 });
    expect(fitCanvas(Number.NaN, 0)).toEqual({ width: 1, height: 1, scale: 1 });
  });

  it("formats byte counts", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});
