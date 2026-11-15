import { describe, expect, it } from "vitest";
import {
  type GridOptions,
  type GridTrack,
  buildGridCss,
  buildItemDeclarations,
  buildTrackTemplate,
  formatTrack,
} from "./css-grid-generator.js";

const fr = (value = 1): GridTrack => ({ value, unit: "fr" });

describe("formatTrack", () => {
  it("formats each unit and rounds to 2 decimals", () => {
    expect(formatTrack({ value: 1, unit: "fr" })).toBe("1fr");
    expect(formatTrack({ value: 240, unit: "px" })).toBe("240px");
    expect(formatTrack({ value: 33.3333, unit: "%" })).toBe("33.33%");
    expect(formatTrack({ value: 5, unit: "auto" })).toBe("auto");
  });

  it("clamps negatives to 0, defaults non-finite to 1 and unknown units to fr", () => {
    expect(formatTrack({ value: -5, unit: "px" })).toBe("0px");
    expect(formatTrack({ value: Number.NaN, unit: "px" })).toBe("1px");
    expect(formatTrack({ value: 2, unit: "em" as GridTrack["unit"] })).toBe("2fr");
  });
});

describe("buildTrackTemplate", () => {
  it("collapses identical tracks into repeat()", () => {
    expect(buildTrackTemplate([fr(), fr(), fr()])).toBe("repeat(3, 1fr)");
    expect(buildTrackTemplate([fr()])).toBe("1fr");
    expect(buildTrackTemplate([{ value: 200, unit: "px" }, fr(), { value: 0, unit: "auto" }])).toBe(
      "200px 1fr auto",
    );
  });

  it("yields none for an empty list", () => {
    expect(buildTrackTemplate([])).toBe("none");
    expect(buildTrackTemplate(undefined as unknown as GridTrack[])).toBe("none");
  });
});

describe("buildItemDeclarations", () => {
  it("emits start/span or span-only declarations", () => {
    expect(
      buildItemDeclarations({ index: 0, columnStart: 2, columnSpan: 3, rowStart: 0, rowSpan: 2 }),
    ).toEqual(["grid-column: 2 / span 3;", "grid-row: span 2;"]);
    expect(
      buildItemDeclarations({ index: 0, columnStart: 0, columnSpan: 1, rowStart: 1, rowSpan: 1 }),
    ).toEqual(["grid-row: 1 / span 1;"]);
  });

  it("emits nothing for default placement and sanitises junk", () => {
    expect(
      buildItemDeclarations({ index: 0, columnStart: 0, columnSpan: 1, rowStart: 0, rowSpan: 1 }),
    ).toEqual([]);
    expect(
      buildItemDeclarations({
        index: 0,
        columnStart: -3,
        columnSpan: Number.NaN,
        rowStart: 2.7,
        rowSpan: 0,
      }),
    ).toEqual(["grid-row: 2 / span 1;"]);
  });
});

describe("buildGridCss", () => {
  const base: GridOptions = {
    columns: [fr(), fr(), fr()],
    rows: [],
    columnGap: 16,
    rowGap: 16,
    justifyItems: "stretch",
    alignItems: "stretch",
  };

  it("builds a minimal container, omitting defaults", () => {
    const r = buildGridCss(base);
    expect(r.valid).toBe(true);
    expect(r.containerCss).toBe(
      "display: grid;\ngrid-template-columns: repeat(3, 1fr);\ngap: 16px;",
    );
    expect(r.css).toBe(
      ".grid-container {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 16px;\n}",
    );
    expect(r.rowTemplate).toBe("none");
  });

  it("writes row template, two-value gap (row column) and non-default alignment", () => {
    const r = buildGridCss({
      ...base,
      rows: [
        { value: 100, unit: "px" },
        { value: 0, unit: "auto" },
      ],
      rowGap: 8,
      columnGap: 300,
      justifyItems: "center",
      alignItems: "end",
    });
    expect(r.containerCss.split("\n")).toEqual([
      "display: grid;",
      "grid-template-columns: repeat(3, 1fr);",
      "grid-template-rows: 100px auto;",
      "gap: 8px 200px;",
      "justify-items: center;",
      "align-items: end;",
    ]);
  });

  it("omits gap when both are 0 and falls back on unknown alignment", () => {
    const r = buildGridCss({
      ...base,
      columnGap: 0,
      rowGap: 0,
      justifyItems: "middle" as GridOptions["justifyItems"],
    });
    expect(r.containerCss).not.toContain("gap");
    expect(r.containerCss).not.toContain("justify-items");
  });

  it("adds 1-based item rules only for items with overrides", () => {
    const r = buildGridCss({
      ...base,
      items: [
        { index: 0, columnStart: 0, columnSpan: 1, rowStart: 0, rowSpan: 1 },
        { index: 2, columnStart: 1, columnSpan: 2, rowStart: 0, rowSpan: 1 },
      ],
    });
    expect(r.itemRules).toEqual([
      { selector: ".item-3", declarations: ["grid-column: 1 / span 2;"] },
    ]);
    expect(r.css.endsWith(".item-3 {\n  grid-column: 1 / span 2;\n}")).toBe(true);
  });

  it("returns the invalid result for a missing object", () => {
    expect(buildGridCss(null as unknown as GridOptions).valid).toBe(false);
  });
});
