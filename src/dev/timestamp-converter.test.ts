import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromDateString, fromTimestamp, relativeParts } from "./timestamp-converter.js";

// "Now" is pinned so the relative labels are deterministic; all asserted fields are UTC-based,
// `local` is only checked for being non-empty because it depends on the machine's time zone.
const NOW = Date.UTC(2024, 0, 1, 0, 0, 0); // 2024-01-01T00:00:00Z = 1704067200

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("fromTimestamp", () => {
  it("converts seconds", () => {
    const r = fromTimestamp("1704067200");
    expect(r.valid).toBe(true);
    expect(r.timestampSec).toBe(1704067200);
    expect(r.timestampMs).toBe(1704067200000);
    expect(r.iso).toBe("2024-01-01T00:00:00.000Z");
    expect(r.utc).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
    expect(r.local).not.toBe("");
    expect(r.relative).toBe("0 seconds ago");
  });

  it("auto-detects milliseconds above 1e10", () => {
    const r = fromTimestamp("1704067200123");
    expect(r.timestampSec).toBe(1704067200);
    expect(r.timestampMs).toBe(1704067200123);
    expect(r.iso).toBe("2024-01-01T00:00:00.123Z");
    // exactly 1e10 is still seconds -> year 2286
    expect(fromTimestamp("10000000000").iso).toBe("2286-11-20T17:46:40.000Z");
  });

  it("handles the epoch and negative timestamps", () => {
    expect(fromTimestamp("0").iso).toBe("1970-01-01T00:00:00.000Z");
    expect(fromTimestamp("-86400").iso).toBe("1969-12-31T00:00:00.000Z");
  });

  it("builds relative labels in the past and future with singular/plural", () => {
    const s = NOW / 1000;
    expect(fromTimestamp(String(s - 1)).relative).toBe("1 second ago");
    expect(fromTimestamp(String(s - 90)).relative).toBe("1 minute ago");
    expect(fromTimestamp(String(s - 7200)).relative).toBe("2 hours ago");
    expect(fromTimestamp(String(s - 3 * 86400)).relative).toBe("3 days ago");
    expect(fromTimestamp(String(s - 60 * 86400)).relative).toBe("2 months ago");
    expect(fromTimestamp(String(s - 800 * 86400)).relative).toBe("2 years ago");
    expect(fromTimestamp(String(s + 3600)).relative).toBe("in 1 hour");
  });

  it("returns the invalid result for empty, non-numeric and out-of-range input", () => {
    for (const bad of ["", "   ", "abc", "12abc", "Infinity", "1e20"]) {
      const r = fromTimestamp(bad);
      expect(r.valid, bad).toBe(false);
      expect(r.iso).toBe("");
    }
  });
});

describe("fromDateString", () => {
  it("parses ISO strings with an explicit zone", () => {
    const r = fromDateString("2024-01-01T00:00:00Z");
    expect(r.valid).toBe(true);
    expect(r.timestampSec).toBe(1704067200);
    expect(r.timestampMs).toBe(1704067200000);
    // date-only ISO is UTC midnight per ECMAScript
    expect(fromDateString("2024-01-01").timestampSec).toBe(1704067200);
    expect(fromDateString("2024-01-01T03:00:00+03:00").timestampSec).toBe(1704067200);
  });

  it("returns the invalid result for empty and unparseable dates", () => {
    expect(fromDateString("").valid).toBe(false);
    expect(fromDateString("not a date").valid).toBe(false);
    expect(fromDateString("2024-13-45").valid).toBe(false);
  });
});

describe("relativeParts", () => {
  it("returns signed whole units for Intl.RelativeTimeFormat", () => {
    expect(relativeParts(NOW - 7200 * 1000, NOW)).toEqual({ value: -2, unit: "hour" });
    expect(relativeParts(NOW + 3 * 86400 * 1000, NOW)).toEqual({ value: 3, unit: "day" });
    expect(relativeParts(NOW, NOW)).toEqual({ value: 0, unit: "second" });
    expect(relativeParts(NOW - 400 * 86400 * 1000, NOW)).toEqual({ value: -1, unit: "year" });
  });

  it("is exposed on results", () => {
    const r = fromTimestamp(String(NOW / 1000 - 90));
    expect([r.relativeValue, r.relativeUnit]).toEqual([-1, "minute"]);
  });
});

describe("options", () => {
  it("formats `local` in the given locale and time zone", () => {
    const r = fromTimestamp("1704067200", { locale: "en-US", timeZone: "UTC" });
    expect(r.local).toBe("1/1/2024, 12:00:00 AM");
    const tokyo = fromDateString("2024-01-01T00:00:00Z", {
      locale: "en-GB",
      timeZone: "Asia/Tokyo",
    });
    expect(tokyo.local).toBe("01/01/2024, 09:00:00");
  });

  it("takes `now` as a number or a function for the relative fields", () => {
    const later = NOW + 3 * 3_600_000;
    expect(fromTimestamp("1704067200", { now: later }).relative).toBe("3 hours ago");
    expect(fromTimestamp("1704067200", { now: () => later }).relativeValue).toBe(-3);
    expect(fromDateString("2024-01-01T00:00:00Z", { now: NOW - 86_400_000 }).relative).toBe(
      "in 1 day",
    );
  });

  it("falls back to the host format for an invalid time zone", () => {
    expect(fromTimestamp("1704067200", { timeZone: "Bad/Zone" }).local).not.toBe("");
  });

  it("rejects non-string input without throwing", () => {
    expect(fromTimestamp(undefined as unknown as string).valid).toBe(false);
    expect(fromDateString(42 as unknown as string).valid).toBe(false);
    expect(fromTimestamp(1704067200 as unknown as string).timestampSec).toBe(1704067200);
  });
});
