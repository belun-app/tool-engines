/**
 * Keyboard test logic: a full-size layout keyed by KeyboardEvent.code, key names, key-event
 * descriptions, test progress, key chatter detection and AltGr handling.
 */

export interface KeyDefinition {
  /** KeyboardEvent.code value this key reports */
  code: string;
  /** Short label printed on the virtual keycap */
  label: string;
  /** Width in keycap units, 1 = a standard letter key */
  width?: number;
  /** Height in rows (2 = the tall numpad + and Enter, the ISO Enter) */
  height?: number;
  /** Empty space before the key, in units (F-row groups, the lone ↑) */
  gap?: number;
  /** Which of a pair this is, so the untested list can say "Left Shift" */
  side?: "left" | "right";
  /** Numpad keys are listed as "Num 7" so they differ from the main row */
  numpad?: boolean;
  /** List name when the label is ambiguous in a comma-separated list ("," and ".") */
  name?: string;
}

export interface KeyRow {
  keys: KeyDefinition[];
}

export interface KeyboardSection {
  /** "main" | "nav" | "numpad" — lets the UI lay the three blocks out separately */
  id: string;
  /** Global row index of the section's first row (the numpad starts at the number row). */
  startRow?: number;
  rows: KeyRow[];
}

export type LayoutSize = "full" | "tkl" | "laptop";
export type LayoutStandard = "ansi" | "iso";
export type LayoutOs = "win" | "mac";

export interface LayoutOptions {
  size?: LayoutSize;
  standard?: LayoutStandard;
  os?: LayoutOs;
}

const k = (code: string, label: string, extra: Partial<KeyDefinition> = {}): KeyDefinition => ({
  code,
  label,
  ...extra,
});

const letters = (codes: string): KeyDefinition[] => codes.split("").map((c) => k(`Key${c}`, c));

function fRow(size: LayoutSize, os: LayoutOs): KeyRow {
  const f = (n: number, gap?: number) => k(`F${n}`, `F${n}`, gap ? { gap } : {});
  if (size === "laptop") {
    const fkeys = Array.from({ length: 12 }, (_, i) => f(i + 1));
    return os === "mac"
      ? { keys: [k("Escape", "Esc", { width: 1.5 }), ...fkeys] }
      : { keys: [k("Escape", "Esc"), ...fkeys, k("PrintScreen", "PrtSc"), k("Delete", "Del")] };
  }
  return {
    keys: [
      k("Escape", "Esc"),
      f(1, 1),
      f(2),
      f(3),
      f(4),
      f(5, 0.5),
      f(6),
      f(7),
      f(8),
      f(9, 0.5),
      f(10),
      f(11),
      f(12),
    ],
  };
}

function bottomRow(size: LayoutSize, os: LayoutOs): KeyRow {
  const mac = os === "mac";
  const ctrlL = k("ControlLeft", "Ctrl", { width: 1.25, side: "left" });
  const ctrlR = (w: number) => k("ControlRight", "Ctrl", { width: w, side: "right" });
  const metaL = k("MetaLeft", mac ? "Cmd" : "Win", { width: 1.25, side: "left" });
  const metaR = (w: number) => k("MetaRight", mac ? "Cmd" : "Win", { width: w, side: "right" });
  const altL = k("AltLeft", mac ? "Opt" : "Alt", { width: 1.25, side: "left" });
  const altR = (w: number) => k("AltRight", mac ? "Opt" : "Alt", { width: w, side: "right" });
  const space = (w: number) => k("Space", "Space", { width: w });

  if (size === "laptop") {
    const arrows = [k("ArrowLeft", "←"), k("ArrowDown", "↓"), k("ArrowRight", "→")];
    return mac
      ? { keys: [ctrlL, altL, metaL, space(6.25), metaR(1), altR(1), ...arrows] }
      : { keys: [ctrlL, metaL, altL, space(6.25), altR(1), ctrlR(1), ...arrows] };
  }
  return mac
    ? { keys: [ctrlL, altL, metaL, space(7.5), metaR(1.25), altR(1.25), ctrlR(1.25)] }
    : {
        keys: [
          ctrlL,
          metaL,
          altL,
          space(6.25),
          altR(1.25),
          metaR(1.25),
          k("ContextMenu", "Menu", { width: 1.25 }),
          ctrlR(1.25),
        ],
      };
}

