import { describe, expect, it } from "vitest";
import {
  getPngFilename,
  looksLikeSvg,
  parseSvgMeta,
  prepareSvgForRender,
  resolveIntrinsicSize,
  scaledSize,
  sizeFromWidth,
} from "./svg-to-png-converter.js";

// Rasterisation itself (Image + canvas.toBlob) lives in the mount and is DOM-bound;
// everything below is the pure sizing / markup logic.

describe("looksLikeSvg", () => {
  it("needs both an opening and a closing svg tag", () => {
    expect(looksLikeSvg('<svg xmlns="x"><rect/></svg>')).toBe(true);
    expect(looksLikeSvg("<SVG></SVG >")).toBe(true);
    expect(looksLikeSvg("<svg>")).toBe(false);
    expect(looksLikeSvg("<svgx></svgx>")).toBe(false);
    expect(looksLikeSvg("")).toBe(false);
  });
});

describe("parseSvgMeta", () => {
  it("returns nulls when there is no svg tag", () => {
    expect(parseSvgMeta("<div/>")).toEqual({ width: null, height: null, viewBox: null });
  });

  it("converts absolute units to CSS px at 96 dpi", () => {
    const px = (w: string) => parseSvgMeta(`<svg width="${w}" height="1">`).width;
    expect(px("120")).toBe(120);
    expect(px("120px")).toBe(120);
    expect(px("72pt")).toBe(96);
    expect(px("1in")).toBe(96);
    expect(px("1pc")).toBe(16);
    expect(px("2.54cm")).toBeCloseTo(96, 10);
    expect(px("25.4mm")).toBeCloseTo(96, 10);
  });

  it("ignores relative, zero, negative and junk lengths", () => {
    const px = (w: string) => parseSvgMeta(`<svg width='${w}'>`).width;
    expect(px("100%")).toBeNull();
    expect(px("2em")).toBeNull();
    expect(px("0")).toBeNull();
    expect(px("-5")).toBeNull();
    expect(px("abc")).toBeNull();
  });

  it("parses a viewBox with spaces or commas", () => {
    expect(parseSvgMeta('<svg viewBox="0 0 24 24">').viewBox).toEqual([0, 0, 24, 24]);
    expect(parseSvgMeta('<svg viewBox="-1,-2, 10,20">').viewBox).toEqual([-1, -2, 10, 20]);
    expect(parseSvgMeta('<svg viewBox="0 0 24">').viewBox).toBeNull();
    expect(parseSvgMeta('<svg viewBox="a b c d">').viewBox).toBeNull();
  });
});

describe("resolveIntrinsicSize", () => {
  it("prefers explicit width and height", () => {
    expect(resolveIntrinsicSize({ width: 10, height: 20, viewBox: [0, 0, 1, 1] })).toEqual({
      width: 10,
      height: 20,
    });
  });

  it("derives the missing dimension from the viewBox aspect ratio", () => {
    expect(resolveIntrinsicSize({ width: 100, height: null, viewBox: [0, 0, 200, 50] })).toEqual({
      width: 100,
      height: 25,
    });
    expect(resolveIntrinsicSize({ width: null, height: 100, viewBox: [0, 0, 200, 50] })).toEqual({
      width: 400,
      height: 100,
    });
    expect(resolveIntrinsicSize({ width: null, height: null, viewBox: [0, 0, 24, 48] })).toEqual({
      width: 24,
      height: 48,
    });
  });

  it("falls back to the 300x150 replaced-element default", () => {
    expect(resolveIntrinsicSize({ width: null, height: null, viewBox: null })).toEqual({
      width: 300,
      height: 150,
    });
    expect(resolveIntrinsicSize({ width: 50, height: null, viewBox: null })).toEqual({
      width: 50,
      height: 150,
    });
    expect(resolveIntrinsicSize({ width: null, height: 50, viewBox: [0, 0, 0, 10] })).toEqual({
      width: 300,
      height: 50,
    });
  });
});

describe("scaledSize / sizeFromWidth", () => {
  it("scales and rounds, never below 1 px", () => {
    expect(scaledSize({ width: 24, height: 24 }, 2)).toEqual({ width: 48, height: 48 });
    expect(scaledSize({ width: 10, height: 3 }, 0.25)).toEqual({ width: 3, height: 1 });
    expect(scaledSize({ width: 10, height: 10 }, 0)).toEqual({ width: 1, height: 1 });
  });

  it("keeps the aspect ratio for a target width", () => {
    expect(sizeFromWidth({ width: 200, height: 100 }, 51)).toEqual({ width: 51, height: 26 });
    expect(sizeFromWidth({ width: 0, height: 100 }, 10)).toEqual({ width: 10, height: 10 });
    expect(sizeFromWidth({ width: 10, height: 10 }, -5)).toEqual({ width: 1, height: 1 });
  });
});

describe("getPngFilename", () => {
  it("swaps or appends the extension", () => {
    expect(getPngFilename("logo.svg")).toBe("logo.png");
    expect(getPngFilename("LOGO.SVG")).toBe("LOGO.png");
    expect(getPngFilename("icon.xml")).toBe("icon.png");
    expect(getPngFilename("noext")).toBe("noext.png");
    expect(getPngFilename("  ")).toBe("image.png");
    expect(getPngFilename(".svg")).toBe("image.png");
  });
});

describe("prepareSvgForRender", () => {
  it("returns non-SVG input untouched", () => {
    expect(prepareSvgForRender("<div/>", 10, 10)).toBe("<div/>");
  });

  it("sets the target size, adds a viewBox and the namespace", () => {
    const out = prepareSvgForRender('<svg width="24" height="12"><rect/></svg>', 48, 24);
    expect(out).toBe(
      '<svg width="48" height="24" viewBox="0 0 24 12" xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    );
  });

  it("keeps an existing viewBox, namespace and other attributes", () => {
    const out = prepareSvgForRender(
      `<svg xmlns="http://www.w3.org/2000/svg" class="a" viewBox='0 0 5 5' width="1in"><g/></svg>`,
      100,
      100,
    );
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" class="a" width="100" height="100" viewBox="0 0 5 5"><g/></svg>',
    );
  });

  it("is not confused by $ patterns in the markup", () => {
    const out = prepareSvgForRender('<svg data-x="$&"><text>$1</text></svg>', 1, 1);
    expect(out).toContain('data-x="$&"');
    expect(out).toContain("<text>$1</text>");
  });
});
