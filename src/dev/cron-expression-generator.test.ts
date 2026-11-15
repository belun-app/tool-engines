import { describe, expect, it } from "vitest";
import { describeCron } from "./cron-expression-generator.js";

// Next runs are computed and formatted in local time; "now" is built with the local
// Date constructor in January (no DST transitions) so the assertions hold in any TZ.
const NOW = new Date(2024, 0, 1, 10, 30, 15); // Monday 1 Jan 2024, 10:30:15 local

describe("describeCron — descriptions (EN)", () => {
  it.each([
    ["* * * * *", "Every minute."],
    ["*/15 * * * *", "Every 15 minutes."],
    ["0 9 * * 1-5", "At 09:00, on Monday through Friday."],
    ["30 8,17 * * *", "At 08:30 and 17:30."],
    ["0 */2 * * *", "At minute 0 past every 2 hours."],
    ["15 * * * *", "At minute 15 past every hour."],
    ["* 9 * * *", "Every minute past hour 9."],
    ["*/5 9-17 * * *", "Every 5 minutes past hours 9 through 17."],
    ["* */3 * * *", "Every minute, every 3 hours."],
    ["0 0 1 * *", "At 00:00, on day 1 of the month."],
    ["0 0 1,15 * *", "At 00:00, on days 1 and 15 of the month."],
    ["0 0 */2 * *", "At 00:00, on every 2 days of the month."],
    ["0 12 1 1 *", "At 12:00, on day 1 of the month, in January."],
    ["0 0 * 6-8 *", "At 00:00, in June through August."],
    ["0 0 * */3 *", "At 00:00, every 3 months."],
    ["0 0 13 * 5", "At 00:00, on day 13 of the month or on Friday."],
    ["0 0 * * 0,6", "At 00:00, on Sunday and Saturday."],
    // 7 is an alias for Sunday
    ["0 0 * * 7", "At 00:00, on Sunday."],
    ["0 0 * JAN,MAR mon", "At 00:00, on Monday, in January and March."],
  ])("%s -> %s", (expr, description) => {
    const r = describeCron(expr, "en", NOW);
    expect(r.valid).toBe(true);
    expect(r.error).toBe("");
    expect(r.description).toBe(description);
  });

  it("falls back to a per-hour phrase when there are more than 12 times", () => {
    expect(describeCron("0,30 0-6 * * *", "en", NOW).description).toBe(
      "At minutes 0 and 30 past hours 0 through 6.",
    );
  });

  it("expands macros and collapses whitespace", () => {
    expect(describeCron("@daily", "en", NOW).expression).toBe("0 0 * * *");
    expect(describeCron("@WEEKLY", "en", NOW).description).toBe("At 00:00, on Sunday.");
    expect(describeCron("@yearly", "en", NOW).expression).toBe("0 0 1 1 *");
    expect(describeCron("  0   9 *  * 1 ", "en", NOW).expression).toBe("0 9 * * 1");
    const reboot = describeCron("@reboot", "en", NOW);
    expect(reboot.valid).toBe(true);
    expect(reboot.nextRuns).toEqual([]);
  });

  it("exposes the five raw fields", () => {
    expect(describeCron("1 2 3 4 5", "en", NOW).fields).toEqual({
      minute: "1",
      hour: "2",
      dayOfMonth: "3",
      month: "4",
      dayOfWeek: "5",
    });
  });
});

