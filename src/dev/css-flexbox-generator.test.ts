import { describe, expect, it } from "vitest";
import { type FlexboxOptions, buildFlexboxCss } from "./css-flexbox-generator.js";

describe("buildFlexboxCss", () => {
  it("builds the container block with gap", () => {
    expect(
      buildFlexboxCss({
        direction: "column",
        justify: "space-between",
        align: "center",
        wrap: "wrap",
        gap: 16,
      }),
    ).toEqual({
      css: [
        "display: flex;",
        "flex-direction: column;",
        "justify-content: space-between;",
        "align-items: center;",
        "flex-wrap: wrap;",
        "gap: 16px;",
      ].join("\n"),
      valid: true,
    });
  });

  it("omits gap when 0 and clamps/rounds it to 0..100", () => {
    const opts: FlexboxOptions = {
      direction: "row",
      justify: "flex-start",
      align: "stretch",
      wrap: "nowrap",
      gap: 0,
    };
    expect(buildFlexboxCss(opts).css).not.toContain("gap");
    expect(buildFlexboxCss({ ...opts, gap: -4 }).css).not.toContain("gap");
    expect(buildFlexboxCss({ ...opts, gap: 250 }).css).toContain("gap: 100px;");
    expect(buildFlexboxCss({ ...opts, gap: 7.5 }).css).toContain("gap: 8px;");
    expect(buildFlexboxCss({ ...opts, gap: Number.NaN }).css).not.toContain("gap");
  });

  it("falls back to defaults for unknown enum values", () => {
    const r = buildFlexboxCss({
      direction: "diagonal",
      justify: "middle",
      align: "top",
      wrap: "maybe",
      gap: 0,
    } as unknown as FlexboxOptions);
    expect(r.css).toBe(
      "display: flex;\nflex-direction: row;\njustify-content: flex-start;\nalign-items: stretch;\nflex-wrap: nowrap;",
    );
  });

  it("returns the invalid result for a missing object", () => {
    expect(buildFlexboxCss(null as unknown as FlexboxOptions)).toEqual({ css: "", valid: false });
  });
});
