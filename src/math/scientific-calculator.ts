/**
 * Evaluates calculator expressions with its own parser (no eval): arithmetic, powers,
 * factorials, constants, trigonometry in degrees or radians, logarithms and roots.
 */

export type AngleMode = "deg" | "rad";

export type CalculatorErrorCode =
  | "empty"
  | "syntax"
  | "unknown-function"
  | "division-by-zero"
  | "domain"
  | "overflow";

export interface CalculatorResult {
  /** Numeric value, or null when the expression is empty or invalid */
  value: number | null;
  /** Value rendered as a plain, copy-pasteable string ("" when there is no value) */
  formatted: string;
  /** Machine-readable failure reason, or null on success */
  errorCode: CalculatorErrorCode | null;
  /** English failure message, or null on success */
  error: string | null;
}

const ERROR_MESSAGES: Record<CalculatorErrorCode, string> = {
  empty: "Enter an expression",
  syntax: "Invalid expression",
  "unknown-function": "Unknown function or constant",
  "division-by-zero": "Division by zero",
  domain: "Result is not a real number",
  overflow: "Result is too large to display",
};

class CalcError extends Error {
  code: CalculatorErrorCode;

  constructor(code: CalculatorErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

type Token =
  | { type: "num"; value: number }
  | { type: "name"; value: string }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

const ANGLE_INPUT_FUNCTIONS = new Set(["sin", "cos", "tan", "sec", "csc", "cot"]);
const ANGLE_OUTPUT_FUNCTIONS = new Set(["asin", "acos", "atan"]);

const FUNCTIONS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sec: (x) => 1 / Math.cos(x),
  csc: (x) => 1 / Math.sin(x),
  cot: (x) => 1 / Math.tan(x),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sign: Math.sign,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

/** Normalise the pretty symbols a calculator keypad produces into parser-friendly ASCII. */
function normalise(input: string): string {
  return (
    input
      .replace(/×/g, "*")
      .replace(/·/g, "*")
      .replace(/÷/g, "/")
      .replace(/[−–—]/g, "-")
      .replace(/π/g, "pi")
      // the space ends the name, so "√16" reads as sqrt 16 rather than an unknown "sqrt16"
      .replace(/√/g, "sqrt ")
      .replace(/,/g, ".")
      .replace(/\bmod\b/gi, "%")
  );
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (!match) throw new CalcError("syntax");
      i += match[0].length;
      // "1.2.3" is a typo, not 1.2 × .3
      if (input[i] === ".") throw new CalcError("syntax");
      tokens.push({ type: "num", value: Number.parseFloat(match[0]) });
      continue;
    }

    if (/[a-zA-Z]/.test(char)) {
      const match = /^[a-zA-Z][a-zA-Z0-9]*/.exec(input.slice(i));
      if (!match) throw new CalcError("syntax");
      tokens.push({ type: "name", value: match[0].toLowerCase() });
      i += match[0].length;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }

    if ("+-*/^%!".includes(char)) {
      tokens.push({ type: "op", value: char });
      i++;
      continue;
    }

    throw new CalcError("syntax");
  }

  return tokens;
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new CalcError("domain");
  if (n > 170) throw new CalcError("overflow");
  let result = 1;
  for (let k = 2; k <= n; k++) result *= k;
  return result;
}

/**
 * Exact trig values at whole multiples of a right angle (90°, 180°, π/2, π, …), where the
 * floating-point result would otherwise show noise (cos 90° = 6e-17) or a huge number for
 * an undefined value (tan 90° = 1.6e16). Undefined results are NaN, reported as a domain
 * error. Returns null for every other angle (and for 0, which Math already gets exactly).
 */
function exactTrig(name: string, argument: number, angleMode: AngleMode): number | null {
  if (!Number.isFinite(argument)) return null;
  const quarter = angleMode === "deg" ? argument / 90 : argument / (Math.PI / 2);
  const q = Math.round(quarter);
  if (q === 0 || Math.abs(quarter - q) > 1e-12 * Math.abs(q)) return null;
  const m = ((q % 4) + 4) % 4;
  const s = [0, 1, 0, -1][m];
  const c = [1, 0, -1, 0][m];
  switch (name) {
    case "sin":
      return s;
    case "cos":
      return c;
    case "tan":
      return c === 0 ? Number.NaN : s / c;
    case "sec":
      return c === 0 ? Number.NaN : 1 / c;
    case "csc":
      return s === 0 ? Number.NaN : 1 / s;
    case "cot":
      return s === 0 ? Number.NaN : c / s;
    default:
      return null;
  }
}

class Parser {
  private tokens: Token[];
  private pos = 0;
  private angleMode: AngleMode;

  constructor(tokens: Token[], angleMode: AngleMode) {
    this.tokens = tokens;
    this.angleMode = angleMode;
  }

  parse(): number {
    const value = this.parseExpression();
    if (this.pos < this.tokens.length) throw new CalcError("syntax");
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token?.type === "op" && token.value === value;
  }

