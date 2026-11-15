#!/usr/bin/env node
// Build: tsc → dist/ (ES modules, .d.ts, declaration and source maps). The sources already
// write relative imports with the ".js" extension of the emitted file, so the output is
// valid ESM for Node and browsers as emitted; this script only checks that every relative
// import in dist/ points at a file that exists.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], {
  stdio: "inherit",
});

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|d\.ts)$/.test(name)) files.push(p);
  }
})(dist);

const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']+?)\1/g;
const problems = [];
let checked = 0;
for (const file of files) {
  for (const [, , spec] of readFileSync(file, "utf8").matchAll(SPEC)) {
    checked++;
    if (!spec.endsWith(".js")) problems.push(`${file}: ${spec} has no .js extension`);
    else if (!existsSync(join(dirname(file), spec))) problems.push(`${file}: ${spec} not found`);
  }
}
if (problems.length) {
  for (const p of problems) console.error(`build: ${p}`);
  process.exit(1);
}
console.log(`build: ${files.length} files in dist/, ${checked} relative imports checked`);
