export type FlexDirection = "row" | "row-reverse" | "column" | "column-reverse";
export type JustifyContent =
  | "flex-start"
  | "flex-end"
  | "center"
  | "space-between"
  | "space-around"
  | "space-evenly";
export type AlignItems = "stretch" | "flex-start" | "flex-end" | "center" | "baseline";
export type FlexWrap = "nowrap" | "wrap" | "wrap-reverse";

export interface FlexboxOptions {
  direction: FlexDirection;
  justify: JustifyContent;
  align: AlignItems;
  wrap: FlexWrap;
  gap: number;
}

export interface FlexboxResult {
  /** Ready-to-paste container declaration block */
  css: string;
  /** False when the input object is missing */
  valid: boolean;
}

const DIRECTIONS: FlexDirection[] = ["row", "row-reverse", "column", "column-reverse"];
const JUSTIFY_VALUES: JustifyContent[] = [
  "flex-start",
  "flex-end",
  "center",
  "space-between",
  "space-around",
  "space-evenly",
];
const ALIGN_VALUES: AlignItems[] = ["stretch", "flex-start", "flex-end", "center", "baseline"];
const WRAP_VALUES: FlexWrap[] = ["nowrap", "wrap", "wrap-reverse"];

function clampGap(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Build a CSS flex container declaration block from a set of flexbox
 * properties. Pure — no DOM, no side effects. Invalid input yields a
 * zero-value result rather than throwing.
 */
export function buildFlexboxCss(options: FlexboxOptions): FlexboxResult {
  if (!options || typeof options !== "object") {
    return { css: "", valid: false };
  }

  const direction = DIRECTIONS.includes(options.direction) ? options.direction : "row";
  const justify = JUSTIFY_VALUES.includes(options.justify) ? options.justify : "flex-start";
  const align = ALIGN_VALUES.includes(options.align) ? options.align : "stretch";
  const wrap = WRAP_VALUES.includes(options.wrap) ? options.wrap : "nowrap";
  const gap = clampGap(options.gap);

  const lines = [
    "display: flex;",
    `flex-direction: ${direction};`,
    `justify-content: ${justify};`,
    `align-items: ${align};`,
    `flex-wrap: ${wrap};`,
  ];
  if (gap > 0) lines.push(`gap: ${gap}px;`);

  return { css: lines.join("\n"), valid: true };
}
