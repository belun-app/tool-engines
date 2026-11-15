/**
 * Geometry, fair winner selection and share-link encoding for a spinning prize wheel.
 *
 * Angle convention matches the canvas 2D context: 0 rad points right (3 o'clock) and
 * angles grow clockwise, because the y axis points down. The pointer sits at the top of
 * the wheel, which is -PI/2 in that convention.
 */
import { type RandomSource, randomFloat, randomInt } from "../_random.js";

export const POINTER_ANGLE = (3 * Math.PI) / 2;

const TAU = Math.PI * 2;

/** Hard caps so a pasted novel cannot lock up the renderer. */
export const MAX_ENTRIES = 500;
export const MAX_LABEL_LENGTH = 120;

export interface WheelSegment {
  /** Position in the entry list. */
  index: number;
  label: string;
  /** Start of the slice before rotation, in radians. */
  startAngle: number;
  endAngle: number;
  /** Centre of the slice — where the label is drawn. */
  midAngle: number;
  /** Fill colour taken from the palette, cycling if there are more slices than colours. */
  color: string;
  /** Black or white, whichever reads better on `color`. */
  textColor: string;
}

export interface WheelSpin {
  winnerIndex: number;
  winner: string;
  /**
   * Absolute rotation to animate to, in radians. Always larger than `from`, so the
   * wheel keeps turning the same way on every spin instead of unwinding.
   */
  rotation: number;
  /** How long the caller should animate the deceleration. */
  durationMs: number;
}

export interface SpinOptions {
  /** Current rotation of the wheel, in radians. */
  from?: number;
  /** Full turns before the wheel settles. */
  turns?: number;
  /** Force a winner — used by the share-link tests and by replaying a history entry. */
  winnerIndex?: number;
  /** Source of random 32-bit words; defaults to `crypto.getRandomValues` (see `_random`). */
  rng?: RandomSource;
}

export interface HistoryTally {
  label: string;
  count: number;
  /** Share of all spins, 0–100, rounded to one decimal. */
  percent: number;
}

/** Six hand-picked fills that stay legible against both the light and dark page. */
export const DEFAULT_PALETTE = ["#0f766e", "#b45309", "#1d4ed8", "#be123c", "#4d7c0f", "#7e22ce"];

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

const mod = (value: number, size: number) => ((value % size) + size) % size;

/** Split pasted text into one trimmed, non-empty entry per line. */
export function parseEntries(text: string): string[] {
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().slice(0, MAX_LABEL_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_ENTRIES);
}

