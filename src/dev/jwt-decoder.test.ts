import { describe, expect, it } from "vitest";
import { decodeJwt } from "./jwt-decoder.js";

const b64url = (obj: unknown) =>
  Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj), "utf8").toString("base64url");
const token = (header: unknown, payload: unknown, sig = "sig") =>
  `${b64url(header)}.${b64url(payload)}.${sig}`;

// The jwt.io example token (HS256, secret "your-256-bit-secret").
const JWT_IO =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("decodeJwt", () => {
  it("decodes the jwt.io example", () => {
    const r = decodeJwt(JWT_IO);
    expect(r.error).toBe("");
    expect(r.algorithm).toBe("HS256");
    expect(r.tokenType).toBe("JWT");
    expect(JSON.parse(r.header)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(r.payload)).toEqual({ sub: "1234567890", name: "John Doe", iat: 1516239022 });
    expect(r.signature).toBe("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    expect(r.claims).toEqual([
      { key: "sub", label: "Subject (sub)", value: "1234567890", date: "" },
      {
        key: "iat",
        label: "Issued at (iat)",
        value: "1516239022",
        // 1516239022 = 2018-01-18T01:30:22Z
        date: "Thu, 18 Jan 2018 01:30:22 GMT",
      },
    ]);
    expect(r.expiryStatus).toBe("none");
  });

  it("orders registered claims and stringifies arrays", () => {
    const r = decodeJwt(
      token({ alg: "none" }, { jti: "j", aud: ["a", "b"], iss: "me", exp: 100, custom: 1 }, ""),
    );
    expect(r.claims.map((c) => c.key)).toEqual(["iss", "aud", "exp", "jti"]);
    expect(r.claims[1].value).toBe('["a","b"]');
    expect(r.claims[2].date).toBe("Thu, 01 Jan 1970 00:01:40 GMT");
    expect(r.signature).toBe("");
    expect(r.tokenType).toBe("");
  });

  it("derives expiry status from exp versus nowMs", () => {
    const t = token({ alg: "HS256" }, { exp: 1000 });
    expect(decodeJwt(t, 999_000).expiryStatus).toBe("valid");
    expect(decodeJwt(t, 1_000_000).expiryStatus).toBe("valid");
    expect(decodeJwt(t, 1_000_001).expiryStatus).toBe("expired");
    // non-numeric exp is ignored for status and date
    const s = decodeJwt(token({}, { exp: "soon" }), 0);
    expect(s.expiryStatus).toBe("none");
    expect(s.claims[0].date).toBe("");
  });

  it("decodes UTF-8 payloads with base64url characters (- and _)", () => {
    const r = decodeJwt(token({ alg: "HS256" }, { name: "Иван 😀", q: "???>>>" }));
    expect(JSON.parse(r.payload).name).toBe("Иван 😀");
  });

  it("accepts a non-object payload without claims", () => {
    const r = decodeJwt(`${b64url({ alg: "x" })}.${b64url("[1,2]")}.s`);
    expect(r.error).toBe("");
    expect(r.claims).toEqual([]);
  });

  it("returns the empty result for blank input", () => {
    const r = decodeJwt("   ");
    expect(r.error).toBe("");
    expect(r.header).toBe("");
  });

  it("reports structural and encoding errors without throwing", () => {
    expect(decodeJwt("a.b").error).toMatch(/three parts/);
    expect(decodeJwt("a.b.c.d").error).toMatch(/three parts/);
    expect(decodeJwt(`!!!.${b64url({})}.s`).error).toMatch(/header/);
    // length % 4 == 1 is impossible in base64
    expect(decodeJwt(`abcde.${b64url({})}.s`).error).toMatch(/header/);
    expect(decodeJwt(`${b64url({})}.${b64url("not json")}.s`).error).toMatch(/payload/);
  });

  it("takes the current time as a number or as { now }", () => {
    const t = token({ alg: "HS256" }, { exp: 1000 });
    expect(decodeJwt(t, 999_000).expiryStatus).toBe("valid");
    expect(decodeJwt(t, { now: 999_000 }).expiryStatus).toBe("valid");
    expect(decodeJwt(t, { now: 1_000_001 }).expiryStatus).toBe("expired");
  });

  it("returns an error for a non-string token instead of throwing", () => {
    for (const bad of [undefined, null, 42, {}]) {
      expect(decodeJwt(bad as unknown as string).error).toMatch(/string/);
    }
  });
});
