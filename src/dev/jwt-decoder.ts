export interface JwtClaim {
  /** The claim key, e.g. "exp". */
  key: string;
  /** Human-readable label for the claim, e.g. "Expires (exp)". */
  label: string;
  /** The claim value rendered as a string. */
  value: string;
  /** Set for time-based claims (exp, nbf, iat): the value formatted as a UTC date. */
  date: string;
}

export interface JwtDecodeResult {
  /** Pretty-printed JSON of the decoded header, or "" when decoding failed. */
  header: string;
  /** Pretty-printed JSON of the decoded payload, or "" when decoding failed. */
  payload: string;
  /** The raw signature segment (Base64URL), or "" when absent. */
  signature: string;
  /** The `alg` field from the header, e.g. "HS256". */
  algorithm: string;
  /** The `typ` field from the header, e.g. "JWT". */
  tokenType: string;
  /** Registered claims (iss, sub, exp, …) surfaced for quick reading. */
  claims: JwtClaim[];
  /** Derived from `exp`: "valid", "expired", or "none" when there is no exp claim. */
  expiryStatus: "valid" | "expired" | "none";
  /** Non-empty when the token could not be decoded. */
  error: string;
}

const EMPTY: JwtDecodeResult = {
  header: "",
  payload: "",
  signature: "",
  algorithm: "",
  tokenType: "",
  claims: [],
  expiryStatus: "none",
  error: "",
};

const CLAIM_LABELS: Record<string, string> = {
  iss: "Issuer (iss)",
  sub: "Subject (sub)",
  aud: "Audience (aud)",
  exp: "Expires (exp)",
  nbf: "Not before (nbf)",
  iat: "Issued at (iat)",
  jti: "JWT ID (jti)",
};

// Order in which registered claims are surfaced, regardless of payload order.
const CLAIM_ORDER = ["iss", "sub", "aud", "exp", "nbf", "iat", "jti"];
const TIME_CLAIMS = new Set(["exp", "nbf", "iat"]);

function base64UrlToString(segment: string): string {
  let base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = base64.length % 4;
  if (remainder === 2) base64 += "==";
  else if (remainder === 3) base64 += "=";
  else if (remainder === 1) throw new Error("malformed segment");

  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface JwtDecodeOptions {
  /** Current time in milliseconds for `expiryStatus`. Default `Date.now()`. */
  now?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * Decode a JSON Web Token without verifying its signature. Verification needs the
 * signing secret or public key, which a client-side tool cannot (and should not) hold.
 * The second argument is the current time in milliseconds, or `{ now }`; it defaults to
 * `Date.now()` and only affects the `expiryStatus` field. A non-string token gives an error.
 */
export function decodeJwt(
  token: string,
  nowOrOptions: number | JwtDecodeOptions = {},
): JwtDecodeResult {
  const nowMs =
    typeof nowOrOptions === "number"
      ? nowOrOptions
      : typeof nowOrOptions?.now === "number"
        ? nowOrOptions.now
        : Date.now();
  if (typeof token !== "string") return { ...EMPTY, error: "The token must be a string." };
  const trimmed = token.trim();
  if (!trimmed) return { ...EMPTY };

  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return {
      ...EMPTY,
      error: "A JWT must have three parts separated by dots: header.payload.signature.",
    };
  }

  const [headerSeg, payloadSeg, signatureSeg] = parts;

  let headerParsed: unknown;
  try {
    headerParsed = JSON.parse(base64UrlToString(headerSeg));
  } catch {
    return { ...EMPTY, error: "The header is not valid Base64URL-encoded JSON." };
  }

  let payloadParsed: unknown;
  try {
    payloadParsed = JSON.parse(base64UrlToString(payloadSeg));
  } catch {
    return { ...EMPTY, error: "The payload is not valid Base64URL-encoded JSON." };
  }

  const header = JSON.stringify(headerParsed, null, 2);
  const payload = JSON.stringify(payloadParsed, null, 2);

  const algorithm = isPlainObject(headerParsed) ? valueToString(headerParsed.alg) : "";
  const tokenType = isPlainObject(headerParsed) ? valueToString(headerParsed.typ) : "";

  const claims: JwtClaim[] = [];
  let expiryStatus: JwtDecodeResult["expiryStatus"] = "none";

  if (isPlainObject(payloadParsed)) {
    for (const key of CLAIM_ORDER) {
      if (!Object.hasOwn(payloadParsed, key)) continue;
      const raw = payloadParsed[key];
      let date = "";
      if (TIME_CLAIMS.has(key) && typeof raw === "number" && Number.isFinite(raw)) {
        date = new Date(raw * 1000).toUTCString();
      }
      claims.push({
        key,
        label: CLAIM_LABELS[key] ?? key,
        value: valueToString(raw),
        date,
      });
    }

    if (typeof payloadParsed.exp === "number" && Number.isFinite(payloadParsed.exp)) {
      expiryStatus = payloadParsed.exp * 1000 < nowMs ? "expired" : "valid";
    }
  }

  return {
    header,
    payload,
    signature: signatureSeg,
    algorithm,
    tokenType,
    claims,
    expiryStatus,
    error: "",
  };
}