function mainSection(size: LayoutSize, standard: LayoutStandard, os: LayoutOs): KeyboardSection {
  const iso = standard === "iso";
  const laptop = size === "laptop";
  const numberRow: KeyRow = {
    keys: [
      k("Backquote", "`"),
      ...Array.from({ length: 9 }, (_, i) => k(`Digit${i + 1}`, String(i + 1))),
      k("Digit0", "0"),
      k("Minus", "-"),
      k("Equal", "="),
      k("Backspace", "Backspace", { width: 2 }),
    ],
  };
  // ISO: a tall Enter spans the Q and A rows, the Backslash key moves next to it
  // on the A row, and a short left Shift makes room for IntlBackslash.
  const qRow: KeyRow = {
    keys: [
      k("Tab", "Tab", { width: 1.5 }),
      ...letters("QWERTYUIOP"),
      k("BracketLeft", "["),
      k("BracketRight", "]"),
      iso ? k("Enter", "Enter", { width: 1.5, height: 2 }) : k("Backslash", "\\", { width: 1.5 }),
    ],
  };
  const aRow: KeyRow = {
    keys: iso
      ? [
          k("CapsLock", "Caps", { width: 1.5 }),
          ...letters("ASDFGHJKL"),
          k("Semicolon", ";"),
          k("Quote", "'"),
          k("Backslash", "\\"),
        ]
      : [
          k("CapsLock", "Caps", { width: 1.75 }),
          ...letters("ASDFGHJKL"),
          k("Semicolon", ";"),
          k("Quote", "'"),
          k("Enter", "Enter", { width: 2.25 }),
        ],
  };
  const zTail = [
    ...letters("ZXCVBNM"),
    k("Comma", ",", { name: "Comma" }),
    k("Period", ".", { name: "Period" }),
    k("Slash", "/"),
  ];
  const shiftL = (w: number) => k("ShiftLeft", "Shift", { width: w, side: "left" });
  const shiftR = (w: number) => k("ShiftRight", "Shift", { width: w, side: "right" });
  const zRow: KeyRow = {
    keys: [
      ...(iso ? [shiftL(1.25), k("IntlBackslash", "\\", { name: "\\ (ISO)" })] : [shiftL(2.25)]),
      ...zTail,
      ...(laptop ? [shiftR(1.75), k("ArrowUp", "↑")] : [shiftR(2.75)]),
    ],
  };
  return {
    id: "main",
    rows: [fRow(size, os), numberRow, qRow, aRow, zRow, bottomRow(size, os)],
  };
}

function navSection(os: LayoutOs): KeyboardSection {
  const mac = os === "mac";
  return {
    id: "nav",
    rows: [
      {
        // Apple's extended keyboard has F13–F15 where a PC has PrtSc, ScrLk, Pause.
        keys: mac
          ? [k("F13", "F13"), k("F14", "F14"), k("F15", "F15")]
          : [k("PrintScreen", "PrtSc"), k("ScrollLock", "ScrLk"), k("Pause", "Pause")],
      },
      {
        // Apple's fn key sits where Insert is and sends no key event at all.
        keys: mac
          ? [k("Home", "Home", { gap: 1 }), k("PageUp", "PgUp")]
          : [k("Insert", "Ins"), k("Home", "Home"), k("PageUp", "PgUp")],
      },
      { keys: [k("Delete", "Del"), k("End", "End"), k("PageDown", "PgDn")] },
      { keys: [] },
      { keys: [k("ArrowUp", "↑", { gap: 1 })] },
      { keys: [k("ArrowLeft", "←"), k("ArrowDown", "↓"), k("ArrowRight", "→")] },
    ],
  };
}

