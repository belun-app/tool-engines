/**
 * Human-readable file sizes in English or Russian notation: "1.5 MB" / "1,5 МБ", "512 B" / "512 Б".
 * Binary multiples (1 KB = 1024 B), the way operating systems show file sizes.
 * Pure and DOM-free: callers pass the page language.
 */
import { formatNumber, normalizeLang } from "./_num.js";

const UNITS: Record<"en" | "ru", readonly string[]> = {
  en: ["B", "KB", "MB", "GB", "TB"],
  ru: ["Б", "КБ", "МБ", "ГБ", "ТБ"],
};

export interface FormatBytesOptions {
  /** Fraction digits for KB and above (fixed, so sizes line up). Default 1. */
  decimals?: number;
}

export function formatBytes(
  bytes: number,
  lang: string | null | undefined,
  options: FormatBytesOptions = {},
): string {
  const units = UNITS[normalizeLang(lang)];
  // A plain space: sizes sit in short stat lines and specs match "1,5 КБ".
  const sp = " ";
  if (!Number.isFinite(bytes)) return `0${sp}${units[0]}`;
  const sign = bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${sign}${formatNumber(Math.round(abs), lang)}${sp}${units[0]}`;
  let value = abs / 1024;
  let unit = 1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const body = formatNumber(value, lang, { decimals: options.decimals ?? 1 });
  return `${sign}${body}${sp}${units[unit]}`;
}
