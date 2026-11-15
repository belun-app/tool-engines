import { describe, expect, it } from "vitest";
import { jsonToCsv } from "./json-to-csv-converter.js";

describe("jsonToCsv", () => {
  it("returns the empty result for blank input", () => {
    expect(jsonToCsv("   ")).toEqual({ csv: "", rows: 0, columns: 0, error: "" });
  });

  it("reports invalid JSON without throwing", () => {
    const r = jsonToCsv("{not json");
    expect(r.csv).toBe("");
    expect(r.error).not.toBe("");
  });

  it("reports an empty array", () => {
    expect(jsonToCsv("[]").error).toMatch(/empty/);
  });

  it("converts an array of objects with a CRLF-joined header", () => {
    const r = jsonToCsv('[{"a":1,"b":"x"},{"a":2,"b":"y"}]');
    expect(r.csv).toBe("a,b\r\n1,x\r\n2,y");
    expect(r.rows).toBe(2);
    expect(r.columns).toBe(2);
  });

  it("unions keys in first-seen order and leaves missing keys blank", () => {
    expect(jsonToCsv('[{"a":1},{"b":2,"a":3},{"c":null}]').csv).toBe("a,b,c\r\n1,,\r\n3,2,\r\n,,");
  });

  it("serialises booleans, nulls and nested values", () => {
    expect(jsonToCsv('[{"t":true,"f":false,"n":null,"o":{"k":1},"arr":[1,2]}]').csv).toBe(
      't,f,n,o,arr\r\ntrue,false,,"{""k"":1}","[1,2]"',
    );
  });

  it("quotes fields containing the delimiter, quotes or newlines", () => {
    expect(jsonToCsv('[{"x":"a,b"},{"x":"say \\"hi\\""},{"x":"l1\\nl2"},{"x":"r\\r"}]').csv).toBe(
      'x\r\n"a,b"\r\n"say ""hi"""\r\n"l1\nl2"\r\n"r\r"',
    );
  });

  it("only quotes for the chosen delimiter", () => {
    expect(jsonToCsv('[{"x":"a,b","y":"c;d"}]', { delimiter: ";" }).csv).toBe('x;y\r\na,b;"c;d"');
    expect(jsonToCsv('[{"x":1,"y":2}]', { delimiter: "\t" }).csv).toBe("x\ty\r\n1\t2");
  });

  it("drops the header on request", () => {
    expect(jsonToCsv('[{"a":1}]', { includeHeader: false }).csv).toBe("1");
  });

  it("treats a single object as one row", () => {
    const r = jsonToCsv('{"name":"Аня","city":"Минск"}');
    expect(r.csv).toBe("name,city\r\nАня,Минск");
    expect(r.rows).toBe(1);
  });

  it("collapses primitives and mixed arrays into a single value column", () => {
    expect(jsonToCsv('[1,"two",null,[3,4]]').csv).toBe('value\r\n1\r\ntwo\r\n\r\n"[3,4]"');
    expect(jsonToCsv("42").csv).toBe("value\r\n42");
    expect(jsonToCsv('[{"a":1},2]').columns).toBe(1);
  });
});
