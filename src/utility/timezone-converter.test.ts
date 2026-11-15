import { describe, expect, it } from "vitest";
import {
  COMMON_TIMEZONES,
  convertToZones,
  formatOffset,
  getLocalTimeZone,
  getZoneOffsetMinutes,
  getZoneWallFields,
  isValidTimeZone,
  prettyZoneName,
  zonedWallTimeToEpoch,
} from "./timezone-converter.js";

// Fixed instants (no real clock): 2024-07-04 12:00 UTC (northern summer) and 2024-01-15 12:00 UTC.
const JULY = Date.UTC(2024, 6, 4, 12, 0);
const JAN = Date.UTC(2024, 0, 15, 12, 0);

describe("isValidTimeZone / getLocalTimeZone / COMMON_TIMEZONES", () => {
  it("accepts IANA ids and rejects junk", () => {
    expect(isValidTimeZone("Europe/Minsk")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("every curated zone is valid on this runtime", () => {
    for (const z of COMMON_TIMEZONES) expect(isValidTimeZone(z.id)).toBe(true);
    expect(new Set(COMMON_TIMEZONES.map((z) => z.id)).size).toBe(COMMON_TIMEZONES.length);
  });

  it("returns some valid local zone", () => {
    expect(isValidTimeZone(getLocalTimeZone())).toBe(true);
  });
});

describe("getZoneOffsetMinutes", () => {
  it("knows DST and half/quarter-hour zones", () => {
    expect(getZoneOffsetMinutes("UTC", JULY)).toBe(0);
    expect(getZoneOffsetMinutes("America/New_York", JULY)).toBe(-240); // EDT
    expect(getZoneOffsetMinutes("America/New_York", JAN)).toBe(-300); // EST
    expect(getZoneOffsetMinutes("Europe/London", JULY)).toBe(60); // BST
    expect(getZoneOffsetMinutes("Europe/London", JAN)).toBe(0);
    expect(getZoneOffsetMinutes("Australia/Sydney", JULY)).toBe(600); // AEST (southern winter)
    expect(getZoneOffsetMinutes("Australia/Sydney", JAN)).toBe(660); // AEDT
    expect(getZoneOffsetMinutes("Asia/Kolkata", JULY)).toBe(330);
    expect(getZoneOffsetMinutes("Asia/Kathmandu", JULY)).toBe(345);
    expect(getZoneOffsetMinutes("America/St_Johns", JAN)).toBe(-210);
    expect(getZoneOffsetMinutes("Europe/Moscow", JULY)).toBe(180);
  });

  it("uses historical offsets (Moscow was UTC+4 in 2011–2014)", () => {
    expect(getZoneOffsetMinutes("Europe/Moscow", Date.UTC(2013, 6, 1))).toBe(240);
  });

  it("returns NaN for invalid zones or instants", () => {
    expect(getZoneOffsetMinutes("Nope/Nope", JULY)).toBeNaN();
    expect(getZoneOffsetMinutes("UTC", Number.NaN)).toBeNaN();
  });
});

describe("formatOffset", () => {
  it("formats signed hh:mm", () => {
    expect(formatOffset(0)).toBe("UTC+00:00");
    expect(formatOffset(120)).toBe("UTC+02:00");
    expect(formatOffset(-300)).toBe("UTC-05:00");
    expect(formatOffset(345)).toBe("UTC+05:45");
    expect(formatOffset(-210)).toBe("UTC-03:30");
    expect(formatOffset(840)).toBe("UTC+14:00");
    expect(formatOffset(Number.NaN)).toBe("");
  });
});

describe("zonedWallTimeToEpoch", () => {
  it("interprets a wall time in the given zone", () => {
    expect(zonedWallTimeToEpoch("2024-07-04", "08:00", "America/New_York")).toBe(JULY);
    // 15:00 in Moscow (UTC+3) = 12:00 UTC
    expect(zonedWallTimeToEpoch("2024-01-15", "15:00", "Europe/Moscow")).toBe(JAN);
    // 17:30 in Kolkata (UTC+5:30) = 12:00 UTC
    expect(zonedWallTimeToEpoch("2024-07-04", "17:30", "Asia/Kolkata")).toBe(JULY);
  });

  it("crosses the date line correctly", () => {
    // 2024-07-05 00:00 in Auckland (NZST +12) = 2024-07-04 12:00 UTC
    expect(zonedWallTimeToEpoch("2024-07-05", "00:00", "Pacific/Auckland")).toBe(JULY);
  });

  it("resolves the repeated hour of a DST fall-back to its first (summer-time) occurrence", () => {
    // 2024-11-03 01:30 happens twice in New York; EDT (UTC-4) -> 05:30 UTC
    expect(zonedWallTimeToEpoch("2024-11-03", "01:30", "America/New_York")).toBe(
      Date.UTC(2024, 10, 3, 5, 30),
    );
  });

  it("returns a nearby instant for a wall time skipped by spring-forward", () => {
    // 2024-03-10 02:30 does not exist in New York; any answer must be within an hour of 07:00 UTC
    const t = zonedWallTimeToEpoch("2024-03-10", "02:30", "America/New_York");
    expect(Math.abs(t - Date.UTC(2024, 2, 10, 7, 0))).toBeLessThanOrEqual(3_600_000);
  });

  it("returns NaN for malformed input or an invalid zone", () => {
    expect(zonedWallTimeToEpoch("", "08:00", "UTC")).toBeNaN();
    expect(zonedWallTimeToEpoch("2024-07-04", "", "UTC")).toBeNaN();
    expect(zonedWallTimeToEpoch("2024-07-04", "08:00", "Bad/Zone")).toBeNaN();
  });
});

describe("convertToZones", () => {
  it("returns [] for no zones or a bad instant", () => {
    expect(convertToZones(JULY, [])).toEqual([]);
    expect(convertToZones(Number.NaN, ["UTC"])).toEqual([]);
  });

  it("formats one instant across zones with offsets and day differences", () => {
    // 2024-07-04 20:00 UTC: New York 16:00 Thu, Tokyo 05:00 Fri (+1 day)
    const t = Date.UTC(2024, 6, 4, 20, 0);
    const [ny, tokyo, utc] = convertToZones(t, ["America/New_York", "Asia/Tokyo", "UTC"]);
    expect(ny).toEqual({
      timeZone: "America/New_York",
      time: "16:00",
      date: "Thu, Jul 4",
      offsetLabel: "UTC-04:00",
      offsetMinutes: -240,
      dayDiff: 0,
      isValid: true,
    });
    expect(tokyo).toMatchObject({
      time: "05:00",
      date: "Fri, Jul 5",
      offsetLabel: "UTC+09:00",
      dayDiff: 1,
    });
    expect(utc).toMatchObject({ time: "20:00", dayDiff: 0 });
  });

  it("uses an explicit reference zone for dayDiff", () => {
    // 2024-07-04 02:00 UTC is still Jul 3 in Los Angeles
    const t = Date.UTC(2024, 6, 4, 2, 0);
    const [la] = convertToZones(t, ["America/Los_Angeles"], { referenceTimeZone: "UTC" });
    expect(la.dayDiff).toBe(-1);
  });

  it("supports a 12-hour clock and other locales", () => {
    const [ny] = convertToZones(JULY, ["America/New_York"], { hour12: true });
    expect(ny.time).toMatch(/^08:00\sAM$/);
    const [msk] = convertToZones(JULY, ["Europe/Moscow"], { locale: "ru-RU" });
    expect(msk.time).toBe("15:00");
    expect(msk.date).toMatch(/4 июл/);
  });

  it("flags invalid zones instead of throwing", () => {
    const [bad, ok] = convertToZones(JULY, ["Nope/Nope", "UTC"]);
    expect(bad).toMatchObject({ timeZone: "Nope/Nope", isValid: false, time: "", dayDiff: 0 });
    expect(bad.offsetMinutes).toBeNaN();
    expect(ok.isValid).toBe(true);
  });
});

describe("getZoneWallFields / prettyZoneName", () => {
  it("returns HTML input values for a zone", () => {
    expect(getZoneWallFields("Asia/Tokyo", JULY)).toEqual({ date: "2024-07-04", time: "21:00" });
    expect(getZoneWallFields("Pacific/Honolulu", Date.UTC(2024, 0, 1, 5, 5))).toEqual({
      date: "2023-12-31",
      time: "19:05",
    });
  });

  it("falls back to UTC for invalid zones", () => {
    expect(getZoneWallFields("Bad/Zone", JULY)).toEqual({ date: "2024-07-04", time: "12:00" });
  });

  it("prettifies IANA ids", () => {
    expect(prettyZoneName("America/New_York")).toBe("America / New York");
    expect(prettyZoneName("America/Argentina/Buenos_Aires")).toBe(
      "America / Argentina / Buenos Aires",
    );
    expect(prettyZoneName("UTC")).toBe("UTC");
  });
});