function numpadSection(os: LayoutOs): KeyboardSection {
  const n = (code: string, label: string, extra: Partial<KeyDefinition> = {}) =>
    k(code, label, { numpad: true, ...extra });
  return {
    id: "numpad",
    startRow: 1,
    rows: [
      {
        keys: [
          os === "mac" ? k("NumLock", "Clear") : k("NumLock", "Num", { name: "Num Lock" }),
          n("NumpadDivide", "/"),
          n("NumpadMultiply", "*"),
          n("NumpadSubtract", "-"),
        ],
      },
      {
        keys: [
          n("Numpad7", "7"),
          n("Numpad8", "8"),
          n("Numpad9", "9"),
          n("NumpadAdd", "+", { height: 2 }),
        ],
      },
      { keys: [n("Numpad4", "4"), n("Numpad5", "5"), n("Numpad6", "6")] },
      {
        keys: [
          n("Numpad1", "1"),
          n("Numpad2", "2"),
          n("Numpad3", "3"),
          n("NumpadEnter", "Enter", { height: 2 }),
        ],
      },
      { keys: [n("Numpad0", "0", { width: 2 }), n("NumpadDecimal", ".")] },
    ],
  };
}

/** Build a layout: full-size (104 on ANSI Windows), tenkeyless or laptop; ANSI or ISO; Windows or Mac. */
export function buildLayout(options: LayoutOptions = {}): KeyboardSection[] {
  const size = options.size ?? "full";
  const standard = options.standard ?? "ansi";
  const os = options.os ?? "win";
  const sections = [mainSection(size, standard, os)];
  if (size !== "laptop") sections.push(navSection(os));
  if (size === "full") sections.push(numpadSection(os));
  return sections;
}

/** ANSI 104-key Windows layout, split into the main block, the navigation cluster, and the numpad. */
export const KEYBOARD_LAYOUT: KeyboardSection[] = buildLayout();

/** Every code in the layout, in reading order. */
export function allKeyCodes(layout: KeyboardSection[] = KEYBOARD_LAYOUT): string[] {
  const codes: string[] = [];
  for (const section of layout) {
    for (const row of section.rows) {
      for (const key of row.keys) codes.push(key.code);
    }
  }
  return codes;
}

/** Look up a layout key by its KeyboardEvent.code. Returns null for codes not on the layout. */
export function findKey(
  code: string,
  layout: KeyboardSection[] = KEYBOARD_LAYOUT,
): KeyDefinition | null {
  if (!code) return null;
  for (const section of layout) {
    for (const row of section.rows) {
      for (const key of row.keys) {
        if (key.code === code) return key;
      }
    }
  }
  return null;
}

export interface PlacedKey extends KeyDefinition {
  section: string;
  /** Position and size in key units */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Scale of the key's section (the stacked phone layout draws nav and numpad larger) */
  scale: number;
}

export interface PlacedLayout {
  keys: PlacedKey[];
  /** Board size in key units */
  width: number;
  height: number;
}

/** Gap between the F-row and the number row, and between blocks, in units. */
const ROW_GAP = 0.25;
const BLOCK_GAP = 0.5;

/**
 * Real key geometry: every key gets x/y/width/height in key units, so the UI can draw
 * a proportional keyboard (Backspace 2u, Space 6.25u, ↑ above ↓, tall numpad keys).
 *
 * `stacked` (narrow screens): the navigation cluster and the numpad go under the main
 * block, drawn `lowerScale` times larger so their keys stay legible.
 */
