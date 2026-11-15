import { describe, expect, it } from "vitest";
import {
  type ScreenInfoInput,
  analyzeScreen,
  estimateZoom,
  resolutionName,
  simplifyAspectRatio,
} from "./what-is-my-screen-resolution.js";

const base: ScreenInfoInput = {
  screenWidth: 1920,
  screenHeight: 1080,
  availWidth: 1920,
  availHeight: 1040,
  viewportWidth: 1903,
  viewportHeight: 969,
  devicePixelRatio: 1,
  colorDepth: 24,
};

describe("simplifyAspectRatio", () => {
  it("maps common resolutions to their marketed ratio", () => {
    expect(simplifyAspectRatio(1920, 1080)).toBe("16:9");
    expect(simplifyAspectRatio(2560, 1440)).toBe("16:9");
    // 1366/768 = 1.7786, 0.05 % from 16/9 -> snaps to 16:9
    expect(simplifyAspectRatio(1366, 768)).toBe("16:9");
    expect(simplifyAspectRatio(1440, 900)).toBe("16:10");
    expect(simplifyAspectRatio(1024, 768)).toBe("4:3");
    expect(simplifyAspectRatio(1280, 1024)).toBe("5:4");
    expect(simplifyAspectRatio(1080, 1920)).toBe("9:16");
    expect(simplifyAspectRatio(500, 500)).toBe("1:1");
    expect(simplifyAspectRatio(5120, 1440)).toBe("32:9");
  });

  it("reduces by the GCD when the ratio is not a common one but small", () => {
    // 390x844 (iPhone 12): gcd 2 -> 195:422 (too big) -> decimal 844/390 = 2.164,
    // written in portrait form like the orientation
    expect(simplifyAspectRatio(390, 844)).toBe("1:2.16");
    expect(simplifyAspectRatio(844, 390)).toBe("2.16:1");
    // 1000x700: gcd 100 -> 10:7, not within 1.2 % of any common ratio
    expect(simplifyAspectRatio(1000, 700)).toBe("10:7");
  });

  it("falls back to an N:1 decimal for large reduced terms", () => {
    // 1000x461: gcd 1, 2.169 matches no common ratio
    expect(simplifyAspectRatio(1000, 461)).toBe("2.17:1");
    expect(simplifyAspectRatio(461, 1000)).toBe("1:2.17");
  });

  it("names ultrawides 21:9 as they are sold, in both orientations", () => {
    // 64:27 and 43:18 are 1.6 % and 2.4 % away from 21/9 itself
    expect(simplifyAspectRatio(2560, 1080)).toBe("21:9");
    expect(simplifyAspectRatio(3440, 1440)).toBe("21:9");
    expect(simplifyAspectRatio(1080, 2560)).toBe("9:21");
    expect(simplifyAspectRatio(1440, 3440)).toBe("9:21");
  });

  it("returns an empty string for zero or negative sides", () => {
    expect(simplifyAspectRatio(0, 1080)).toBe("");
    expect(simplifyAspectRatio(1920, 0)).toBe("");
    expect(simplifyAspectRatio(-1920, 1080)).toBe("");
  });
});

describe("resolutionName", () => {
  it("names common panels by their physical pixels, in either orientation", () => {
    expect(resolutionName(1920, 1080)).toBe("Full HD (1080p)");
    expect(resolutionName(1080, 1920)).toBe("Full HD (1080p)");
    expect(resolutionName(2560, 1440)).toBe("QHD / 2K (1440p)");
    expect(resolutionName(3840, 2160)).toBe("4K UHD (2160p)");
    // 1536 x 864 at 125 % -> 1920 x 1080 physical, float noise rounded away
    expect(resolutionName(1536 * 1.25, 864 * 1.25)).toBe("Full HD (1080p)");
  });

  it("returns an empty string for unnamed or invalid sizes", () => {
    expect(resolutionName(1170, 2532)).toBe("");
    expect(resolutionName(0, 1080)).toBe("");
  });
});

describe("estimateZoom", () => {
  it("reports a browser zoom level when the window ratio lands on one", () => {
    expect(estimateZoom(1920, 1280)).toBe(150);
    expect(estimateZoom(1920, 1536)).toBe(125);
    expect(estimateZoom(1920, 2133)).toBe(90);
  });

  it("returns 0 at 100 %, for window borders, docked panels and missing values", () => {
    expect(estimateZoom(1920, 1920)).toBe(0);
    expect(estimateZoom(1936, 1920)).toBe(0); // window border
    expect(estimateZoom(1920, 1411)).toBe(0); // DevTools docked: 1.36, no zoom level
    expect(estimateZoom(0, 1920)).toBe(0);
  });
});

