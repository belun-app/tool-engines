import { describe, expect, it } from "vitest";
import { type GradientOptions, buildGradient } from "./css-gradient-generator.js";

const base: GradientOptions = {
  type: "linear",
  angle: 90,
  shape: "circle",
  stops: [
    { color: "#3b82f6", position: 0 },
    { color: "#ec4899", position: 100 },
  ],
};

describe("buildGradient", () => {
  it("builds a linear gradient", () => {
    expect(buildGradient(base)).toEqual({
      gradient: "linear-gradient(90deg, #3b82f6 0%, #ec4899 100%)",
      css: "background: linear-gradient(90deg, #3b82f6 0%, #ec4899 100%);",
      valid: true,
    });
  });

  it("builds radial circle and ellipse gradients (unknown shape -> circle)", () => {
    expect(buildGradient({ ...base, type: "radial" }).gradient).toBe(
      "radial-gradient(circle, #3b82f6 0%, #ec4899 100%)",
    );
    expect(buildGradient({ ...base, type: "radial", shape: "ellipse" }).gradient).toBe(
      "radial-gradient(ellipse, #3b82f6 0%, #ec4899 100%)",
    );
    expect(
      buildGradient({ ...base, type: "radial", shape: "oval" as unknown as "circle" }).gradient,
    ).toContain("radial-gradient(circle,");
  });

  it("clamps angle 0..360 and positions 0..100, rounding both", () => {
    const r = buildGradient({
      ...base,
      angle: 400.4,
      stops: [
        { color: " red ", position: -5 },
        { color: "blue", position: 33.6 },
        { color: "green", position: 250 },
      ],
    });
    expect(r.gradient).toBe("linear-gradient(360deg, red 0%, blue 34%, green 100%)");
    expect(buildGradient({ ...base, angle: Number.NaN }).gradient).toMatch(
      /^linear-gradient\(0deg/,
    );
  });

  it("skips empty color stops and keeps a single stop", () => {
    const r = buildGradient({
      ...base,
      stops: [
        { color: "  ", position: 0 },
        { color: "rgb(0, 0, 0)", position: 50 },
      ],
    });
    expect(r.gradient).toBe("linear-gradient(90deg, rgb(0, 0, 0) 50%)");
  });

  it("returns the invalid result when no usable stops", () => {
    const invalid = { gradient: "", css: "", valid: false };
    expect(buildGradient({ ...base, stops: [] })).toEqual(invalid);
    expect(buildGradient({ ...base, stops: [{ color: "", position: 0 }] })).toEqual(invalid);
    expect(buildGradient(undefined as unknown as GradientOptions)).toEqual(invalid);
  });
});
