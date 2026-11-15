import { describe, expect, it } from "vitest";
import { formatBytes } from "./_bytes.js";

describe("formatBytes", () => {
  it("formats EN sizes", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 2.25, "en")).toBe("2.3 MB");
    expect(formatBytes(1024 * 1024 * 2.25, "en", { decimals: 2 })).toBe("2.25 MB");
    expect(formatBytes(1024 ** 3 * 3, "en")).toBe("3.0 GB");
  });

  it("formats RU sizes with a decimal comma and Russian units", () => {
    expect(formatBytes(512, "ru")).toBe("512 Б");
    expect(formatBytes(1536, "ru")).toBe("1,5 КБ");
    expect(formatBytes(1024 * 1024 * 2.25, "ru", { decimals: 2 })).toBe("2,25 МБ");
  });

  it("keeps the sign for savings and handles junk", () => {
    expect(formatBytes(-1536, "en")).toBe("-1.5 KB");
    expect(formatBytes(Number.NaN, "ru")).toBe("0 Б");
  });
});