describe("analyzeScreen", () => {
  it("reports a standard 1080p monitor", () => {
    const r = analyzeScreen(base);
    expect(r.resolution).toBe("1920 × 1080");
    expect(r.physicalResolution).toBe("1920 × 1080");
    expect(r.viewport).toBe("1903 × 969");
    expect(r.available).toBe("1920 × 1040");
    expect(r.aspectRatio).toBe("16:9");
    expect(r.orientation).toBe("Landscape");
    // 1920*1080 = 2 073 600 px = 2.07 MP -> one decimal
    expect(r.megapixels).toBe(2.1);
    expect(r.pixelRatio).toBe(1);
    expect(r.pixelDensityLabel).toBe("Standard (1×)");
    expect(r.colorDepth).toBe(24);
  });

  it("multiplies by devicePixelRatio for the physical resolution", () => {
    // 1280x720 CSS px at 1.5 -> 1920x1080 device px
    const r = analyzeScreen({
      ...base,
      screenWidth: 1280,
      screenHeight: 720,
      devicePixelRatio: 1.5,
    });
    expect(r.physicalResolution).toBe("1920 × 1080");
    expect(r.megapixels).toBe(2.1);
    expect(r.pixelDensityLabel).toBe("HiDPI (1.25–1.99×)");
  });

  it("labels Retina and 3x screens and keeps portrait orientation", () => {
    // iPhone: 390x844 at 3 -> 1170x2532 = 2 962 440 px -> 3.0 MP
    const r = analyzeScreen({ ...base, screenWidth: 390, screenHeight: 844, devicePixelRatio: 3 });
    expect(r.physicalResolution).toBe("1170 × 2532");
    expect(r.megapixels).toBe(3);
    expect(r.orientation).toBe("Portrait");
    expect(r.pixelDensityLabel).toBe("Super Retina (3×+)");
    expect(analyzeScreen({ ...base, devicePixelRatio: 2 }).pixelDensityLabel).toBe(
      "Retina / HiDPI (2×)",
    );
  });

  it("returns the density class as a code for the page to label", () => {
    expect(analyzeScreen({ ...base, devicePixelRatio: 1 }).pixelDensity).toBe("standard");
    expect(analyzeScreen({ ...base, devicePixelRatio: 1.9 }).pixelDensity).toBe("hidpi");
    expect(analyzeScreen({ ...base, devicePixelRatio: 2 }).pixelDensity).toBe("retina");
    expect(analyzeScreen({ ...base, devicePixelRatio: 3 }).pixelDensity).toBe("super-retina");
  });

  it("rounds the pixel ratio to two decimals and fractional physical sizes to integers", () => {
    // 1536x864 at 1.25 -> 1920x1080; dpr 1.3333 -> 1.33
    const r = analyzeScreen({
      ...base,
      screenWidth: 1536,
      screenHeight: 864,
      devicePixelRatio: 1.25,
    });
    expect(r.physicalResolution).toBe("1920 × 1080");
    expect(analyzeScreen({ ...base, devicePixelRatio: 4 / 3 }).pixelRatio).toBe(1.33);
    expect(analyzeScreen({ ...base, devicePixelRatio: 4 / 3 }).physicalResolution).toBe(
      "2560 × 1440",
    );
  });

  it("reports Square for equal sides", () => {
    expect(analyzeScreen({ ...base, screenWidth: 800, screenHeight: 800 }).orientation).toBe(
      "Square",
    );
  });

  it("treats a missing / zero devicePixelRatio as 1", () => {
    const r = analyzeScreen({ ...base, devicePixelRatio: 0 });
    expect(r.pixelRatio).toBe(1);
    expect(r.physicalResolution).toBe("1920 × 1080");
  });

  it("blanks out missing viewport / available sizes and colour depth", () => {
    const r = analyzeScreen({ ...base, viewportWidth: 0, availHeight: 0, colorDepth: -1 });
    expect(r.viewport).toBe("");
    expect(r.available).toBe("");
    expect(r.colorDepth).toBe(0);
  });

  it("returns the empty result for a zero or negative screen size", () => {
    for (const r of [
      analyzeScreen({ ...base, screenWidth: 0 }),
      analyzeScreen({ ...base, screenHeight: -5 }),
    ]) {
      expect(r.resolution).toBe("");
      expect(r.megapixels).toBe(0);
      expect(r.pixelRatio).toBe(0);
      expect(r.orientation).toBe("");
    }
  });
});
