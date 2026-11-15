import { describe, expect, it } from "vitest";
import {
  type Matrix,
  describeTransform,
  formatAngle,
  getDrawPlan,
  getFormatInfo,
  getRotatedFilename,
  getRotatedSize,
  identityState,
  isIdentity,
  isRightAngle,
  needsBackground,
  normalizeAngle,
  normalizeHexColor,
  rotateBy,
  setAngle,
  snapAngle,
  toggleFlipH,
  toggleFlipV,
} from "./rotate-flip-image.js";

// decode + drawImage live in the mount; the canvas size and matrix are tested here
// by applying the matrix to the source corners by hand.

/** Canvas setTransform semantics: x' = a·x + c·y + e, y' = b·x + d·y + f. */
function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function corners(w: number, h: number, angle: number, flipH = false, flipV = false) {
  const plan = getDrawPlan(w, h, { angle, flipH, flipV });
  const { drawX: x0, drawY: y0 } = plan;
  // Round away float residue (cos 90° = 6e-17) and fold -0 into 0.
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
  const round = ([x, y]: [number, number]) => [r6(x), r6(y)];
  return {
    plan,
    tl: round(apply(plan.matrix, x0, y0)),
    tr: round(apply(plan.matrix, x0 + w, y0)),
    bl: round(apply(plan.matrix, x0, y0 + h)),
  };
}

describe("normalizeAngle", () => {
  it.each([
    [0, 0],
    [90, 90],
    [-90, 270],
    [360, 0],
    [720 + 45, 45],
    [-450, 270],
    [359.999, 0], // float drift reads as 0, not a near-full turn
    [12.5, 12.5],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])("%d -> %d", (input, expected) => {
    expect(normalizeAngle(input)).toBe(expected);
  });
});

describe("state helpers", () => {
  it("rotate, set, toggle and identity are pure", () => {
    const s0 = identityState();
    const s1 = rotateBy(s0, -90);
    expect(s1.angle).toBe(270);
    expect(s0.angle).toBe(0);
    expect(rotateBy(s1, 90).angle).toBe(0);
    expect(setAngle(s0, 450).angle).toBe(90);
    expect(toggleFlipH(s0).flipH).toBe(true);
    expect(toggleFlipV(toggleFlipV(s0)).flipV).toBe(false);
    expect(isIdentity(s0)).toBe(true);
    expect(isIdentity({ angle: 360, flipH: false, flipV: false })).toBe(true);
    expect(isIdentity(toggleFlipH(s0))).toBe(false);
  });

  it("identityState returns a fresh copy", () => {
    const a = identityState();
    a.angle = 90;
    expect(identityState().angle).toBe(0);
  });

  it("isRightAngle", () => {
    expect([0, 90, 180, 270, -90, 450].every(isRightAngle)).toBe(true);
    expect(isRightAngle(45)).toBe(false);
  });
});

