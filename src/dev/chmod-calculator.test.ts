import { describe, expect, it } from "vitest";
import { calculateChmod, describeChmod, parseNumeric, parseSymbolic } from "./chmod-calculator.js";

describe("calculateChmod — numeric input", () => {
  it("describes 755", () => {
    const r = calculateChmod("755");
    expect(r).toMatchObject({
      numeric: "755",
      numericFull: "0755",
      symbolic: "rwxr-xr-x",
      ls: "-rwxr-xr-x",
      command: "chmod 755 file",
      isValid: true,
    });
    expect(r.explanation).toEqual([
      "Owner (user): read, write and execute.",
      "Group: read and execute.",
      "Others: read and execute.",
    ]);
  });

  it("handles common modes (644, 600, 777, 000) and a leading zero", () => {
    expect(calculateChmod("644").symbolic).toBe("rw-r--r--");
    expect(calculateChmod("600").explanation[2]).toBe("Others: no access.");
    expect(calculateChmod("777").symbolic).toBe("rwxrwxrwx");
    expect(calculateChmod("000").symbolic).toBe("---------");
    expect(calculateChmod("0644").numeric).toBe("644");
    // single permission
    expect(calculateChmod("400").explanation[0]).toBe("Owner (user): read.");
  });

  it("renders special bits with s/S/t/T", () => {
    // setuid + owner x -> s ; setgid without group x -> S ; sticky + others x -> t
    expect(calculateChmod("4755").symbolic).toBe("rwsr-xr-x");
    expect(calculateChmod("4755").numeric).toBe("4755");
    expect(calculateChmod("2745").symbolic).toBe("rwxr-Sr-x");
    expect(calculateChmod("1777").symbolic).toBe("rwxrwxrwt");
    expect(calculateChmod("1776").symbolic).toBe("rwxrwxrwT");
    const all = calculateChmod("7777");
    expect(all.symbolic).toBe("rwsrwsrwt");
    expect(all.explanation).toHaveLength(6);
  });
});

describe("calculateChmod — symbolic input", () => {
  it("parses 9- and 10-character forms with a file-type prefix", () => {
    expect(calculateChmod("rwxr-xr-x").numeric).toBe("755");
    expect(calculateChmod("drwxr-x---").numeric).toBe("750");
    expect(calculateChmod("-rwsr-xr-t").numeric).toBe("5755");
    expect(calculateChmod("rwSr--r--").numeric).toBe("4644");
  });

  it("round-trips every numeric mode through the symbolic form", () => {
    for (let mode = 0; mode < 0o10000; mode += 0o111) {
      const oct = mode.toString(8).padStart(4, "0");
      const sym = calculateChmod(oct).symbolic;
      expect(calculateChmod(sym).numericFull, `${oct} -> ${sym}`).toBe(oct);
    }
  });
});

describe("calculateChmod — edge cases", () => {
  it("treats empty input as mode 000", () => {
    const r = calculateChmod("  ");
    expect(r.isValid).toBe(true);
    expect(r.numeric).toBe("000");
  });

  it("returns the invalid result for bad input", () => {
    for (const bad of ["888", "75", "75555", "rwxr-xr-", "rwxr-xr-q", "abc", "-7-5-5", "u+x"]) {
      const r = calculateChmod(bad);
      expect(r.isValid, bad).toBe(false);
      expect(r.symbolic).toBe("");
    }
  });

  it("explains in Russian", () => {
    const r = calculateChmod("4750", "ru");
    expect(r.explanation[0]).toBe("Владелец: чтение, запись и выполнение.");
    expect(r.explanation[2]).toBe("Остальные: нет доступа.");
    expect(r.explanation[3]).toMatch(/^Бит setuid/);
  });
});

describe("parsers", () => {
  it("parseNumeric / parseSymbolic return null on junk and agree on valid input", () => {
    expect(parseNumeric("9")).toBeNull();
    expect(parseSymbolic("rwx")).toBeNull();
    expect(parseNumeric("640")).toEqual(parseSymbolic("rw-r-----"));
    const perms = parseNumeric("640");
    expect(perms && describeChmod(perms).symbolic).toBe("rw-r-----");
  });
});