export function placeKeys(
  layout: KeyboardSection[] = KEYBOARD_LAYOUT,
  options: { stacked?: boolean; lowerScale?: number } = {},
): PlacedLayout {
  const rowY = (r: number) => (r === 0 ? 0 : r + ROW_GAP);
  const keys: PlacedKey[] = [];
  const sectionWidth = (s: KeyboardSection) =>
    Math.max(
      0,
      ...s.rows.map((row) => row.keys.reduce((n, key) => n + (key.gap ?? 0) + (key.width ?? 1), 0)),
    );
  const sectionHeight = (s: KeyboardSection) => rowY((s.startRow ?? 0) + s.rows.length - 1) + 1;

  const main = layout.find((s) => s.id === "main");
  const others = layout.filter((s) => s.id !== "main");
  const mainW = main ? sectionWidth(main) : 0;
  const mainH = main ? sectionHeight(main) : 0;
  const stacked = Boolean(options.stacked) && others.length > 0;
  const scale = stacked ? (options.lowerScale ?? 1.5) : 1;

  const place = (s: KeyboardSection, ox: number, oy: number, sc: number) => {
    s.rows.forEach((row, i) => {
      let x = 0;
      const y = rowY((s.startRow ?? 0) + i);
      for (const key of row.keys) {
        x += key.gap ?? 0;
        const w = key.width ?? 1;
        const h = key.height ?? 1;
        // A tall key covers the row gap it spans, so it lines up with its neighbours.
        const span = h > 1 ? rowY((s.startRow ?? 0) + i + h - 1) + 1 - y : 1;
        keys.push({
          ...key,
          section: s.id,
          x: ox + x * sc,
          y: oy + y * sc,
          w: w * sc,
          h: span * sc,
          scale: sc,
        });
        x += w;
      }
    });
  };

  if (main) place(main, 0, 0, 1);
  let width = mainW;
  let height = mainH;
  if (stacked) {
    let x = 0;
    const oy = mainH + BLOCK_GAP;
    let lowerH = 0;
    for (const s of others) {
      place(s, x, oy, scale);
      x += (sectionWidth(s) + BLOCK_GAP) * scale;
      lowerH = Math.max(lowerH, sectionHeight(s) * scale);
    }
    width = Math.max(width, x - BLOCK_GAP * scale);
    height = oy + lowerH;
  } else {
    let x = mainW;
    for (const s of others) {
      x += BLOCK_GAP;
      place(s, x, 0, 1);
      x += sectionWidth(s);
      height = Math.max(height, sectionHeight(s));
    }
    width = x;
  }
  return { keys, width, height };
}

/** Words used to build unique key names for the untested list. */
export interface KeyNameWords {
  left: string;
  right: string;
  num: string;
  /** Overrides by code, e.g. { Comma: "Comma" } */
  names: Record<string, string>;
}

export const EN_KEY_WORDS: KeyNameWords = {
  left: "Left",
  right: "Right",
  num: "Num",
  names: {},
};

/**
 * A name that tells duplicate keys apart: "Left Shift" vs "Right Shift", "Num 7" vs
 * "7", "Comma" instead of a bare "," inside a comma-separated list.
 */
export function keyName(key: KeyDefinition, words: KeyNameWords = EN_KEY_WORDS): string {
  const override = words.names[key.code];
  if (override) return override;
  if (key.side) return `${key.side === "left" ? words.left : words.right} ${key.label}`;
  if (key.numpad) return `${words.num} ${key.label}`;
  return key.name ?? key.label;
}

export interface KeyEventInput {
  code?: string;
  key?: string;
  keyCode?: number;
  location?: number;
}

export interface KeyEventInfo {
  /** KeyboardEvent.code, e.g. "KeyA" */
  code: string;
  /** Printable value produced, e.g. "a"; control keys get a readable name */
  key: string;
  /** Legacy numeric keyCode, 0 when unknown */
  keyCode: number;
  /** "Standard" | "Left" | "Right" | "Numpad" (English; prefer `locationIndex` for UI text) */
  location: string;
  /** KeyboardEvent.location as 0–3; the page maps it to its own words */
  locationIndex: number;
  /** True when the code appears on the virtual keyboard layout */
  onLayout: boolean;
}

const LOCATIONS = ["Standard", "Left", "Right", "Numpad"];

const EMPTY_EVENT: KeyEventInfo = {
  code: "",
  key: "",
  keyCode: 0,
  location: "Standard",
  locationIndex: 0,
  onLayout: false,
};

