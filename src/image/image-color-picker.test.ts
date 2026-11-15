import { describe, expect, it } from "vitest";
import {
  contrastTextColor,
  extractPalette,
  fitCanvas,
  moveCursor,
  pickColor,
  rgbToCmyk,
  rgbToHsl,
  rgbToHsv,
} from "./image-color-picker.js";

// Reading pixels off the canvas happens in the mount (getImageData); the engine only
// formats the picked channels, which is what is tested here.

describe("rgbToHsl", () => {
  it.each([
    [255, 0, 0, 0, 100, 50],
    [0, 255, 0, 120, 100, 50],
    [0, 0, 255, 240, 100, 50],
    [255, 255, 0, 60, 100, 50],
    [0, 255, 255, 180, 100, 50],
    [255, 0, 255, 300, 100, 50],
    // #336699: r=.2 g=.4 b=.6, l=.4, s=.4/(1-|0.8-1|)=.5, h=((.2-.4)/.4+4)*60=210
    [51, 102, 153, 210, 50, 40],
    [255, 255, 255, 0, 0, 100],
    [0, 0, 0, 0, 0, 0],
    [128, 128, 128, 0, 0, 50],
  ])("rgb(%i,%i,%i) -> hsl(%i,%i%%,%i%%)", (r, g, b, h, s, l) => {
    expect(rgbToHsl(r, g, b)).toEqual({ h, s, l });
  });

  it("wraps negative hues into 0..359", () => {
    // rgb(255,0,128): max=r, h=((0-0.502)/1)*60 = -30.1 -> -30 -> 330
    expect(rgbToHsl(255, 0, 128).h).toBe(330);
  });
});

describe("pickColor", () => {
  it("formats hex (upper-case, zero-padded), rgb and hsl strings", () => {
    expect(pickColor(51, 102, 153)).toEqual({
      r: 51,
      g: 102,
      b: 153,
      a: 1,
      hex: "#336699",
      rgb: "rgb(51, 102, 153)",
      hsl: "hsl(210, 50%, 40%)",
      hsv: "hsv(210, 67%, 60%)",
      cmyk: "cmyk(67%, 33%, 0%, 40%)",
    });
    expect(pickColor(0, 10, 255).hex).toBe("#000AFF");
  });

  it("clamps and rounds out-of-range and non-finite channels", () => {
    const c = pickColor(300, -5, Number.NaN);
    expect([c.r, c.g, c.b]).toEqual([255, 0, 0]);
    expect(c.hex).toBe("#FF0000");
    expect(pickColor(12.6, 12.4, Number.POSITIVE_INFINITY).rgb).toBe("rgb(13, 12, 0)");
  });

  it("never prints a negative-zero hue for near-red colors", () => {
    // rgb(255,0,1): h = (-1/255)*60 = -0.235 -> rounds to -0
    expect(pickColor(255, 0, 1).hsl).toBe("hsl(0, 100%, 50%)");
  });
});

describe("alpha", () => {
  it("a fully transparent pixel is never reported as opaque black", () => {
    const clear = pickColor(0, 0, 0, 0);
    const black = pickColor(0, 0, 0);
    expect(clear.hex).toBe("#00000000");
    expect(clear.rgb).toBe("rgba(0, 0, 0, 0)");
    expect(clear.hsl).toBe("hsla(0, 0%, 0%, 0)");
    expect(clear.a).toBe(0);
    expect(clear.hex).not.toBe(black.hex);
  });

  it("keeps half-transparent pixels' alpha", () => {
    const c = pickColor(255, 0, 0, 128);
    expect(c.hex).toBe("#FF000080");
    expect(c.rgb).toBe("rgba(255, 0, 0, 0.502)");
    expect(c.a).toBe(0.502);
  });

  it("never rounds a nearly transparent or nearly opaque pixel to 0 or 1", () => {
    const faint = pickColor(10, 20, 30, 1);
    expect(faint.a).toBe(0.004);
    expect(faint.rgb).toBe("rgba(10, 20, 30, 0.004)");
    expect(pickColor(10, 20, 30, 2).a).toBe(0.008);
    const almost = pickColor(10, 20, 30, 254);
    expect(almost.a).toBe(0.996);
    expect(almost.hsl).toBe("hsla(210, 50%, 8%, 0.996)");
  });

  it("treats a missing or broken alpha as opaque", () => {
    expect(pickColor(1, 2, 3).hex).toBe("#010203");
    expect(pickColor(1, 2, 3, Number.NaN).hex).toBe("#010203");
  });
});