/** Expand `#abc` to `#aabbcc` and lowercase it; returns null for anything else. */
export function normaliseColor(value: string): string | null {
  if (typeof value !== "string") return null;
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) return null;
  const hex = match[1].toLowerCase();
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex}`;
}

/** Read a comma-, space- or newline-separated list of hex colours, ignoring junk. */
export function parsePalette(text: string): string[] {
  if (typeof text !== "string") return [];
  return text
    .split(/[\s,;]+/)
    .map(normaliseColor)
    .filter((c): c is string => c !== null);
}

/**
 * Pick black or white text for a background colour using the WCAG relative-luminance
 * formula, so a yellow slice gets dark text and a navy slice gets light text.
 */
export function textColorFor(background: string): string {
  const hex = normaliseColor(background) ?? "#000000";
  const channel = (offset: number) => {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.36 ? "#18181b" : "#ffffff";
}

/** Slice the circle into equal wedges, one per entry, and assign palette colours. */
export function buildSegments(entries: string[], palette: string[] = []): WheelSegment[] {
  const list = parseEntries(entries.join("\n"));
  if (list.length === 0) return [];

  const colors = palette.length > 0 ? palette : DEFAULT_PALETTE;
  const step = TAU / list.length;

  return list.map((label, index) => {
    // With an even palette and an odd slice count the first and last slice would touch
    // in the same colour, so the last one is nudged to the next hue.
    let colorIndex = index % colors.length;
    if (
      list.length > 1 &&
      index === list.length - 1 &&
      colorIndex === 0 &&
      colors.length > 1 &&
      list.length % colors.length === 1
    ) {
      colorIndex = 1 % colors.length;
    }
    const color = colors[colorIndex];
    return {
      index,
      label,
      startAngle: index * step,
      endAngle: (index + 1) * step,
      midAngle: (index + 0.5) * step,
      color,
      textColor: textColorFor(color),
    };
  });
}

/**
 * Choose the winner first, then work out the rotation that parks it under the pointer.
 * Doing it in that order is what makes the wheel honest: the outcome comes from
 * crypto.getRandomValues, and the animation is only a way of showing it. Deciding the
 * winner from a random spin velocity instead would bias the result towards whichever
 * slice the physics happens to favour.
 * @throws SecureRandomUnavailableError without Web Crypto and without `options.rng`.
 */
export function spinWheel(entries: string[], options: SpinOptions = {}): WheelSpin | null {
  const list = parseEntries(entries.join("\n"));
  if (list.length === 0) return null;

  const rawFrom = options.from ?? 0;
  const from = Number.isFinite(rawFrom) ? rawFrom : 0;
  const rawTurns = options.turns ?? 6;
  const turns = Number.isFinite(rawTurns) ? Math.max(1, Math.floor(rawTurns)) : 6;

  const forced = options.winnerIndex ?? -1;
  const winnerIndex =
    Number.isInteger(forced) && forced >= 0 && forced < list.length
      ? forced
      : randomInt(list.length, options.rng);

  const step = TAU / list.length;
  // Land off-centre so the needle does not stop dead on the midpoint every time, but
  // stay well clear of the slice borders where the winner would look ambiguous.
  const jitter = (randomFloat(options.rng) - 0.5) * step * 0.7;
  const target = POINTER_ANGLE - (winnerIndex + 0.5) * step - jitter;
  const delta = mod(target - from, TAU);

  return {
    winnerIndex,
    winner: list[winnerIndex],
    rotation: from + turns * TAU + delta,
    durationMs: 4200 + Math.round(randomFloat(options.rng) * 600),
  };
}

/**
 * Which slice sits under the pointer at a given rotation. The inverse of `spinWheel`,
 * and the cheapest way to confirm the animation agrees with the drawn result.
 */
export function segmentAtPointer(rotation: number, count: number): number {
  if (!Number.isFinite(rotation) || !Number.isInteger(count) || count < 1) return -1;
  const step = TAU / count;
  const local = mod(POINTER_ANGLE - rotation, TAU);
  return Math.min(count - 1, Math.floor(local / step));
}

/**
 * Count how often each label has won, most frequent first; ties in label order, compared
 * with `Intl.Collator(locale)` (the host default when `locale` is omitted).
 */
export function tallyHistory(history: string[], locale?: string | string[]): HistoryTally[] {
  const list = Array.isArray(history) ? history.filter((h) => typeof h === "string" && h) : [];
  if (list.length === 0) return [];

  let compare: (a: string, b: string) => number;
  try {
    compare = new Intl.Collator(locale).compare;
  } catch {
    compare = new Intl.Collator().compare;
  }
  const counts = new Map<string, number>();
  for (const label of list) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / list.length) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count || compare(a.label, b.label));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Pack the entry list into a URL-safe string so a wheel can be shared as a link
 * without storing anything on a server. UTF-8 first, then base64url — a plain
 * `btoa` would throw on the first Cyrillic or emoji entry.
 */
export function encodeWheel(entries: string[]): string {
  const list = parseEntries(entries.join("\n"));
  if (list.length === 0) return "";
  return toBase64Url(new TextEncoder().encode(list.join("\n")));
}

/** Read back an `encodeWheel` string; anything malformed yields an empty list. */
export function decodeWheel(value: string): string[] {
  if (typeof value !== "string" || !value) return [];
  const bytes = fromBase64Url(value);
  if (!bytes) return [];
  try {
    // `fatal` so a base64 string that is not valid UTF-8 returns an empty wheel instead
    // of a list full of replacement characters.
    return parseEntries(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return [];
  }
}