/** Turn a raw keydown into the values shown in the readout panel. */
export function describeKeyEvent(
  input: KeyEventInput,
  layout: KeyboardSection[] = KEYBOARD_LAYOUT,
): KeyEventInfo {
  if (!input || (!input.code && !input.key)) return { ...EMPTY_EVENT };

  const code = input.code ?? "";
  const rawKey = input.key ?? "";
  const key = rawKey === " " ? "Space" : rawKey;
  const index = input.location ?? 0;
  const locationIndex = index >= 0 && index < LOCATIONS.length ? index : 0;

  return {
    code,
    key,
    keyCode: input.keyCode && input.keyCode > 0 ? input.keyCode : 0,
    location: LOCATIONS[locationIndex],
    locationIndex,
    onLayout: findKey(code, layout) !== null,
  };
}

export interface KeyboardProgress {
  /** How many layout keys have registered at least one press */
  tested: number;
  /** Total keys on the layout */
  total: number;
  /** Percentage of the layout covered, 0–100 */
  percent: number;
  /** Unique names of layout keys not yet pressed, in reading order */
  remaining: string[];
  /** Codes of layout keys not yet pressed, in reading order */
  remainingCodes: string[];
  /** True once every layout key has been pressed */
  complete: boolean;
}

/** Report how much of the layout has been covered so far. */
export function summarizeProgress(
  pressedCodes: Iterable<string>,
  layout: KeyboardSection[] = KEYBOARD_LAYOUT,
  words: KeyNameWords = EN_KEY_WORDS,
): KeyboardProgress {
  const pressed = new Set(pressedCodes ?? []);
  const remaining: string[] = [];
  const remainingCodes: string[] = [];
  let tested = 0;
  let total = 0;

  for (const section of layout) {
    for (const row of section.rows) {
      for (const key of row.keys) {
        total++;
        if (pressed.has(key.code)) tested++;
        else {
          remaining.push(keyName(key, words));
          remainingCodes.push(key.code);
        }
      }
    }
  }

  return {
    tested,
    total,
    percent: total > 0 ? Math.round((tested / total) * 100) : 0,
    remaining,
    remainingCodes,
    complete: total > 0 && tested === total,
  };
}

/**
 * Chatter (switch bounce): a fresh keydown of the same key that comes less than
 * `thresholdMs` after its keyup. Auto-repeat (`repeat`) is never chatter, and a
 * key with no earlier keyup cannot chatter.
 */
export function isChatter(
  lastUpAt: number | undefined,
  downAt: number,
  thresholdMs: number,
  repeat = false,
): boolean {
  if (repeat || lastUpAt === undefined || !Number.isFinite(lastUpAt)) return false;
  const gap = downAt - lastUpAt;
  return gap >= 0 && gap < thresholdMs;
}

/**
 * How far apart (ms) the two keydowns of one AltGr press may be. Windows sends a
 * synthetic Left Ctrl keydown and then the Right Alt keydown with the same timeStamp.
 */
export const ALTGR_PAIR_MS = 3;

interface KeyStamp {
  code: string;
  timeStamp: number;
}

/**
 * True when `ctrl` is the fake Left Ctrl Windows sends in front of AltGr (Right Alt on
 * German, French, Polish… layouts): a ControlLeft keydown immediately followed by an
 * AltRight keydown with the same (or near) timeStamp. That Left Ctrl was never pressed.
 */
export function isAltGrPair(ctrl: KeyStamp, next: KeyStamp): boolean {
  if (ctrl.code !== "ControlLeft" || next.code !== "AltRight") return false;
  const gap = next.timeStamp - ctrl.timeStamp;
  return Number.isFinite(gap) && gap >= 0 && gap <= ALTGR_PAIR_MS;
}

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/** True for Shift, Ctrl, Alt and Win/Cmd on either side. */
export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

/**
 * Keys still held after a keyup. macOS sends no keyup for keys released while Cmd is
 * down, so releasing Cmd also releases every non-modifier key; otherwise only the
 * released key goes.
 */
export function releaseKey(held: Iterable<string>, code: string): string[] {
  const rest = [...held].filter((c) => c !== code);
  if (code === "MetaLeft" || code === "MetaRight") return rest.filter(isModifierCode);
  return rest;
}