describe("rgbToHsv / rgbToCmyk", () => {
  it.each([
    [255, 0, 0, 0, 100, 100, 0, 100, 100, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 100],
    [255, 255, 255, 0, 0, 100, 0, 0, 0, 0],
    [63, 162, 196, 195, 68, 77, 68, 17, 0, 23],
  ])("rgb(%i,%i,%i) -> hsv(%i,%i,%i) cmyk(%i,%i,%i,%i)", (r, g, b, h, s, v, c, m, y, k) => {
    expect(rgbToHsv(r, g, b)).toEqual({ h, s, v });
    expect(rgbToCmyk(r, g, b)).toEqual({ c, m, y, k });
  });
});

describe("fitCanvas", () => {
  it("keeps every real pixel up to the 16.7 MP canvas limit (a 5K screenshot)", () => {
    expect(fitCanvas(5120, 2880)).toMatchObject({ width: 5120, height: 2880, scale: 1 });
    expect(fitCanvas(5120, 40)).toMatchObject({ width: 5120, height: 40 });
  });

  it("scales larger images down to fit the pixel budget", () => {
    const r = fitCanvas(8000, 6000);
    expect(r.width * r.height).toBeLessThanOrEqual(4096 * 4096);
    expect(r.width / r.height).toBeCloseTo(8000 / 6000, 2);
  });

  it("never returns a zero-sized canvas", () => {
    expect(fitCanvas(0, 0)).toMatchObject({ width: 1, height: 1 });
  });
});

describe("moveCursor", () => {
  it("moves by 1 px, by 10 with Shift, and stays inside the image", () => {
    expect(moveCursor(5, 5, "ArrowRight", 80, 20)).toEqual({ x: 6, y: 5 });
    expect(moveCursor(5, 5, "ArrowDown", 80, 20, true)).toEqual({ x: 5, y: 15 });
    expect(moveCursor(0, 0, "ArrowLeft", 80, 20)).toEqual({ x: 0, y: 0 });
    expect(moveCursor(79, 19, "ArrowDown", 80, 20, true)).toEqual({ x: 79, y: 19 });
    expect(moveCursor(40, 3, "End", 80, 20)).toEqual({ x: 79, y: 3 });
  });
});

describe("extractPalette", () => {
  const rgba = (pixels: number[][]) => pixels.flatMap((p) => [...p, p[3] ?? 255]);

  it("returns the dominant colors, most common first", () => {
    const data = rgba([
      ...Array.from({ length: 60 }, () => [255, 0, 0]),
      ...Array.from({ length: 30 }, () => [0, 0, 255]),
      ...Array.from({ length: 10 }, () => [255, 255, 255]),
    ]);
    const palette = extractPalette(data, 5);
    expect(palette.map((c) => c.hex)).toEqual(["#FF0000", "#0000FF", "#FFFFFF"]);
    expect(palette[0].share).toBeCloseTo(0.6, 2);
  });

  it("skips transparent pixels and merges JPEG-noise near-duplicates", () => {
    const data = rgba([
      ...Array.from({ length: 50 }, (_, i) => [40 + (i % 3), 110, 200]),
      ...Array.from({ length: 50 }, () => [0, 0, 0, 0]),
    ]);
    const palette = extractPalette(data, 4);
    expect(palette).toHaveLength(1);
    expect(palette[0].hex).toBe("#296EC8");
  });

  it("returns nothing for an empty or fully transparent image", () => {
    expect(extractPalette([], 5)).toEqual([]);
    expect(extractPalette([0, 0, 0, 0], 5)).toEqual([]);
  });
});

describe("contrastTextColor", () => {
  it("picks black on light and white on dark colors", () => {
    expect(contrastTextColor(255, 255, 255)).toBe("black");
    expect(contrastTextColor(0, 0, 0)).toBe("white");
    // yellow: 0.2126*255 + 0.7152*255 = 236.6 > 140
    expect(contrastTextColor(255, 255, 0)).toBe("black");
    // blue: 0.0722*255 = 18.4
    expect(contrastTextColor(0, 0, 255)).toBe("white");
  });

  it("uses a strict > 140 threshold on luminance", () => {
    // grey: coefficients sum to 1, so luminance equals the channel value
    expect(contrastTextColor(140, 140, 140)).toBe("white");
    expect(contrastTextColor(141, 141, 141)).toBe("black");
  });

  it("clamps channels before weighting", () => {
    expect(contrastTextColor(999, 999, 999)).toBe("black");
    expect(contrastTextColor(Number.NaN, -10, 0)).toBe("white");
  });
});