  private parseExpression(): number {
    let left = this.parseTerm();

    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.tokens[this.pos] as { type: "op"; value: string }).value;
      this.pos++;
      const right = this.parseTerm();
      left = op === "+" ? left + right : left - right;
    }

    return left;
  }

  private parseTerm(): number {
    let left = this.parseUnary();

    for (;;) {
      if (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
        const op = (this.tokens[this.pos] as { type: "op"; value: string }).value;
        this.pos++;
        const right = this.parseUnary();
        if ((op === "/" || op === "%") && right === 0) throw new CalcError("division-by-zero");
        if (op === "*") left *= right;
        else if (op === "/") left /= right;
        else left %= right;
        continue;
      }

      // Implicit multiplication: 2pi, 3(4+5), 2sin(1)
      const next = this.peek();
      if (next && (next.type === "num" || next.type === "name" || next.type === "lparen")) {
        left *= this.parseUnary();
        continue;
      }

      return left;
    }
  }

  private parseUnary(): number {
    if (this.isOp("-")) {
      this.pos++;
      return -this.parseUnary();
    }
    if (this.isOp("+")) {
      this.pos++;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePostfix();
    if (this.isOp("^")) {
      this.pos++;
      // Right-associative, and the exponent may itself be signed: 2^-3, 2^2^3
      const exponent = this.parseUnary();
      return base ** exponent;
    }
    return base;
  }

  private parsePostfix(): number {
    let value = this.parsePrimary();
    while (this.isOp("!")) {
      this.pos++;
      value = factorial(value);
    }
    return value;
  }

  /**
   * A function argument. When the call is parenthesised the group is the whole
   * argument, so `sin(30)^2` squares the sine instead of the angle. Bare
   * arguments (`sqrt 16`, `ln e`) fall back to unary precedence.
   */
  private parseArgument(): number {
    const next = this.peek();
    if (!next || next.type !== "lparen") return this.parseUnary();

    this.pos++;
    const value = this.parseExpression();
    const closing = this.peek();
    if (!closing || closing.type !== "rparen") throw new CalcError("syntax");
    this.pos++;
    return value;
  }

  private parsePrimary(): number {
    const token = this.peek();
    if (!token) throw new CalcError("syntax");

    if (token.type === "num") {
      this.pos++;
      return token.value;
    }

    if (token.type === "lparen") {
      this.pos++;
      const value = this.parseExpression();
      const closing = this.peek();
      if (!closing || closing.type !== "rparen") throw new CalcError("syntax");
      this.pos++;
      return value;
    }

    if (token.type === "name") {
      this.pos++;
      const name = token.value;

      if (name in CONSTANTS) return CONSTANTS[name];

      const fn = FUNCTIONS[name];
      if (!fn) throw new CalcError("unknown-function");

      const argument = this.parseArgument();
      if (ANGLE_INPUT_FUNCTIONS.has(name)) {
        const exact = exactTrig(name, argument, this.angleMode);
        if (exact !== null) return exact;
      }
      const input =
        ANGLE_INPUT_FUNCTIONS.has(name) && this.angleMode === "deg"
          ? (argument * Math.PI) / 180
          : argument;
      const output = fn(input);
      return ANGLE_OUTPUT_FUNCTIONS.has(name) && this.angleMode === "deg"
        ? (output * 180) / Math.PI
        : output;
    }

    throw new CalcError("syntax");
  }
}

/**
 * Render a number the way a calculator display would: no trailing float noise,
 * exponential notation only when the plain form would be unreadable.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0";

  const magnitude = Math.abs(value);
  if (magnitude >= 1e15 || magnitude < 1e-9) {
    return value
      .toExponential(9)
      .replace(/\.?0+e/, "e")
      .replace("e+", "e");
  }

  // 12 significant digits keeps 0.1 + 0.2 at 0.3 without hiding real precision.
  return String(Number.parseFloat(value.toPrecision(12)));
}

/**
 * Evaluate a scientific calculator expression.
 *
 * Supports + - * / % ^ ! with correct precedence, parentheses, implicit
 * multiplication (2pi), trigonometric, hyperbolic, logarithmic and rounding
 * functions, and the constants pi, e, tau and phi. Angles are read and returned
 * in degrees or radians depending on the angle mode.
 */
export function evaluateExpression(
  expression: string,
  angleMode: AngleMode = "deg",
): CalculatorResult {
  const trimmed = expression.trim();
  if (!trimmed) {
    return { value: null, formatted: "", errorCode: "empty", error: ERROR_MESSAGES.empty };
  }

  try {
    const tokens = tokenize(normalise(trimmed));
    if (tokens.length === 0) throw new CalcError("empty");

    const value = new Parser(tokens, angleMode).parse();

    if (Number.isNaN(value)) throw new CalcError("domain");
    if (!Number.isFinite(value)) throw new CalcError("overflow");

    return { value, formatted: formatNumber(value), errorCode: null, error: null };
  } catch (err) {
    const code = err instanceof CalcError ? err.code : "syntax";
    return { value: null, formatted: "", errorCode: code, error: ERROR_MESSAGES[code] };
  }
}
