import { describe, expect, it } from "vitest";
import {
  type SignatureStroke,
  cleanStroke,
  signatureBounds,
  signatureFileName,
  signatureStats,
  strokeToPathData,
  strokesToSvg,
} from "./online-signature.js";

// Pointer capture and canvas painting are in the mount; geometry and SVG export are here.

const stroke = (points: [number, number][], width = 2, color = "#000"): SignatureStroke => ({
  points: points.map(([x, y]) => ({ x, y })),
  color,
  width,
});

describe("cleanStroke", () => {
  it("drops non-finite points and points closer than minDistance", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 }, // 0.5 < 0.6 from the previous kept point
      { x: 1, y: 0 },
      { x: Number.NaN, y: 1 },
      { x: 1, y: Number.POSITIVE_INFINITY },
    ];
    expect(cleanStroke(pts)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("returns [] for non-arrays", () => {
    expect(cleanStroke(null as unknown as [])).toEqual([]);
  });
});

describe("strokeToPathData", () => {
  it("returns an empty path for no points", () => {
    expect(strokeToPathData([])).toBe("");
  });

  it("draws a dot for a single point as a tiny line", () => {
    expect(strokeToPathData([{ x: 1, y: 2 }])).toBe("M 1 2 L 1.01 2");
  });

  it("draws a straight line for two points", () => {
    expect(
      strokeToPathData([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe("M 0 0 L 10 0");
  });

  it("joins three+ points with quadratic curves through midpoints", () => {
    // control (10,0), end at midpoint of (10,0)-(10,10) = (10,5), then line to (10,10)
    expect(
      strokeToPathData(
        stroke([
          [0, 0],
          [10, 0],
          [10, 10],
        ]).points,
      ),
    ).toBe("M 0 0 Q 10 0 10 5 L 10 10");
  });

  it("rounds to the requested precision", () => {
    expect(
      strokeToPathData(
        [
          { x: 1.23456, y: 0 },
          { x: 2, y: 2.98765 },
        ],
        2,
      ),
    ).toBe("M 1.23 0 L 2 2.99");
  });
});

describe("signatureBounds", () => {
  it("grows the box by half the pen width plus padding", () => {
    // points (10,10)-(20,30), half width 2 -> (8,8)-(22,32)
    expect(
      signatureBounds([
        stroke(
          [
            [10, 10],
            [20, 30],
          ],
          4,
        ),
      ]),
    ).toEqual({
      x: 8,
      y: 8,
      width: 14,
      height: 24,
      empty: false,
    });
    expect(
      signatureBounds(
        [
          stroke(
            [
              [10, 10],
              [20, 30],
            ],
            4,
          ),
        ],
        1,
      ),
    ).toEqual({
      x: 7,
      y: 7,
      width: 16,
      height: 26,
      empty: false,
    });
  });

  it("reports empty when there is no finite point", () => {
    expect(signatureBounds([])).toMatchObject({ empty: true, width: 0, height: 0 });
    expect(signatureBounds([stroke([[Number.NaN, 1]])]).empty).toBe(true);
  });

  it("never returns a zero-size box for a single zero-width dot", () => {
    expect(signatureBounds([stroke([[5, 5]], 0)])).toMatchObject({ width: 1, height: 1 });
  });
});

describe("signatureStats", () => {
  it("counts drawn strokes and finite points", () => {
    expect(
      signatureStats([
        stroke([]),
        stroke([
          [1, 1],
          [2, 2],
        ]),
        stroke([[Number.NaN, 0]]),
      ]),
    ).toEqual({ strokes: 1, points: 2, empty: false });
    expect(signatureStats([])).toEqual({ strokes: 0, points: 0, empty: true });
  });
});

describe("strokesToSvg", () => {
  it("exports the whole canvas by default without a background", () => {
    const svg = strokesToSvg(
      [
        stroke(
          [
            [0, 0],
            [10, 0],
          ],
          3,
          "#123456",
        ),
      ],
      300,
      150,
    );
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150">' +
        '<path d="M 0 0 L 10 0" fill="none" stroke="#123456" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>",
    );
  });

  it("trims to the ink with padding and draws a background rect", () => {
    // ink (10,10)-(20,30) width 4 -> (8,8)-(22,32), padding 8 -> x=0 y=0 w=30 h=40
    const svg = strokesToSvg(
      [
        stroke(
          [
            [10, 10],
            [20, 30],
          ],
          4,
        ),
      ],
      300,
      150,
      {
        trim: true,
        background: "#fff",
      },
    );
    expect(svg).toContain('viewBox="0 0 30 40"');
    expect(svg).toContain('<rect x="0" y="0" width="30" height="40" fill="#fff"/>');
  });

  it("escapes attribute values", () => {
    const svg = strokesToSvg([stroke([[0, 0]], 1, '"><script>')], 10, 10, {
      background: "a&b",
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain('stroke="&quot;&gt;&lt;script&gt;"');
    expect(svg).toContain('fill="a&amp;b"');
  });

  it("falls back to the full canvas when trimming an empty signature", () => {
    expect(strokesToSvg([], 200, 100, { trim: true })).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"></svg>',
    );
  });

  it("omits the rect for a transparent background and clamps bad widths", () => {
    const svg = strokesToSvg(
      [
        stroke(
          [
            [0, 0],
            [1, 1],
          ],
          Number.NaN,
        ),
      ],
      10,
      10,
      {
        background: "transparent",
      },
    );
    expect(svg).not.toContain("<rect");
    expect(svg).toContain('stroke-width="1"');
  });
});

describe("signatureFileName", () => {
  it("uses the ISO date and a lower-case extension without a dot", () => {
    expect(signatureFileName(".PNG", "2026-08-06T10:00:00.000Z")).toBe("signature-2026-08-06.png");
    expect(signatureFileName("svg", "2026-01-02")).toBe("signature-2026-01-02.svg");
    expect(signatureFileName("", "2026-01-02")).toBe("signature-2026-01-02.png");
  });
});
