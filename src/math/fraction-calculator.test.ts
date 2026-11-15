import { describe, expect, it } from "vitest";
import { calculateFractions, parseFraction, simplify } from "./fraction-calculator.js";

describe("parseFraction", () => {
  it("parses integers, fractions, mixed numbers and decimals", () => {
    expect(parseFraction("3")).toEqual({ numerator: 3, denominator: 1 });
    expect(parseFraction("-3/4")).toEqual({ numerator: -3, denominator: 4 });
    expect(parseFraction("6/8")).toEqual({ numerator: 3, denominator: 4 });
    expect(parseFraction("3/-4")).toEqual({ numerator: -3, denominator: 4 });
    expect(parseFraction("1 1/2")).toEqual({ numerator: 3, denominator: 2 });
    expect(parseFraction("-2 1/3")).toEqual({ numerator: -7, denominator: 3 });
    expect(parseFraction("0.75")).toEqual({ numerator: 3, denominator: 4 });
    expect(parseFraction(".5")).toEqual({ numerator: 1, denominator: 2 });
    expect(parseFraction("-.25")).toEqual({ numerator: -1, denominator: 4 });
    expect(parseFraction(" 2 / 4 ")).toEqual({ numerator: 1, denominator: 2 });
  });

  it("rejects zero denominators, garbage and over-long decimals", () => {
    for (const v of ["", "1/0", "1 1/0", "abc", "1/2/3", "0.1234567891", "½"]) {
      expect(parseFraction(v)).toBeNull();
    }
  });
});

describe("simplify", () => {
  it("reduces and moves the sign to the numerator", () => {
    expect(simplify({ numerator: 10, denominator: -4 })).toEqual({ numerator: -5, denominator: 2 });
    expect(simplify({ numerator: 0, denominator: 5 })).toEqual({ numerator: 0, denominator: 1 });
  });
});

describe("calculateFractions", () => {
  it("adds with a common denominator", () => {
    // 1/2 + 1/3 = 5/6
    const r = calculateFractions("1/2", "add", "1/3");
    expect(r).toMatchObject({ valid: true, numerator: 5, denominator: 6, text: "5/6" });
    expect(r.decimal).toBeCloseTo(5 / 6, 12);
    expect(r.mixedText).toBe("5/6");
  });

  it("subtracts into a negative mixed number", () => {
    // 1/4 - 2 1/2 = 1/4 - 10/4 = -9/4 = -2 1/4
    const r = calculateFractions("1/4", "subtract", "2 1/2");
    expect(r).toMatchObject({ numerator: -9, denominator: 4, whole: -2, mixedNumerator: 1 });
    expect(r.text).toBe("-9/4");
    expect(r.mixedText).toBe("-2 1/4");
  });

  it("multiplies and divides", () => {
    // 2/3 * 9/4 = 18/12 = 3/2 = 1 1/2
    const m = calculateFractions("2/3", "multiply", "9/4");
    expect(m.text).toBe("3/2");
    expect(m.mixedText).toBe("1 1/2");
    // 3/4 ÷ 3/8 = 2
    const d = calculateFractions("3/4", "divide", "3/8");
    expect(d.text).toBe("2");
    expect(d.mixedText).toBe("2");
    expect(d.denominator).toBe(1);
  });

  it("mixes decimals and fractions", () => {
    // 0.5 + 1/4 = 3/4
    expect(calculateFractions("0.5", "add", "1/4").text).toBe("3/4");
  });

  it("reports empty, bad input and division by zero", () => {
    expect(calculateFractions("", "add", "1/2").error).toBe("empty");
    expect(calculateFractions("1/2", "add", "  ").error).toBe("empty");
    expect(calculateFractions("x", "add", "1/2").error).toBe("bad-input");
    expect(calculateFractions("1/2", "divide", "0").error).toBe("divide-by-zero");
    expect(calculateFractions("1/2", "divide", "0/7").error).toBe("divide-by-zero");
    const r = calculateFractions("1/2", "divide", "0");
    expect(r.valid).toBe(false);
    expect(r.text).toBe("");
  });

  it("refuses results that overflow safe integers instead of returning garbage", () => {
    const r = calculateFractions("9007199254740991/2", "multiply", "9007199254740991/3");
    expect(r.valid).toBe(false);
    expect(r.error).toBe("overflow");
    expect(calculateFractions("99999999999999999999", "add", "1").error).toBe("overflow");
    expect(calculateFractions("1/99999999999999999999", "add", "1").error).toBe("overflow");
  });

  it("is exact when intermediate products exceed 2^53 but the result fits", () => {
    // (2^53 - 1)/3 × 3/(2^53 - 1) = 1; the plain float product of the parts would round.
    expect(calculateFractions("9007199254740991/3", "multiply", "3/9007199254740991").text).toBe(
      "1",
    );
    // 1/94906267 + 1/94906267: the denominator product is above 2^53, the sum is 2/94906267.
    expect(calculateFractions("1/94906267", "add", "1/94906267").text).toBe("2/94906267");
  });

  it("reports an unknown operation and non-string operands as bad input", () => {
    expect(calculateFractions("1/2", "power" as never, "1/3").error).toBe("bad-input");
    expect(calculateFractions(undefined as unknown as string, "add", "1").error).toBe("bad-input");
  });

  it("parseFraction refuses parts beyond safe integers", () => {
    expect(parseFraction("99999999999999999999")).toBeNull();
    expect(parseFraction("2/4")).toEqual({ numerator: 1, denominator: 2 });
    expect(parseFraction(null as unknown as string)).toBeNull();
  });

  it("returns zero cleanly", () => {
    const r = calculateFractions("1/2", "subtract", "2/4");
    expect(r).toMatchObject({
      valid: true,
      numerator: 0,
      denominator: 1,
      text: "0",
      mixedText: "0",
    });
  });
});
