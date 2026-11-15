import { describe, expect, it } from "vitest";
import { analyzeVideoStream, measureFrameRate } from "./webcam-test.js";

// Getting the stream itself (getUserMedia, requestVideoFrameCallback) is browser/hardware-bound
// and lives in the mount; only the analysis of the stream's settings is tested here.

describe("analyzeVideoStream", () => {
  it("describes a 720p webcam", () => {
    // 1280*720 = 921 600 px -> 0.9 MP
    expect(analyzeVideoStream({ width: 1280, height: 720, reportedFrameRate: 30 })).toEqual({
      resolution: "1280 × 720",
      resolutionLabel: "HD 720p",
      aspectRatio: "16:9",
      megapixels: 0.9,
      frameRate: 30,
    });
  });

  it("labels the common resolution classes by their short side", () => {
    const label = (w: number, h: number) =>
      analyzeVideoStream({ width: w, height: h }).resolutionLabel;
    expect(label(3840, 2160)).toBe("4K UHD");
    expect(label(2560, 1440)).toBe("QHD 1440p");
    expect(label(1920, 1080)).toBe("Full HD 1080p");
    expect(label(640, 480)).toBe("SD 480p");
    expect(label(320, 240)).toBe("240p");
    // portrait (phone front camera) uses the short side too
    expect(label(720, 1280)).toBe("HD 720p");
  });

  it("computes aspect ratio and megapixels", () => {
    expect(analyzeVideoStream({ width: 640, height: 480 })).toMatchObject({
      aspectRatio: "4:3",
      megapixels: 0.3,
    });
    // 1920*1080 = 2.07 MP -> 2.1; 3840*2160 = 8.29 MP -> 8.3
    expect(analyzeVideoStream({ width: 1920, height: 1080 }).megapixels).toBe(2.1);
    expect(analyzeVideoStream({ width: 3840, height: 2160 }).megapixels).toBe(8.3);
    // tiny streams keep two decimals instead of rounding to 0 (shown as "—")
    expect(analyzeVideoStream({ width: 160, height: 120 }).megapixels).toBe(0.02);
    expect(analyzeVideoStream({ width: 320, height: 240 }).megapixels).toBe(0.08);
    expect(analyzeVideoStream({ width: 1080, height: 1080 }).aspectRatio).toBe("1:1");
    expect(analyzeVideoStream({ width: 720, height: 1280 }).aspectRatio).toBe("9:16");
    // 352x288 (CIF): gcd 32 -> 11:9
    expect(analyzeVideoStream({ width: 352, height: 288 }).aspectRatio).toBe("11:9");
    // 2560x1080 is 1.6 % from 21:9 -> 64:27 is too big -> decimal form
    expect(analyzeVideoStream({ width: 2560, height: 1080 }).aspectRatio).toBe("2.37:1");
  });

  it("rounds the reported frame rate and reports 0 when unknown", () => {
    expect(
      analyzeVideoStream({ width: 640, height: 480, reportedFrameRate: 29.97 }).frameRate,
    ).toBe(30);
    expect(
      analyzeVideoStream({ width: 640, height: 480, reportedFrameRate: 14.94 }).frameRate,
    ).toBe(14.9);
    expect(analyzeVideoStream({ width: 640, height: 480 }).frameRate).toBe(0);
    expect(analyzeVideoStream({ width: 640, height: 480, reportedFrameRate: -5 }).frameRate).toBe(
      0,
    );
  });

  it("returns the empty result for zero / negative dimensions", () => {
    for (const r of [
      analyzeVideoStream({ width: 0, height: 480 }),
      analyzeVideoStream({ width: 640, height: -1 }),
    ]) {
      expect(r).toEqual({
        resolution: "",
        resolutionLabel: "",
        aspectRatio: "",
        megapixels: 0,
        frameRate: 0,
      });
    }
  });
});

describe("measureFrameRate", () => {
  it("returns 0 for fewer than two frames", () => {
    expect(measureFrameRate([])).toBe(0);
    expect(measureFrameRate([123])).toBe(0);
  });

  it("measures fps from frame timestamps", () => {
    // 31 frames spread over exactly 1000 ms -> 30 intervals / 1 s = 30 fps
    const ts = Array.from({ length: 31 }, (_, i) => 5000 + (i * 1000) / 30);
    expect(measureFrameRate(ts)).toBe(30);
    // 3 frames over 100 ms -> 2 / 0.1 s = 20 fps
    expect(measureFrameRate(new Float64Array([0, 50, 100]))).toBe(20);
    // 4 frames over 300 ms -> 10 fps; uneven spacing does not matter
    expect(measureFrameRate([0, 10, 290, 300])).toBe(10);
  });

  it("rounds to one decimal", () => {
    // 2 intervals over 70 ms -> 28.571 -> 28.6
    expect(measureFrameRate([0, 35, 70])).toBe(28.6);
  });

  it("returns 0 for zero, negative or non-finite elapsed time", () => {
    expect(measureFrameRate([100, 100])).toBe(0);
    expect(measureFrameRate([200, 100])).toBe(0);
    expect(measureFrameRate([0, Number.NaN])).toBe(0);
  });
});
