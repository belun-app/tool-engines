import { describe, expect, it } from "vitest";
import { evaluateExpression, formatNumber } from "./scientific-calculator.js";

const val = (expr: string, mode: "deg" | "rad" = "deg") => evaluateExpression(expr, mode).value;
const fmt = (expr: string, mode: "deg" | "rad" = "deg") => evaluateExpression(expr, mode).formatted;
const err = (expr: string) => evaluateExpression(expr).errorCode;

describe("evaluateExpression", () => {
  it("respects operator precedence and parentheses", () => {
    expect(val("2+3*4")).toBe(14);
    expect(val("(2+3)*4")).toBe(20);
    expect(val("10-4-3")).toBe(3);
    expect(val("100/10/2")).toBe(5);
    expect(val("10 % 3")).toBe(1);
    expect(val("10 mod 3")).toBe(1);
  });

  it("handles powers: right-associative, signed exponents, unary minus binds looser", () => {
    expect(val("2^10")).toBe(1024);
    expect(val("2^2^3")).toBe(256); // 2^(2^3)
    expect(val("2^-3")).toBe(0.125);
    expect(val("-2^2")).toBe(-4);
    expect(val("(-2)^2")).toBe(4);
  });

  it("supports factorial", () => {
    expect(val("5!")).toBe(120);
    expect(val("0!")).toBe(1);
    expect(val("-3!")).toBe(-6);
    expect(err("2.5!")).toBe("domain");
    expect(err("171!")).toBe("overflow");
    expect(val("170!")).toBeGreaterThan(7e306);
  });

  it("supports implicit multiplication and constants", () => {
    expect(val("2pi")).toBeCloseTo(2 * Math.PI, 12);
    expect(val("3(4+5)")).toBe(27);
    expect(val("(1+1)(2+2)")).toBe(8);
    expect(val("e")).toBe(Math.E);
    expect(val("tau")).toBeCloseTo(2 * Math.PI, 12);
    expect(val("phi")).toBeCloseTo(1.6180339887, 9);
    expect(val("2e3")).toBe(2000); // scientific notation, not 2 * e * 3
    expect(val("2e")).toBeCloseTo(2 * Math.E, 12);
  });

  it("normalises keypad symbols and decimal commas", () => {
    expect(val("6×7")).toBe(42);
    expect(val("84÷2")).toBe(42);
    expect(val("5−3")).toBe(2);
    expect(val("2π")).toBeCloseTo(2 * Math.PI, 12);
    expect(val("√(16)")).toBe(4);
    expect(val("1,5+1")).toBe(2.5);
  });

  it("evaluates trig in degrees and radians", () => {
    expect(fmt("sin(30)")).toBe("0.5");
    expect(fmt("tan(45)")).toBe("1");
    expect(val("asin(1)")).toBe(90);
    expect(val("acos(0.5)")).toBeCloseTo(60, 10);
    expect(fmt("sin(30)^2")).toBe("0.25"); // squares the sine, not the angle
    expect(val("sin(pi/2)", "rad")).toBe(1);
    expect(val("atan(1)", "rad")).toBeCloseTo(Math.PI / 4, 12);
    expect(val("sec(60)")).toBeCloseTo(2, 12);
  });

  it("evaluates logs, roots and rounding functions", () => {
    expect(val("log(1000)")).toBe(3);
    expect(val("ln(e)")).toBe(1);
    expect(val("log2(8)")).toBe(3);
    expect(val("sqrt 16")).toBe(4);
    expect(val("cbrt(27)")).toBe(3);
    expect(val("abs(-3)")).toBe(3);
    expect(val("floor(2.7)+ceil(2.1)+round(2.5)")).toBe(8);
    expect(val("LOG(100)")).toBe(2); // case-insensitive
  });

  it("formats away float noise", () => {
    expect(fmt("0.1+0.2")).toBe("0.3");
    expect(fmt("1/3")).toBe("0.333333333333");
    expect(fmt("1e20")).toBe("1e20");
    expect(fmt("1e-12")).toBe("1e-12");
  });

  it("reports errors with a code and message instead of throwing", () => {
    expect(evaluateExpression("")).toMatchObject({ value: null, errorCode: "empty" });
    expect(evaluateExpression("   ").errorCode).toBe("empty");
    expect(err("1/0")).toBe("division-by-zero");
    expect(err("5 % 0")).toBe("division-by-zero");
    expect(err("sqrt(-1)")).toBe("domain");
    expect(err("acos(2)")).toBe("domain");
    expect(err("ln(0)")).toBe("overflow");
    expect(err("10^400")).toBe("overflow");
    expect(err("foo(2)")).toBe("unknown-function");
    expect(err("(1+2")).toBe("syntax");
    expect(err("1+")).toBe("syntax");
    expect(err("2)")).toBe("syntax");
    expect(err("50%")).toBe("syntax");
    expect(err("1 $ 2")).toBe("syntax");
    expect(err(".")).toBe("syntax");
    const r = evaluateExpression("1/0");
    expect(r.error).toBe("Division by zero");
    expect(r.formatted).toBe("");
  });
});

describe("formatNumber", () => {
  it("renders zero, plain and exponential forms", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(123456.789)).toBe("123456.789");
    expect(formatNumber(1.5e15)).toBe("1.5e15");
    expect(formatNumber(-2.5e-10)).toBe("-2.5e-10");
    expect(formatNumber(Number.NaN)).toBe("");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("fixed defects", () => {
  it("shows cos(90°) and sin(180°) as 0", () => {
    expect(fmt("cos(90)")).toBe("0");
    expect(fmt("sin(180)")).toBe("0");
    expect(fmt("sin(pi)", "rad")).toBe("0");
  });

  it("treats tan(90°) as undefined", () => {
    expect(err("tan(90)")).toBe("domain");
    expect(err("sec(270)")).toBe("domain");
    expect(fmt("tan(180)")).toBe("0");
    expect(fmt("cos(-180)")).toBe("-1");
  });

  it("accepts the root sign directly before a number", () => {
    expect(val("√16")).toBe(4);
    expect(val("√(16)")).toBe(4);
    expect(val("2√16")).toBe(8);
  });

  it("rejects a number with two decimal points", () => {
    expect(err("1.2.3")).toBe("syntax");
  });
});