describe("getRotatedSize", () => {
  it("keeps or swaps the size at right angles", () => {
    expect(getRotatedSize(200, 100, 0)).toEqual({ width: 200, height: 100 });
    expect(getRotatedSize(200, 100, 180)).toEqual({ width: 200, height: 100 });
    expect(getRotatedSize(200, 100, 90)).toEqual({ width: 100, height: 200 });
    expect(getRotatedSize(200, 100, -90)).toEqual({ width: 100, height: 200 });
  });

  it("grows to the bounding box in between", () => {
    // 100x100 at 45°: 100·cos45 + 100·sin45 = 141.42 -> 141
    expect(getRotatedSize(100, 100, 45)).toEqual({ width: 141, height: 141 });
    // 200x100 at 30°: w = 200·0.866 + 100·0.5 = 223.2, h = 200·0.5 + 100·0.866 = 186.6
    expect(getRotatedSize(200, 100, 30)).toEqual({ width: 223, height: 187 });
  });

  it("returns 0x0 for empty images", () => {
    expect(getRotatedSize(0, 100, 30)).toEqual({ width: 0, height: 0 });
    expect(getRotatedSize(10, -1, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("getDrawPlan", () => {
  it("identity maps the image onto the canvas unchanged", () => {
    const c = corners(200, 100, 0);
    expect(c.plan.canvas).toEqual({ width: 200, height: 100 });
    expect(c.tl).toEqual([0, 0]);
    expect(c.tr).toEqual([200, 0]);
    expect(c.bl).toEqual([0, 100]);
    expect(c.plan.isRightAngle).toBe(true);
  });

  it("90° clockwise sends the top-left corner to the top-right", () => {
    const c = corners(200, 100, 90);
    expect(c.plan.canvas).toEqual({ width: 100, height: 200 });
    expect(c.tl).toEqual([100, 0]);
    expect(c.tr).toEqual([100, 200]);
    expect(c.bl).toEqual([0, 0]);
  });

  it("horizontal flip mirrors left-to-right", () => {
    const c = corners(200, 100, 0, true);
    expect(c.tl).toEqual([200, 0]);
    expect(c.bl).toEqual([200, 100]);
  });

  it("vertical flip mirrors top-to-bottom", () => {
    const c = corners(200, 100, 0, false, true);
    expect(c.tl).toEqual([0, 100]);
  });

  it("flips are applied in screen space after rotation (90° + flipH = transpose)", () => {
    const c = corners(200, 100, 90, true);
    expect(c.tl).toEqual([0, 0]);
    expect(c.tr).toEqual([0, 200]);
    expect(c.bl).toEqual([100, 0]);
  });

  it("free angles keep every corner inside the canvas", () => {
    const { plan, tl, tr, bl } = corners(200, 100, 30);
    expect(plan.isRightAngle).toBe(false);
    for (const [x, y] of [tl, tr, bl]) {
      expect(x).toBeGreaterThanOrEqual(-0.5);
      expect(x).toBeLessThanOrEqual(plan.canvas.width + 0.5);
      expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(y).toBeLessThanOrEqual(plan.canvas.height + 0.5);
    }
  });
});

describe("needsBackground / getFormatInfo", () => {
  it("only JPEG at right angles or any free angle needs a fill", () => {
    expect(needsBackground({ angle: 90, flipH: false, flipV: false }, "jpeg")).toBe(true);
    expect(needsBackground({ angle: 90, flipH: false, flipV: false }, "png")).toBe(false);
    expect(needsBackground({ angle: 90, flipH: false, flipV: false }, "webp")).toBe(false);
    expect(needsBackground({ angle: 30, flipH: false, flipV: false }, "png")).toBe(true);
  });

  it("unknown format falls back to JPEG", () => {
    expect(getFormatInfo("bmp" as "png").value).toBe("jpeg");
  });
});

describe("labels and filenames", () => {
  it("describes rotation and flips in English and Russian", () => {
    expect(describeTransform(identityState())).toEqual({
      rotation: "None",
      flip: "None",
      slug: "",
    });
    expect(describeTransform({ angle: 90, flipH: true, flipV: true })).toEqual({
      rotation: "90° clockwise",
      flip: "Horizontal + vertical",
      slug: "rot90-fliph-flipv",
    });
    expect(describeTransform({ angle: 270, flipH: false, flipV: true }, "ru")).toEqual({
      rotation: "270° по часовой",
      flip: "По вертикали",
      slug: "rot270-flipv",
    });
  });

  it("uses a dash for decimal angles in the slug", () => {
    expect(describeTransform({ angle: 12.5, flipH: false, flipV: false }).slug).toBe("rot12-5");
    expect(formatAngle(12.5)).toBe("12.5");
    expect(formatAngle(-90)).toBe("270");
  });

  it("builds filenames from the slug", () => {
    expect(getRotatedFilename("cat.jpg", { angle: 90, flipH: true, flipV: false })).toBe(
      "cat-rot90-fliph",
    );
    expect(getRotatedFilename("cat.jpg", identityState())).toBe("cat-rotated");
    expect(getRotatedFilename("", identityState())).toBe("image-rotated");
  });
});

describe("snapAngle", () => {
  it("snaps within tolerance to the nearest step", () => {
    expect(snapAngle(88.5)).toBe(90);
    expect(snapAngle(87)).toBe(87);
    expect(snapAngle(359)).toBe(0);
    expect(snapAngle(1.5)).toBe(0);
    expect(snapAngle(44, 45)).toBe(45);
  });
});

describe("normalizeHexColor", () => {
  it("accepts 6- and 3-digit hex and lower-cases them", () => {
    expect(normalizeHexColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHexColor(" #F0a ")).toBe("#ff00aa");
  });

  it("falls back for anything else", () => {
    expect(normalizeHexColor("red")).toBe("#ffffff");
    expect(normalizeHexColor("#12345", "#000000")).toBe("#000000");
    expect(normalizeHexColor("")).toBe("#ffffff");
  });
});
