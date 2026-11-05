# @maxvyshniakov/inline-measure Changelog

Versions and release rules: [docs/VERSIONING.md](docs/VERSIONING.md).

## Unreleased

### Fixed

- Font calibration refreshes when an individual font face finishes loading,
  even while an unrelated face keeps the global font set in `loading`.
- Exact single-line text preserves word spacing. Exact single-line and multiline
  probes also preserve optical sizing, and tabular calibration separates these
  style settings.

### Added

- A standalone inline-box correctness check compares raw native widths before
  minimum-width or column clamps, covering plain badge styles, composed icons,
  groups of badges and gaps, numeric features and variable-font axes with an
  optional supplied font. Eight performance scenarios cover distinct/repeated
  labels in 50/200 groups of three badges on cold and warm label caches.

## 0.3.1 - 2026-11-05

### Changed

- Repeated Canvas measurements reuse unchanged font and text settings. Multiline
  feasibility passes reuse whole shaped candidate widths by numeric position,
  avoiding repeated substring construction without summing isolated glyphs.

### Fixed

- A numeric font variant no longer makes the Canvas font shorthand invalid when
  the computed shorthand is empty; fast measurement selects the intended font.
- Cached Canvas font resolution and tabular glyph calibration refresh after
  asynchronous font loading, including browsers that omit `loadingdone`.
- Exact multiline measurement checks the neighboring integer and searches
  downward when native wrapping fits more narrowly than the Canvas estimate.

### Added

- An independent Chromium, Firefox and WebKit measurement harness records
  native-DOM correctness, cold/warm batch timings and deterministic work counts,
  with compatible-baseline comparisons and strict regression checking.

## 0.3.0 - 2026-11-03

### Breaking

- Breaking: `clearInlineMeasurementCacheForTests` moved from the root entrypoint
  to the new `@maxvyshniakov/inline-measure/testing` entrypoint, so the root
  API no longer carries a test-only hook. Import it from
  `@maxvyshniakov/inline-measure/testing` in tests that fake layout.

## 0.2.1 - 2026-10-19

### Fixed

- `auto` accuracy no longer under-measures tabular-number text that contains
  spaces or other whitespace, such as `78 × 79 × 76 cm`; each space used to
  count as 0px. `exact` accuracy also measures whitespace-only text, and the
  node from `createInlineTextMeasurementNode` (styled by
  `copyInlineTextMeasurementStyles`) is now `display: inline-block` instead of
  `inline-flex`.

## 0.2.0 - 2026-10-06

### Breaking

- Breaking: publish as `@maxvyshniakov/inline-measure` after the GitHub account rename. Replace the old package scope in imports and registry configuration.

## 0.1.3 - 2026-10-02

### Changed

- The README documents the default `auto` accuracy and each method, that
  measured widths include the element's horizontal padding and border, and the
  `/multiline` entrypoint.

## 0.1.2 - 2026-10-02

### Changed

- `linebreak` is a caret range (`^1.1.0`) instead of an exact version, so an
  app that also depends on it can share one copy with Inline Measure. The
  range starts at the version Inline Measure is tested with.

## 0.1.1 - 2026-10-01

### Changed

- Published to the private GitHub Packages registry from its own repository,
  github.com/maxvyshniakov/inline-measure. Install it by version instead of from a
  local archive; see the README.

## 0.1.0 - 2026-09-17

_First versioned release, assigned retroactively on 2026-09-25; `package.json` read 0.0.0 before._

### Changed

- Standalone package configuration, documentation and measurement demo.
