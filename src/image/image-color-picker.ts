/**
 * Colour picking from image pixels: HEX, RGB, HSL, HSV and CMYK conversions, readable text
 * colour on a swatch, and a dominant-colour palette by median cut.
 */

export interface PickedColor {
  r: number;
  g: number;
  b: number;
  /** Opacity 0–1 (1 = opaque). */
  a: number;
  /** #RRGGBB, or #RRGGBBAA when the pixel is not fully opaque */
  hex: string;
  /** rgb(), or rgba() when the pixel is not fully opaque */
  rgb: string;
  /** hsl(), or hsla() when the pixel is not fully opaque */
  hsl: string;
  hsv: string;
  cmyk: string;
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l: Math.round(l * 100) };

  const s = delta / (1 - Math.abs(2 * l - 1));
  return { h: hue(rn, gn, bn, max, delta), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hue(rn: number, gn: number, bn: number, max: number, delta: number): number {
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h === 360 ? 0 : h;
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  return {
    h: delta === 0 ? 0 : hue(rn, gn, bn, max, delta),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
  };
}

/** Naive (device-independent) CMYK in percent, the usual "web" conversion. */
export function rgbToCmyk(
  r: number,
  g: number,
  b: number,
): { c: number; m: number; y: number; k: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const pct = (v: number) => Math.round(((1 - v - k) / (1 - k)) * 100);
  return { c: pct(rn), m: pct(gn), y: pct(bn), k: Math.round(k * 100) };
}

/**
 * Alpha 0–255 → "0.502"-style string with at most 3 decimals: 2 decimals would show
 * alpha 1 as 0 (fully transparent) and 254 as 1 (opaque) while the hex says otherwise.
 */
function alphaText(alpha: number): string {
  return String(Math.round((alpha / 255) * 1000) / 1000);
}

export function pickColor(r: number, g: number, b: number, alpha = 255): PickedColor {
  const red = clampChannel(r);
  const green = clampChannel(g);
  const blue = clampChannel(b);
  const al = clampChannel(Number.isFinite(alpha) ? alpha : 255);
  const opaque = al === 255;
  const { h, s, l } = rgbToHsl(red, green, blue);
  const hsv = rgbToHsv(red, green, blue);
  const cmyk = rgbToCmyk(red, green, blue);
  const a = alphaText(al);

  return {
    r: red,
    g: green,
    b: blue,
    a: Number(a),
    hex: `#${toHex(red)}${toHex(green)}${toHex(blue)}${opaque ? "" : toHex(al)}`,
    rgb: opaque ? `rgb(${red}, ${green}, ${blue})` : `rgba(${red}, ${green}, ${blue}, ${a})`,
    hsl: opaque ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${a})`,
    hsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
    cmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
  };
}

/** Whether black or white text stays readable on top of the given color. */
export function contrastTextColor(r: number, g: number, b: number): "black" | "white" {
  const luminance = 0.2126 * clampChannel(r) + 0.7152 * clampChannel(g) + 0.0722 * clampChannel(b);
  return luminance > 140 ? "black" : "white";
}

/**
 * Size of the working canvas. Browsers (iOS Safari first) refuse canvases above
 * ~16.7 megapixels, so only images larger than that are scaled down; everything up to
 * a 5K screenshot keeps its real pixels.
 */
export const MAX_CANVAS_PIXELS = 4096 * 4096;

export function fitCanvas(
  width: number,
  height: number,
  maxPixels = MAX_CANVAS_PIXELS,
): { width: number; height: number; scale: number } {
  const w = Math.max(1, Math.round(width) || 1);
  const h = Math.max(1, Math.round(height) || 1);
  const scale = Math.min(1, Math.sqrt(maxPixels / (w * h)));
  return {
    width: Math.max(1, Math.floor(w * scale)),
    height: Math.max(1, Math.floor(h * scale)),
    scale,
  };
}

/** Move a keyboard cursor inside the image: arrows by 1 px, by 10 with Shift. */
export function moveCursor(
  x: number,
  y: number,
  key: string,
  width: number,
  height: number,
  big = false,
): { x: number; y: number } {
  const step = big ? 10 : 1;
  let nx = x;
  let ny = y;
  if (key === "ArrowLeft") nx -= step;
  else if (key === "ArrowRight") nx += step;
  else if (key === "ArrowUp") ny -= step;
  else if (key === "ArrowDown") ny += step;
  else if (key === "Home") nx = 0;
  else if (key === "End") nx = width - 1;
  return {
    x: Math.min(Math.max(0, nx), Math.max(0, width - 1)),
    y: Math.min(Math.max(0, ny), Math.max(0, height - 1)),
  };
}

export interface PaletteColor extends PickedColor {
  /** Share of the sampled opaque pixels in this color's bucket, 0–1 */
  share: number;
}

/**
 * Dominant colors of an image (median cut). `data` is RGBA as from getImageData.
 * Transparent pixels are skipped; at most `maxSamples` pixels are read, evenly spread,
 * so a 16 MP photo costs the same as a thumbnail. Result: up to `count` colors, most
 * common first, near-duplicates merged.
 */
export function extractPalette(
  data: ArrayLike<number>,
  count = 8,
  maxSamples = 40_000,
): PaletteColor[] {
  const total = Math.floor(data.length / 4);
  if (total === 0 || count <= 0) return [];
  const stride = Math.max(1, Math.floor(total / maxSamples));
  const pixels: number[][] = [];
  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    pixels.push([data[o], data[o + 1], data[o + 2]]);
  }
  if (pixels.length === 0) return [];

  type Box = number[][];
  const range = (box: Box, ch: number) => {
    let lo = 255;
    let hi = 0;
    for (const p of box) {
      if (p[ch] < lo) lo = p[ch];
      if (p[ch] > hi) hi = p[ch];
    }
    return hi - lo;
  };
  const boxes: Box[] = [pixels];
  // Split more boxes than asked for, then merge near-duplicates and keep the biggest.
  const target = Math.min(count * 2, pixels.length);
  while (boxes.length < target) {
    let best = -1;
    let bestScore = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const score = Math.max(range(box, 0), range(box, 1), range(box, 2)) * Math.sqrt(box.length);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) break;
    const box = boxes[best];
    const ranges = [range(box, 0), range(box, 1), range(box, 2)];
    const ch = ranges.indexOf(Math.max(...ranges));
    box.sort((p, q) => p[ch] - q[ch]);
    // Split at the median value, keeping equal values on one side so a flat area is
    // never cut in two and averaged with its neighbour.
    const median = box[Math.floor(box.length / 2)][ch];
    let cut = box.findIndex((p) => p[ch] >= median);
    if (cut <= 0) cut = box.findIndex((p) => p[ch] > median);
    if (cut <= 0) break;
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }

  const avg = boxes
    .filter((box) => box.length > 0)
    .map((box) => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const p of box) {
        r += p[0];
        g += p[1];
        b += p[2];
      }
      return { r: r / box.length, g: g / box.length, b: b / box.length, n: box.length };
    })
    .sort((p, q) => q.n - p.n);

  const merged: typeof avg = [];
  for (const c of avg) {
    const near = merged.find(
      (m) => Math.abs(m.r - c.r) + Math.abs(m.g - c.g) + Math.abs(m.b - c.b) < 24,
    );
    if (near) {
      const n = near.n + c.n;
      near.r = (near.r * near.n + c.r * c.n) / n;
      near.g = (near.g * near.n + c.g * c.n) / n;
      near.b = (near.b * near.n + c.b * c.n) / n;
      near.n = n;
    } else merged.push({ ...c });
  }

  return merged
    .sort((p, q) => q.n - p.n)
    .slice(0, count)
    .map((c) => ({ ...pickColor(c.r, c.g, c.b), share: c.n / pixels.length }));
}