describe("describeCron — next runs", () => {
  it("lists the next five weekday 09:00 runs", () => {
    expect(describeCron("0 9 * * 1-5", "en", NOW).nextRuns).toEqual([
      "Tue, 2 Jan 2024, 09:00",
      "Wed, 3 Jan 2024, 09:00",
      "Thu, 4 Jan 2024, 09:00",
      "Fri, 5 Jan 2024, 09:00",
      "Mon, 8 Jan 2024, 09:00",
    ]);
  });

  it("starts from the next whole minute", () => {
    expect(describeCron("* * * * *", "en", NOW).nextRuns.slice(0, 2)).toEqual([
      "Mon, 1 Jan 2024, 10:31",
      "Mon, 1 Jan 2024, 10:32",
    ]);
  });

  it("uses OR semantics when both day fields are restricted", () => {
    // day 13 OR Friday, starting Mon 1 Jan 2024: Fri 5, Fri 12, Sat 13, Fri 19, Fri 26
    expect(describeCron("0 0 13 * 5", "en", NOW).nextRuns).toEqual([
      "Fri, 5 Jan 2024, 00:00",
      "Fri, 12 Jan 2024, 00:00",
      "Sat, 13 Jan 2024, 00:00",
      "Fri, 19 Jan 2024, 00:00",
      "Fri, 26 Jan 2024, 00:00",
    ]);
  });

  it("finds 29 February in a leap year", () => {
    expect(describeCron("0 0 29 2 *", "en", NOW).nextRuns[0]).toBe("Thu, 29 Feb 2024, 00:00");
  });

  it("returns no runs (and does not hang) for an impossible date", () => {
    const r = describeCron("0 0 30 2 *", "en", NOW);
    expect(r.valid).toBe(true);
    expect(r.nextRuns).toEqual([]);
  });
});

describe("describeCron — errors", () => {
  it("returns an invalid result without error for blank input", () => {
    expect(describeCron("   ", "en", NOW)).toMatchObject({ valid: false, error: "" });
  });

  it("requires exactly five fields", () => {
    expect(describeCron("* * * *", "en", NOW).error).toBe(
      "A cron expression needs exactly 5 fields: minute hour day month weekday.",
    );
    expect(describeCron("0 0 * * * *", "en", NOW).valid).toBe(false);
  });

  it.each([
    ["60 * * * *", "60"],
    ["* 24 * * *", "24"],
    ["* * 0 * *", "0"],
    ["* * * 13 *", "13"],
    ["* * * * 8", "8"],
    ["*/0 * * * *", "*/0"],
    ["5-1 * * * *", "5-1"],
    ["a * * * *", "a"],
  ])("rejects %s", (expr, token) => {
    const r = describeCron(expr, "en", NOW);
    expect(r.valid).toBe(false);
    expect(r.error).toBe(`Invalid value: "${token}". Check the allowed range for that field.`);
  });
});

describe("describeCron — empty list items", () => {
  it("rejects empty items in a comma list", () => {
    expect(describeCron("1,,2 * * * *", "en", NOW).valid).toBe(false);
  });
});

describe("describeCron — Russian", () => {
  it("describes schedules with correct plural forms", () => {
    expect(describeCron("*/5 * * * *", "ru", NOW).description).toBe("Каждые 5 минут.");
    expect(describeCron("*/2 * * * *", "ru", NOW).description).toBe("Каждые 2 минуты.");
    expect(describeCron("*/21 * * * *", "ru", NOW).description).toBe("Каждые 21 минуту.");
    expect(describeCron("0 9 * * 1-5", "ru", NOW).description).toBe(
      "В 09:00, с понедельника по пятницу.",
    );
    expect(describeCron("0 0 1 * *", "ru", NOW).description).toBe("В 00:00, 1-го числа месяца.");
    expect(describeCron("0 0 * 6-8 *", "ru", NOW).description).toBe("В 00:00, с июня по август.");
    expect(describeCron("0 0 * * 6", "ru", NOW).description).toBe("В 00:00, по субботам.");
  });

  it("formats next runs and errors in Russian", () => {
    const r = describeCron("0 9 * * 1-5", "ru", NOW);
    expect(r.nextRuns[0]).toBe("вт, 2 янв 2024, 09:00");
    expect(describeCron("* *", "ru", NOW).error).toMatch(/ровно 5 полей/);
    expect(describeCron("99 * * * *", "ru", NOW).error).toBe(
      "Недопустимое значение: «99». Проверьте допустимый диапазон поля.",
    );
  });
});
