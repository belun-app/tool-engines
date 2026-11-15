import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modules, version } from "./index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("package entry point", () => {
  it("reports the package version", () => {
    expect(version).toBe(pkg.version);
  });

  it("lists exactly the subpaths in the exports map", () => {
    const subpaths = Object.keys(pkg.exports)
      .filter((key) => key !== "." && key !== "./package.json")
      .map((key) => key.slice(2));
    expect([...modules].sort()).toEqual(subpaths.sort());
  });
});
