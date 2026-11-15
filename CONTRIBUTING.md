# Contributing

Thanks for taking the time to help. Bug reports, failing inputs and small fixes are the
most useful contributions.

## Reporting a bug

Open an issue with the bug template. Include the module (for example
`@belun-app/tool-engines/convert/roman-numeral-converter`), the package version, the
runtime (browser and version, or Node version), the input, and what you expected. A
minimal input that reproduces the problem saves the most time.

Security problems: please do not open a public issue; see [SECURITY.md](SECURITY.md).

## Pull requests

1. Open an issue first for anything larger than a small fix, so we can agree on the
   approach before you spend time on it.
2. Keep the change focused on one module where possible.
3. Add or update tests next to the module (`src/<category>/<module>.test.ts`).
4. Run the checks locally:

   ```sh
   npm install
   npm run lint
   npm run typecheck
   npm test
   npm run build && npm run smoke
   ```

Ground rules for the code:

- No runtime dependencies. Dev dependencies only when there is no reasonable way around it.
- Engines are pure: no DOM access, no network, no global state. Anything a browser has to
  do (canvas, audio, file pickers) belongs to the caller.
- Code, comments, test names and messages are in English. Russian appears only as data
  (word forms, dictionaries, test inputs) for modules that support Russian.
- Results are plain objects. Error reporting is not uniform yet: depending on the module,
  bad input gives `{ ok: false, error, code }`, an `error` field next to the result, or
  `null`; each module documents its behaviour in its exported types. New code should
  return `{ ok: false, error, code }` rather than throw. A unified result type is planned
  for 1.0.
- Tests must not depend on elapsed time or on the host's locale or time zone; pass a
  clock, `locale` or `timeZone` option instead. Random output is tested through the
  injectable `rng` option.

## How changes reach this repository

The modules are developed together with [belun.app](https://belun.app), and this
repository is exported from that source. An accepted pull request is applied there and
comes back here with the next export; you are credited in the commit and in the
changelog. Dependabot updates of dev dependencies and of the pinned GitHub Actions are
merged here as usual; the export keeps newer pins and versions it finds in this
repository, so they are not rolled back.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
