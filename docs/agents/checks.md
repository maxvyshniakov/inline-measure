# Checks

## Focused
- Unit tests: `bunx vitest --config vitest.config.ts run src/<file>.test.ts`.
- Types: `bun run typecheck:fast` (the build config only), `bun run typecheck` (build and tests).
- Lint: `bun run lint`.
- Changelog: `bun run check:changelogs`.

## Full gate
- `bun run verify`: changelog, `package-kit check`, build, packed consumer, lint, tests and types, side by side, in about a
  minute. Steps are declared in `package-kit.config.mjs`.
- The pre-push hook runs it; run it by hand only to reproduce a hook failure.

## Heavy checks
- `bun run verify` and the pre-push hook take one slotfather slot themselves (`package-kit verify`, `package-kit pre-push`).
  Wrap any new heavy script as `package-kit heavy <slots> <command>`.

## Browser and visual
- `bun run verify:browser`: correctness (`scripts/perf/run.mjs --correctness`), font loading and inline boxes in
  Chromium, Firefox (the installed stable, over WebDriver BiDi) and WebKit, one script at a time behind one slot, each
  stopped with its process tree after 2 minutes. package-kit's release gate runs it after `verify --release`; plain
  `bun run verify` and the pre-push hook do not. `.github/workflows/check.yml` runs a separate `browser` job on
  GitHub-hosted `ubuntu-latest` that installs Playwright Chromium, Firefox (`--bundled-firefox`) and WebKit and runs
  `check:browser` for all three engines, `verify:fonts --bundled-firefox`, `verify:boxes --bundled-firefox`,
  `perf:test`, and `perf:check-ratios --strict`. Run `verify:browser` locally for changes under `src/` or
  `scripts/perf/`; `-- --keep-going` reports every engine.
- Independent native-DOM oracle and timing captures:
  [commands, setup, baselines and measurement policy](../performance/README.md).
- The package has no Storybook of its own. Consumer demos live in Data Grid;
  they are independent of this harness. Unit tests still run in happy-dom.

## Pins
- `@maxvyshniakov/package-kit` exact: each commit's gate is the kit its lockfile records. Raise it with each
  package-kit release, then `bunx package-kit hooks sync` and the workflow references (`package-kit check` fails until
  they match).
- Bun 1.4.4 (`packageManager`, package-kit's `actions/setup-bun`): 1.3.14 and older trust the compromised eMudhra
  chains. Keep the floor; it moves only with package-kit.
