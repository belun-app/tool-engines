# @belun-app/tool-engines

[![CI](https://github.com/belun-app/tool-engines/actions/workflows/ci.yml/badge.svg)](https://github.com/belun-app/tool-engines/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40belun-app%2Ftool-engines)](https://www.npmjs.com/package/@belun-app/tool-engines)
[![types](https://img.shields.io/npm/types/%40belun-app%2Ftool-engines)](https://www.npmjs.com/package/@belun-app/tool-engines)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

The logic behind [belun.app](https://belun.app/) — free browser tools that work on your files
without uploading them. 165 TypeScript modules: a PDF reader and writer, a ZIP
writer, EXIF removal, calculators, converters, text and developer utilities.

- **No runtime dependencies.** Every module is plain TypeScript compiled to ES2022 modules,
  with type declarations (and declaration maps back to the sources) for every subpath.
- **Browser and Node.** The engines take bytes, strings and numbers and return plain
  objects. The parts only a browser can do (drawing on a canvas, decoding images, recording
  audio, reading files from an `<input>`) live in belun.app's UI layer and are not in this
  package; comments in the code call that layer "the mount".
- **Tree-shakeable.** One subpath export per module, `"sideEffects": false`.
- **Tested.** 166 test files, run on Node 20, 22, 24, 26 in CI, plus a
  check of the PDF outputs with `qpdf --check` and by re-opening them with pdf-lib.

## Install

```sh
npm install @belun-app/tool-engines
```

Import each module by its subpath. The root entry (`import { modules, version } from
"@belun-app/tool-engines"`) only lists the subpaths and the version; it imports no module.

TypeScript: use `"moduleResolution": "bundler"`, `"node16"` or `"nodenext"`. The older
`"node"` (`node10`) resolution does not read the `exports` map, so it cannot find the
subpaths.

### In a browser without a bundler

Every file in `dist/` is a standalone ES module with relative imports, so a CDN works:

```html
<script type="module">
  import { arabicToRoman } from "https://cdn.jsdelivr.net/npm/@belun-app/tool-engines@0.1.0/dist/convert/roman-numeral-converter.js";
  // or: import { arabicToRoman } from "https://esm.sh/@belun-app/tool-engines@0.1.0/convert/roman-numeral-converter";
  console.log(arabicToRoman(1999).roman); // "MCMXCIX"
</script>
```

### CommonJS

The package is ESM-only. From CommonJS, use `await import("@belun-app/tool-engines/zip")`. Node 20.19+
and 22.12+ can also `require()` it directly, because they load ES modules through
`require`.

## Usage

### Merge PDFs (no pdf.js)

The PDF modules parse the file themselves. The only thing they ask of the host is a
zlib *inflate* function, used to read compressed object streams (PDF 1.5+).

```js
import { readFile, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { mergePdfs } from "@belun-app/tool-engines/file/pdf-merger";

const inflate = async (data) => new Uint8Array(inflateSync(data));
const result = await mergePdfs(
  [
    { name: "a.pdf", data: new Uint8Array(await readFile("a.pdf")) },
    { name: "b.pdf", data: new Uint8Array(await readFile("b.pdf")) },
  ],
  inflate,
);
if (!result.ok) throw new Error(result.error);
await writeFile("merged.pdf", result.bytes);
console.log(result.pageCount, "pages");
```

In a browser, inflate with `DecompressionStream`:

```js
const inflate = async (data) =>
  new Uint8Array(
    await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate")))
      .arrayBuffer(),
  );
```

### Build a ZIP file

```js
import { buildZip } from "@belun-app/tool-engines/zip";

const enc = new TextEncoder();
const zip = buildZip([
  { name: "hello.txt", data: enc.encode("Hello") },
  { name: "docs/readme.md", data: enc.encode("# Readme") },
]);
// zip is a Uint8Array: a valid archive with stored (uncompressed) entries.
```

### Number to words (English and Russian)

```js
import { numberToWords } from "@belun-app/tool-engines/convert/number-to-words-converter";

const r = numberToWords("1234.56", { currency: "usd" });
r.words;         // "one thousand two hundred thirty-four point five six"
r.currencyWords; // "one thousand two hundred thirty-four dollars and fifty-six cents"
r.cheque;        // "one thousand two hundred thirty-four dollars and 56/100"

numberToWords("21", { lang: "ru" }).words; // "двадцать один"
```

### Roman numerals

```js
import { arabicToRoman, romanToArabic } from "@belun-app/tool-engines/convert/roman-numeral-converter";

arabicToRoman(2024).roman; // "MMXXIV"
romanToArabic("mcmxcix").arabic; // 1999
romanToArabic("IIII").suggestion; // { roman: "IV", arabic: 4 }
```

### Unit converter

```js
import { convertUnits } from "@belun-app/tool-engines/convert/unit-converter";

const rows = convertUnits("length", "mi", 1);
rows.find((r) => r.unitId === "km").amount; // 1.609344
convertUnits("temperature", "c", 100).find((r) => r.unitId === "f").amount; // 212
```

### Errors

Results are plain objects, and invalid input does not throw. How a module reports a
problem differs from module to module, because each grew with its page: many return
`{ ok: false, error }` (often with a machine-readable `code`), some add an `error`
field next to the result, and a few return `null` or an empty list. Each module's exported
types document its behaviour.

## Runtime support

Every module runs in current browsers and in Node 20 or newer; none of them touches the DOM. CI runs the tests on Node 20, 22, 24, 26, and a smoke test imports every subpath from the built package in plain Node.

A few modules rely on standard globals:

- **Web Crypto** (`crypto.getRandomValues`, `crypto.subtle`; browsers and Node 20+): `random`, `dev/hash-generator`, `dev/text-encryption`, `dev/uuid-generator`
- **Intl.Segmenter** (browsers, Node 20+): `graphemes`

Modules that generate random values use `crypto.getRandomValues` with rejection sampling (no modulo bias). Each takes an optional `rng` (see `random`) for seeded or reproducible output. Without an `rng` and without Web Crypto they report the code `no-secure-random`: in the result object where the module returns one, otherwise by throwing `SecureRandomUnavailableError`.

Some modules are the logic half of a browser feature: the camera, microphone, gamepad and keyboard tests, the voice recorder and audio trimmer, the metronome and tone generator, and the image tools. They take plain values that a browser API produced (for example `MediaTrackSettings`, an array of audio samples or pixel sizes) and return plain values, so they run and test in Node too; capturing and drawing stay in your app.

## Modules

Import path: `@belun-app/tool-engines/<subpath>`. Descriptions are taken from each module's header
comment.

### Shared helpers

- [`bytes`](src/_bytes.ts) — Human-readable file sizes in English or Russian notation: "1.5 MB" / "1,5 МБ", "512 B" / "512 Б".
- [`graphemes`](src/_graphemes.ts) — Splits text into user-perceived characters (extended grapheme clusters), with Intl.Segmenter or a built-in fallback. *Uses Intl.Segmenter.*
- [`num`](src/_num.ts) — Locale-aware number formatting and parsing in English or Russian notation.
- [`plural`](src/_plural.ts) — Plural forms for EN and RU, on `Intl.PluralRules`.
- [`random`](src/_random.ts) — Unbiased random integers, floats, picks and shuffles over Web Crypto, with an optional injectable source for seeded or scripted runs. *Uses Web Crypto.*
- [`zip`](src/_zip.ts) — ZIP writer (stored / uncompressed).

### PDF

- [`pdf/pdf-lib`](src/pdf/_pdf-lib.ts) — Shared client-side PDF read/write core.
- [`pdf/add-page-numbers-to-pdf`](src/pdf/add-page-numbers-to-pdf.ts) — Client-side PDF page numberer.
- [`pdf/compress-pdf`](src/pdf/compress-pdf.ts) — Client-side PDF compressor.
- [`pdf/delete-pages-from-pdf`](src/pdf/delete-pages-from-pdf.ts) — Client-side PDF page remover.
- [`pdf/pdf-page-rotator`](src/pdf/pdf-page-rotator.ts) — Client-side PDF page rotator.
- [`pdf/pdf-splitter`](src/pdf/pdf-splitter.ts) — Client-side PDF splitter.
- [`pdf/pdf-to-jpg`](src/pdf/pdf-to-jpg.ts) — Interprets a PDF page's content stream as a display list for drawing the page on a canvas.
- [`pdf/pdf-to-word`](src/pdf/pdf-to-word.ts) — Client-side PDF → Word (.docx) converter.
- [`pdf/reorder-pdf-pages`](src/pdf/reorder-pdf-pages.ts) — Client-side PDF page reordering.
- [`pdf/sign-pdf`](src/pdf/sign-pdf.ts) — Client-side PDF signer.
- [`pdf/word-to-pdf`](src/pdf/word-to-pdf.ts) — Client-side Word (.docx) → PDF converter.

### Files

- [`file/file-hash-checker`](src/file/file-hash-checker.ts) — Streaming MD5 / SHA-1 / SHA-256 checksums.
- [`file/invoice-generator`](src/file/invoice-generator.ts) — Invoice math + PDF plumbing for the client-side invoice generator.
- [`file/pdf-merger`](src/file/pdf-merger.ts) — Client-side PDF merger.

### Images

- [`image/exif-metadata-remover`](src/image/exif-metadata-remover.ts) — Remove metadata (EXIF, GPS, XMP, IPTC, comments, PNG text chunks) from a JPEG or PNG file without re-encoding the image data.
- [`image/heic-to-jpg-converter`](src/image/heic-to-jpg-converter.ts) — HEIC / HEIF container reader.
- [`image/image-color-picker`](src/image/image-color-picker.ts) — Colour picking from image pixels: HEX, RGB, HSL, HSV and CMYK conversions, readable text colour on a swatch, and a dominant-colour palette by median cut.
- [`image/image-watermark-tool`](src/image/image-watermark-tool.ts) — Geometry for stamping a text or logo watermark onto a photo.
- [`image/meme-generator`](src/image/meme-generator.ts) — Meme caption layout: caption normalisation, greedy word wrapping to the image width and font sizing for the top and bottom text.
- [`image/merge-images`](src/image/merge-images.ts) — Layout maths for the Merge Images tool.
- [`image/online-signature`](src/image/online-signature.ts) — Turns freehand pen strokes into an SVG signature: stroke cleanup, smoothed path data, the bounding box and the SVG document.
- [`image/rotate-flip-image`](src/image/rotate-flip-image.ts) — Rotation and mirroring math for the Rotate / Flip Image tool.

### Text

- [`text/hunspell`](src/text/_hunspell.ts) — Reads Hunspell .aff/.dic dictionaries and checks words against them, with affix stripping instead of expanding every word form.
- [`text/stop-words`](src/text/_stop-words.ts) — English + Russian function words, shared by the keyword-density checker, the word-frequency counter and the word-cloud generator.
- [`text/text-stats`](src/text/_text-stats.ts) — Counting rules shared by the word counter and the character counter, so the two tools print the same totals for the same text.
- [`text/ai-text-cleaner`](src/text/ai-text-cleaner.ts) — Cleans text pasted from AI chat tools: rewrites dashes and quotes, removes zero-width characters, odd spaces, Markdown bold markers and emoji, and tidies whitespace.
- [`text/character-counter`](src/text/character-counter.ts) — Character statistics of a text: with and without spaces, user-perceived characters, letters by script, digits, spaces, lines, and SMS encoding and segments.
- [`text/fancy-text-generator`](src/text/fancy-text-generator.ts) — Plain text -> Unicode "fancy" text.
- [`text/find-and-replace-text`](src/text/find-and-replace-text.ts) — Find and replace in text by plain string or regular expression, with case-sensitive, whole-word, first-match-only and case-preserving options.
- [`text/grammar-checker`](src/text/grammar-checker.ts) — Rule-based checks for English text: repeated words, "a" versus "an" by the next word's sound, a lowercase pronoun "i", multiple spaces, and no space after punctuation.
- [`text/lorem-ipsum-generator`](src/text/lorem-ipsum-generator.ts) — Lorem ipsum placeholder text: a number of paragraphs with an exact word count each, optionally opening with the classic "Lorem ipsum dolor sit amet" sentence.
- [`text/markdown-to-html`](src/text/markdown-to-html.ts) — Converts a Markdown subset to HTML (headings, paragraphs, fenced code, quotes, flat lists, rules, inline code, emphasis, links, images; no nested lists or tables).
- [`text/plagiarism-checker`](src/text/plagiarism-checker.ts) — Similarity between two texts: the share of distinct words they have in common (Jaccard index) and how many sentences of the first text appear in the second.
- [`text/readability-checker`](src/text/readability-checker.ts) — Readability of English or Russian text: Flesch Reading Ease and grade level (Oborneva's coefficients for Russian), with word, sentence and syllable counts.
- [`text/remove-line-breaks`](src/text/remove-line-breaks.ts) — Removes line breaks from text, either all of them or only inside paragraphs, joining the lines with a chosen separator.
- [`text/spell-checker`](src/text/spell-checker.ts) — Spell checking for English and Russian against Hunspell dictionaries that the caller supplies as text; no dictionary is bundled.
- [`text/text-case-converter`](src/text/text-case-converter.ts) — Converts text to upper, lower, title, sentence, camel, Pascal, snake or kebab case.
- [`text/text-diff`](src/text/text-diff.ts) — Line-by-line diff of two texts by longest common subsequence, with counts of added, removed and unchanged lines.
- [`text/text-line-sorter`](src/text/text-line-sorter.ts) — Sorts the lines of a text alphabetically, by length or numerically, or reverses them, with options for case, trimming, empty lines and duplicates.
- [`text/text-repeater`](src/text/text-repeater.ts) — Repeats a text a given number of times with a separator, optional numbering and escape sequences, within a maximum count and output size.
- [`text/text-reverser`](src/text/text-reverser.ts) — Reverses text letter by letter, by word order or within each word, mirrors it or turns it upside down (Latin and Cyrillic), and checks for palindromes.
- [`text/text-to-ascii-art-generator`](src/text/text-to-ascii-art-generator.ts) — Text → ASCII art banners.
- [`text/whitespace-remover`](src/text/whitespace-remover.ts) — Whitespace cleanup: collapses spaces, trims lines, removes or collapses empty lines, converts tabs, normalises Unicode spaces and fixes spacing around punctuation.
- [`text/word-counter`](src/text/word-counter.ts) — Word, character, sentence and paragraph counts of a text, with reading and speaking time and progress towards a word target.
- [`text/word-frequency-counter`](src/text/word-frequency-counter.ts) — Word frequency list of a text with counts and percentages, optional stop-word filtering, CSV export, and the "classic nausea" keyword-stuffing figure.
- [`text/words-to-minutes-calculator`](src/text/words-to-minutes-calculator.ts) — Speaking time of a script from its word count at a slow, average or fast pace, or the number of words that fit a given time.

### Developer

- [`dev/base64`](src/dev/base64.ts) — Base64 encoding and decoding of UTF-8 text.
- [`dev/chmod-calculator`](src/dev/chmod-calculator.ts) — Parse either a numeric (755) or symbolic (rwxr-xr-x) mode and describe it.
- [`dev/color-contrast-checker`](src/dev/color-contrast-checker.ts) — WCAG 2 contrast ratio between two colours, with the AA and AAA verdicts for normal and large text.
- [`dev/color-converter`](src/dev/color-converter.ts) — Parses a colour written as HEX, RGB, HSL or HSV and returns it in all four notations.
- [`dev/color-palette-generator`](src/dev/color-palette-generator.ts) — Generate a harmonious palette from a base color given as a 3- or 6-digit hex string (with or without #).
- [`dev/credit-card-validator`](src/dev/credit-card-validator.ts) — Credit card number validation.
- [`dev/cron-expression-generator`](src/dev/cron-expression-generator.ts) — Parse a 5-field cron expression (or a @macro), returning a localized plain-language description and the next upcoming run times in local time.
- [`dev/css-border-radius-generator`](src/dev/css-border-radius-generator.ts) — Build a CSS border-radius value from four corner radii, collapsing to the shortest shorthand (the same top-left-first rules as margin/padding).
- [`dev/css-box-shadow-generator`](src/dev/css-box-shadow-generator.ts) — Build a CSS box-shadow value from one or more shadow layers.
- [`dev/css-flexbox-generator`](src/dev/css-flexbox-generator.ts) — Build a CSS flex container declaration block from a set of flexbox properties.
- [`dev/css-gradient-generator`](src/dev/css-gradient-generator.ts) — Build a CSS gradient string from a set of color stops and options.
- [`dev/css-grid-generator`](src/dev/css-grid-generator.ts) — CSS Grid container and item code generation.
- [`dev/css-minifier`](src/dev/css-minifier.ts) — Minifies CSS: drops comments and redundant whitespace and the last semicolon of each block, copies string literals verbatim, and reports the size saving.
- [`dev/cubic-bezier-easing-generator`](src/dev/cubic-bezier-easing-generator.ts) — Build a CSS cubic-bezier() timing function from two control points.
- [`dev/favicon-generator`](src/dev/favicon-generator.ts) — Favicon generator core — pure byte/string assembly, no DOM.
- [`dev/hash-generator`](src/dev/hash-generator.ts) — MD5, SHA-1, SHA-256 and SHA-512 hex digests of UTF-8 text: MD5 is implemented here, the SHA family uses Web Crypto. *Uses Web Crypto.*
- [`dev/html-entity-encoder`](src/dev/html-entity-encoder.ts) — Escape a string for safe embedding in HTML.
- [`dev/html-formatter`](src/dev/html-formatter.ts) — Pretty-prints and minifies HTML with a small tokenizer that keeps the contents of pre, textarea, script and style as written and warns about unclosed and stray tags.
- [`dev/image-to-base64`](src/dev/image-to-base64.ts) — Builds data URI, CSS and HTML snippets for a Base64-encoded image and computes the size overhead of the encoding.
- [`dev/ip-subnet-calculator`](src/dev/ip-subnet-calculator.ts) — IPv4 subnet calculator.
- [`dev/json-formatter`](src/dev/json-formatter.ts) — JSON pretty-printer, minifier and validator that never changes the data.
- [`dev/jwt-decoder`](src/dev/jwt-decoder.ts) — Decode a JSON Web Token without verifying its signature.
- [`dev/markdown-table-generator`](src/dev/markdown-table-generator.ts) — Markdown table generation and parsing.
- [`dev/number-base-converter`](src/dev/number-base-converter.ts) — Reads a whole non-negative number written in `fromBase` and returns it in all four bases, exactly (BigInt), up to MAX_BITS bits.
- [`dev/px-to-rem-converter`](src/dev/px-to-rem-converter.ts) — Convert a CSS length between px, rem, and em using the given root font size.
- [`dev/regex-tester`](src/dev/regex-tester.ts) — Runs a JavaScript regular expression against a text and lists every match with its position and capture groups.
- [`dev/sql-formatter`](src/dev/sql-formatter.ts) — Client-side SQL formatter and minifier.
- [`dev/text-encryption`](src/dev/text-encryption.ts) — Password-based text encryption using AES-256-GCM with PBKDF2-HMAC-SHA256 key derivation, built on the Web Crypto API. *Uses Web Crypto.*
- [`dev/text-to-binary`](src/dev/text-to-binary.ts) — Converts text to binary, one group of at least eight bits per Unicode code point, and binary back to text.
- [`dev/text-to-hex-converter`](src/dev/text-to-hex-converter.ts) — Encode text to space-separated, lowercase, two-digit UTF-8 hex bytes.
- [`dev/timestamp-converter`](src/dev/timestamp-converter.ts) — Converts between Unix timestamps (seconds or milliseconds) and dates, giving ISO, UTC, local and relative forms.
- [`dev/url-encoder`](src/dev/url-encoder.ts) — Percent-encoding and decoding of URL components (encodeURIComponent rules), with lone surrogates encoded as U+FFFD instead of throwing.
- [`dev/uuid-generator`](src/dev/uuid-generator.ts) — Version-4 UUIDs (RFC 9562) from cryptographically random bytes, in batches of up to MAX_UUIDS. *Uses Web Crypto.*
- [`dev/xml-formatter`](src/dev/xml-formatter.ts) — Pretty-prints, minifies and checks the well-formedness of XML with a small tokenizer (declarations, doctypes, comments, CDATA sections, elements and text).

### Math and calculators

- [`math/age-calculator`](src/math/age-calculator.ts) — Age from a birth date (YYYY-MM-DD) to a reference date (YYYY-MM-DD, default: today in the host's local time zone).
- [`math/aspect-ratio-calculator`](src/math/aspect-ratio-calculator.ts) — Aspect ratio arithmetic: reduces a width and height to a ratio, solves a missing dimension, and names the closest standard format.
- [`math/bmi-calculator`](src/math/bmi-calculator.ts) — Body mass index from weight and height, its adult weight category, and the healthy weight range for the height.
- [`math/body-fat-calculator`](src/math/body-fat-calculator.ts) — Body fat percentage by the US Navy tape method, with the Deurenberg BMI-based estimate for comparison and a category for the person's sex.
- [`math/burn-rate-calculator`](src/math/burn-rate-calculator.ts) — Project cash runway from a balance, monthly revenue and monthly spend.
- [`math/calorie-calculator`](src/math/calorie-calculator.ts) — Daily calorie needs: basal metabolic rate by the Mifflin-St Jeor equation, total energy expenditure for an activity level, and targets for losing or gaining weight.
- [`math/compound-interest-calculator`](src/math/compound-interest-calculator.ts) — Calculate compound growth of an investment or savings balance.
- [`math/date-calculator`](src/math/date-calculator.ts) — Adds or subtracts a years/months/weeks/days offset from a date.
- [`math/days-between-dates-calculator`](src/math/days-between-dates-calculator.ts) — Days between two dates, also as weeks, months and years plus days, with the number of weekdays and weekend days.
- [`math/discount-calculator`](src/math/discount-calculator.ts) — Sale price, discount amount, and savings for an original price and a percentage off.
- [`math/fraction-calculator`](src/math/fraction-calculator.ts) — Apply an arithmetic operation to two fraction strings.
- [`math/gpa-calculator`](src/math/gpa-calculator.ts) — Grade point average from course grades and credit hours on the 4.0 or 4.3 scale, with honors and AP/IB weighting, cumulative GPA and US letter-grade conversions.
- [`math/grade-calculator`](src/math/grade-calculator.ts) — Test grade from the number of questions and the number missed, with grading scales, an optional curve, a full grade chart and the score needed for each letter.
- [`math/loan-calculator`](src/math/loan-calculator.ts) — Calculate a fixed-rate amortizing loan.
- [`math/mortgage-calculator`](src/math/mortgage-calculator.ts) — Fixed-rate mortgage payment from home price, down payment, rate and term, with property tax, insurance, PMI and HOA, and the full amortization schedule.
- [`math/ovulation-calculator`](src/math/ovulation-calculator.ts) — Project ovulation and fertile windows forward from one known period date.
- [`math/pace-calculator`](src/math/pace-calculator.ts) — Running pace calculator: solves for pace, time or distance from the other two, in kilometres or miles, with split times.
- [`math/percentage-calculator`](src/math/percentage-calculator.ts) — Percentage calculations: X% of Y, what percent X is of Y, and the percentage change from X to Y.
- [`math/pregnancy-due-date-calculator`](src/math/pregnancy-due-date-calculator.ts) — Estimate a due date and the current stage of a pregnancy.
- [`math/salary-to-hourly-calculator`](src/math/salary-to-hourly-calculator.ts) — Converts pay between hourly, daily, weekly, biweekly, semi-monthly, monthly, quarterly and annual amounts, from hours and days worked per week and days off.
- [`math/sales-tax-calculator`](src/math/sales-tax-calculator.ts) — Sales tax both ways: the tax and total from a pre-tax price and rate, or the pre-tax price and tax contained in a total.
- [`math/scientific-calculator`](src/math/scientific-calculator.ts) — Evaluates calculator expressions with its own parser (no eval): arithmetic, powers, factorials, constants, trigonometry in degrees or radians, logarithms and roots.
- [`math/sleep-calculator`](src/math/sleep-calculator.ts) — Sleep-cycle arithmetic.
- [`math/square-footage-calculator`](src/math/square-footage-calculator.ts) — Square footage for rooms and plots: five shapes, mixed input units, a project total across any number of rooms, and a materials estimate with a waste allowance.
- [`math/statistics-calculator`](src/math/statistics-calculator.ts) — Descriptive statistics of a list of numbers: count, sum, mean, median, mode, range, variance and standard deviation, quartiles, interquartile range and outliers.
- [`math/time-card-calculator`](src/math/time-card-calculator.ts) — Weekly time card maths: punch pairs per day, unpaid breaks, punch rounding, and the two-tier overtime rule (daily threshold first, then weekly).
- [`math/time-duration-calculator`](src/math/time-duration-calculator.ts) — Time arithmetic: the duration between two clock times, shifting a time by hours and minutes, and adding or subtracting durations such as 1:30 or 2h 15m.
- [`math/tip-calculator`](src/math/tip-calculator.ts) — Tip and total for a bill, split between a number of people.
- [`math/triangle`](src/math/triangle.ts) — Solves a triangle from three known sides and angles (SSS, SAS, ASA, AAS, or SSA with its ambiguous case), or a right triangle from two sides.

### Converters

- [`convert/base64-to-image`](src/convert/base64-to-image.ts) — Turn a pasted Base64 string or data URI into an image-ready result.
- [`convert/csv-to-json-converter`](src/convert/csv-to-json-converter.ts) — Converts CSV to JSON: quoted fields, delimiter auto-detection (comma, semicolon, tab, pipe), a header row as object keys, and optional number and boolean typing.
- [`convert/currency-converter`](src/convert/currency-converter.ts) — Converts an amount between two currencies with a table of exchange rates against any common base currency, and reports invalid amounts and unknown currency codes.
- [`convert/html-to-markdown`](src/convert/html-to-markdown.ts) — Converts HTML to Markdown with a small built-in parser: headings, paragraphs, emphasis, strikethrough, code, links, images, quotes, lists, tables, rules and line breaks.
- [`convert/image-to-pdf`](src/convert/image-to-pdf.ts) — Client-side Image → PDF builder.
- [`convert/json-to-csv-converter`](src/convert/json-to-csv-converter.ts) — Converts a JSON array of objects (or one object) to CSV: a header row from the union of keys, quoting where needed, and nested values written as JSON.
- [`convert/json-to-yaml-converter`](src/convert/json-to-yaml-converter.ts) — Converts JSON to YAML, and a YAML subset back to JSON (block and flow collections, quoted and block scalars, comments; no anchors, aliases, tags or multiple documents).
- [`convert/morse-code-translator`](src/convert/morse-code-translator.ts) — Translates text to and from Morse code, with the International (Latin) and Russian alphabets, digits and punctuation, and detects whether an input is Morse.
- [`convert/number-to-words-converter`](src/convert/number-to-words-converter.ts) — Number → words converter for cheques, contracts, and invoices.
- [`convert/roman-numeral-converter`](src/convert/roman-numeral-converter.ts) — Roman numeral converter — standard additive/subtractive notation, 1 to 3999.
- [`convert/svg-to-png-converter`](src/convert/svg-to-png-converter.ts) — Prepares an SVG for rendering to PNG: checks the markup, reads its size from width, height or viewBox, and computes the output size; the caller draws it on a canvas.
- [`convert/unit-converter`](src/convert/unit-converter.ts) — Converts a value between units of length, weight, temperature and volume, returning the amount in every unit of the category.
- [`convert/url-slug-generator`](src/convert/url-slug-generator.ts) — Turns any text into a URL slug: Russian or Ukrainian Cyrillic is transliterated, diacritics are dropped, and every run of other characters becomes one separator.

### Utilities

- [`utility/barcode-generator`](src/utility/barcode-generator.ts) — Encodes Code 128, EAN-13 and UPC-A barcodes as bar patterns, checking lengths and check digits.
- [`utility/chess-clock`](src/utility/chess-clock.ts) — Chess clock engine — a pure, deterministic state machine.
- [`utility/click-speed-test`](src/utility/click-speed-test.ts) — Click speed test scoring: clicks per second over a run and the speed tier it falls into.
- [`utility/coin-flip`](src/utility/coin-flip.ts) — Fair coin flips and statistics (percentages, current streak) over a flip history.
- [`utility/dice-roller`](src/utility/dice-roller.ts) — Fair dice rolls (d4 to d20 or any number of sides) and statistics over a roll history.
- [`utility/emoji-picker`](src/utility/emoji-picker.ts) — Searchable emoji catalogue with English and Russian names and keywords, grouped like the Unicode emoji list, with skin-tone variants.
- [`utility/password-strength-checker`](src/utility/password-strength-checker.ts) — Estimates password strength: character pool and entropy, penalties for common passwords, sequences and repeats, a 0-4 score, crack time and hints.
- [`utility/pomodoro-timer`](src/utility/pomodoro-timer.ts) — Pomodoro timer state machine: phase lengths and the move from work to a short or long break after a set number of sessions.
- [`utility/qr-code-generator`](src/utility/qr-code-generator.ts) — QR code encoder (ISO/IEC 18004): chooses the version, adds Reed-Solomon error correction, places and masks the modules, and returns the module matrix.
- [`utility/random-name-picker`](src/utility/random-name-picker.ts) — Fair random draw of one or more winners from a list of names (no repeats).
- [`utility/random-number-generator`](src/utility/random-number-generator.ts) — Random integers in an inclusive range, optionally unique and sorted, drawn without modulo bias over ranges up to 2^53 wide.
- [`utility/random-password-generator`](src/utility/random-password-generator.ts) — Random passwords from selected character classes, drawn without modulo bias, with at least one character of every selected class, and an exact entropy estimate.
- [`utility/speech-to-text`](src/utility/speech-to-text.ts) — Transcript assembly and formatting for the Speech to Text tool.
- [`utility/spin-the-wheel`](src/utility/spin-the-wheel.ts) — Geometry, fair winner selection and share-link encoding for a spinning prize wheel.
- [`utility/stopwatch-timer`](src/utility/stopwatch-timer.ts) — Stopwatch and timer arithmetic: time formatting, lap splits and statistics, and countdown alarm timing.
- [`utility/text-to-speech`](src/utility/text-to-speech.ts) — Text-to-speech helpers: splits text into chunks the Web Speech API can speak, estimates the spoken duration, and sorts and picks voices.
- [`utility/timezone-converter`](src/utility/timezone-converter.ts) — Converts a time between time zones with Intl, daylight saving time included, and formats one instant across many zones.
- [`utility/typing-speed-test`](src/utility/typing-speed-test.ts) — Typing speed test logic: random English or Russian word lists, per-character comparison of typed words, and net and raw words per minute with accuracy.
- [`utility/what-is-my-screen-resolution`](src/utility/what-is-my-screen-resolution.ts) — Describes a screen from its size and device pixel ratio: physical resolution, aspect ratio, marketing name and estimated browser zoom.
- [`utility/what-is-my-user-agent`](src/utility/what-is-my-user-agent.ts) — Parses a User-Agent string into browser, engine, operating system and device type, and refines it with User-Agent Client Hints where the string is frozen.
- [`utility/word-cloud-generator`](src/utility/word-cloud-generator.ts) — Word cloud from a text: word weights without stop words, and a layout that places the words on an Archimedean spiral, biggest first, without overlaps.

### SEO

- [`seo/keyword-density-checker`](src/seo/keyword-density-checker.ts) — Keyword density of a text: the most frequent one-, two- and three-word phrases with their share of the text, and how often given target keywords occur.
- [`seo/meta-tag-generator`](src/seo/meta-tag-generator.ts) — Builds the HTML meta tags of a page (title, description, Open Graph and Twitter Card) and checks the title and description lengths.
- [`seo/robots-txt-generator`](src/seo/robots-txt-generator.ts) — Builds a robots.txt file from allow and disallow rules, a crawl delay, sitemap URLs and bots to block (AI crawlers among them), and reports problems with the rules.
- [`seo/serp-snippet-preview`](src/seo/serp-snippet-preview.ts) — SERP snippet preview.
- [`seo/utm-campaign-url-builder`](src/seo/utm-campaign-url-builder.ts) — Adds UTM campaign parameters to a URL and predicts the GA4 default channel group that the source and medium will be reported under.
- [`seo/xml-sitemap-generator`](src/seo/xml-sitemap-generator.ts) — Builds an XML sitemap (sitemaps.org protocol) from a list of URLs with optional lastmod, changefreq and priority, escaping and checking every URL.

### Audio and video

- [`media/audio-trimmer`](src/media/audio-trimmer.ts) — Audio trimmer / MP3 cutter.
- [`media/online-metronome`](src/media/online-metronome.ts) — Metronome timing maths.
- [`media/online-tone-generator`](src/media/online-tone-generator.ts) — Tone generator maths.
- [`media/voice-recorder`](src/media/voice-recorder.ts) — Voice recording helpers: picks a supported MediaRecorder audio type, computes waveform peaks, encodes PCM samples as a WAV file and formats the result.
- [`media/youtube-thumbnail-downloader`](src/media/youtube-thumbnail-downloader.ts) — Parses a YouTube video ID out of a pasted link or ID and builds the URLs of the video's thumbnails in every size.

### Device tests

- [`system/dead-pixel-test`](src/system/dead-pixel-test.ts) — Dead Pixel Test — the logic behind a full-screen colour cycler.
- [`system/gamepad-tester`](src/system/gamepad-tester.ts) — Gamepad test logic: the W3C Standard Gamepad layout, stick dead zones and drift, controller style detection and test progress.
- [`system/keyboard-tester`](src/system/keyboard-tester.ts) — Keyboard test logic: a full-size layout keyed by KeyboardEvent.code, key names, key-event descriptions, test progress, key chatter detection and AltGr handling.
- [`system/microphone-test`](src/system/microphone-test.ts) — Audio level of microphone samples (RMS, peak, dBFS, clipping, activity) and a summary of a microphone test session.
- [`system/webcam-test`](src/system/webcam-test.ts) — Describes a camera stream from its settings: resolution name, aspect ratio, megapixels, and the frame rate measured from frame timestamps.

## Not included

A few belun.app tools have no engine worth publishing: their module only wires a browser
API or a third-party library to the page. They stay in the site:

- `dev/webhook-tester` — display formatting for requests captured by belun.app's own webhook service.
- `image/image-compressor` — format table, MIME detection, size statistics and file names; the browser's canvas encodes.
- `image/image-converter` — a format table and the output file name.
- `image/image-cropper` — crop-rectangle clamping, aspect presets and the output file name.
- `image/image-resizer` — aspect-ratio arithmetic and the output file name.
- `image/image-to-text-ocr` — Tesseract.js settings for the page (the OCR itself is Tesseract), plus text clean-up.
- `media/screen-recorder` — MediaRecorder type choice, capture constraints and file naming.
- `utility/geolocation` — formatting of Geolocation API results and error messages.
- `utility/ip-address-lookup` — normalises the response of the geo-IP service the page calls, plus a flag emoji.
- `utility/online-notepad` — word and line counts and a file name for a text area.

## Notes and limits

- Module APIs follow what the belun.app pages need. Until 1.0, a minor version may change
  an API; see the [changelog](CHANGELOG.md).
- Roadmap: a unified result type for every module in 1.0.
- Many modules return English and Russian strings (`lang: "en" | "ru"`), because the site
  is published in both languages.
- `text/spell-checker` and `text/hunspell` take Hunspell `.aff`/`.dic` text from you; no
  dictionary is included (the tests use the `dictionary-en` and `dictionary-ru` packages).
- `pdf/pdf-to-jpg` parses PDF pages into a display list that your code draws on a canvas
  and encodes as JPEG; it draws text with standard fonts rather than the embedded font
  programs, and skips JPEG 2000, JBIG2 and CCITT images. Encrypted PDFs are rejected with
  an error.
- `dev/regex-tester` runs the pattern it is given. A user-supplied pattern can backtrack
  catastrophically, so run it in a Web Worker (or worker thread) that you terminate after
  a timeout.
- The engines are written for one user's own files in a browser. On a server, cap input
  sizes and run them with a timeout; see [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npm run lint
npm run typecheck
npm test            # or: npm run coverage
npm run build       # dist/: ES modules, .d.ts, declaration and source maps
npm run smoke       # imports the built package from plain Node
npm run check:package   # publint + Are The Types Wrong
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Dmitriy Semenkevich. Some modules contain third-party data; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
