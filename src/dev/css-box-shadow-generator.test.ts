import { describe, expect, it } from "vitest";
import { type ShadowLayer, buildBoxShadow } from "./css-box-shadow-generator.js";

const layer = (over: Partial<ShadowLayer> = {}): ShadowLayer => ({
  offsetX: 0,
  offsetY: 8,
  blur: 24,
  spread: 0,
  color: "#000000",
  opacity: 25,
  inset: false,
  ...over,
});

describe("buildBoxShadow", () => {
  it("builds one layer with rgba for translucent hex", () => {
    expect(buildBoxShadow([layer()])).toEqual({
      shadow: "0px 8px 24px 0px rgba(0, 0, 0, 0.25)",
      css: "box-shadow: 0px 8px 24px 0px rgba(0, 0, 0, 0.25);",
      valid: true,
    });
  });

  it("keeps hex at full opacity and expands #rgb for rgba", () => {
    expect(buildBoxShadow([layer({ opacity: 100, color: "#ABC" })]).shadow).toBe(
      "0px 8px 24px 0px #ABC",
    );
    // #f80 -> ff8800 = 255,136,0 at 50% -> 0.5 (trailing zero trimmed)
    expect(buildBoxShadow([layer({ opacity: 50, color: "#f80" })]).shadow).toBe(
      "0px 8px 24px 0px rgba(255, 136, 0, 0.5)",
    );
  });

  it("passes non-hex colours through unchanged", () => {
    expect(buildBoxShadow([layer({ color: "rgb(1,2,3)" })]).shadow).toBe(
      "0px 8px 24px 0px rgb(1,2,3)",
    );
  });

  it("supports inset and multiple layers", () => {
    expect(
      buildBoxShadow([layer({ inset: true, opacity: 100 }), layer({ offsetX: -4, opacity: 100 })])
        .shadow,
    ).toBe("inset 0px 8px 24px 0px #000000, -4px 8px 24px 0px #000000");
  });

  it("clamps offsets (±200), blur (0..200), spread (±100) and rounds", () => {
    expect(
      buildBoxShadow([
        layer({ offsetX: 999, offsetY: -999, blur: -5, spread: 150.6, opacity: 100 }),
      ]).shadow,
    ).toBe("200px -200px 0px 100px #000000");
    expect(buildBoxShadow([layer({ blur: 2.5, opacity: 100 })]).shadow).toBe(
      "0px 8px 3px 0px #000000",
    );
  });

  it("returns the invalid result when no layer has a colour", () => {
    const invalid = { shadow: "", css: "", valid: false };
    expect(buildBoxShadow([])).toEqual(invalid);
    expect(buildBoxShadow([layer({ color: " " })])).toEqual(invalid);
    expect(buildBoxShadow(null as unknown as ShadowLayer[])).toEqual(invalid);
  });
});
