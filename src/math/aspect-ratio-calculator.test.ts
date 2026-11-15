import { describe, expect, it } from "vitest";
import { calcAspectRatio, nearestAspectRatio } from "./aspect-ratio-calculator.js";

describe("calcAspectRatio", () => {
  it("reduces common resolutions to their ratio", () => {
    expect(calcAspectRatio(1920, 1080).ratioString).toBe("16:9"); // gcd 120
    expect(calcAspectRatio(1024, 768).ratioString).toBe("4:3"); // gcd 256
    expect(calcAspectRatio(2560, 1080).ratioString).toBe("64:27"); // gcd 40
    expect(calcAspectRatio(1080, 1920).ratioString).toBe("9:16");
    expect(calcAspectRatio(500, 500).ratioString).toBe("1:1");
  });

  it("returns ratio parts as numbers", () => {
    const r = calcAspectRatio(1920, 1080);
    expect(r.ratioWidth).toBe(16);
    expect(r.ratioHeight).toBe(9);
    expect(r.scaledHeight).toBeNull();
    expect(r.scaledWidth).toBeNull();
  });

  it("scales a new width to a height and a new height to a width", () => {
    // 1280 * 1080 / 1920 = 720 ; 480 * 1920 / 1080 = 853.33 -> 853
    const r = calcAspectRatio(1920, 1080, 1280, 480);
    expect(r.scaledHeight).toBe(720);
    expect(r.scaledWidth).toBe(853);
  });

  it("ignores zero, negative and non-finite target sizes", () => {
    const r = calcAspectRatio(1920, 1080, 0, -5);
    expect(r.scaledHeight).toBeNull();
    expect(r.scaledWidth).toBeNull();
    expect(calcAspectRatio(1920, 1080, Number.NaN, null).scaledHeight).toBeNull();
  });

  it("returns the invalid result for zero, negative or non-finite originals", () => {
    for (const [w, h] of [
      [0, 1080],
      [1920, 0],
      [-1920, 1080],
      [Number.NaN, 1080],
      [1920, Number.POSITIVE_INFINITY],
    ]) {
      const r = calcAspectRatio(w, h, 100, 100);
      expect(r.ratioString).toBe("—");
      expect(r.ratioWidth).toBe(0);
      expect(r.scaledHeight).toBeNull();
    }
  });

  it("handles very large and coprime sizes", () => {
    expect(calcAspectRatio(7680, 4320).ratioString).toBe("16:9");
    expect(calcAspectRatio(1366, 768).ratioString).toBe("683:384");
    expect(calcAspectRatio(1001, 1000).ratioString).toBe("1001:1000");
  });

  it("reduces decimal sizes by their true ratio", () => {
    expect(calcAspectRatio(1.5, 2.5).ratioString).toBe("3:5");
    expect(calcAspectRatio(0.4, 1).ratioString).not.toBe("0:1");
  });
});

describe("decimal form and nearest named format", () => {
  it("names ultrawide and odd laptop sizes by the format they are sold as", () => {
    expect(calcAspectRatio(2560, 1080).nearest).toEqual({ label: "21:9", exact: false });
    expect(calcAspectRatio(3440, 1440).nearest).toEqual({ label: "21:9", exact: false });
    expect(calcAspectRatio(1366, 768).nearest).toEqual({ label: "16:9", exact: false });
    expect(calcAspectRatio(2.39, 1).nearest).toEqual({ label: "21:9", exact: false });
  });

  it("marks an exact match with a different spelling (8:5 is 16:10)", () => {
    expect(calcAspectRatio(1920, 1200).nearest).toEqual({ label: "16:10", exact: true });
    expect(calcAspectRatio(1080, 1728).nearest).toEqual({ label: "10:16", exact: true });
  });

  it("returns no nearest format when the reduced ratio already is the name", () => {
    expect(calcAspectRatio(1920, 1080).nearest).toBeNull();
    expect(calcAspectRatio(1080, 1350).nearest).toBeNull(); // 4:5
    expect(calcAspectRatio(1000, 1000).nearest).toBeNull();
  });

  it("keeps neighbouring formats apart", () => {
    expect(nearestAspectRatio(1.85, 1)).toBeNull(); // 1.85:1 is not 16:9
    expect(nearestAspectRatio(1280, 1024)?.label).toBe("5:4");
    expect(nearestAspectRatio(1024, 768)?.label).toBe("4:3");
  });

  it("returns the decimal width-to-height ratio", () => {
    expect(calcAspectRatio(2560, 1080).decimal).toBeCloseTo(2.37, 3);
    expect(calcAspectRatio(1.85, 1).decimal).toBe(1.85);
    expect(calcAspectRatio(0, 1).decimal).toBe(0);
    expect(calcAspectRatio(0, 1).nearest).toBeNull();
  });
});
