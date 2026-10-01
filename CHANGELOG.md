# @skipstery/inline-measure Changelog

Versions and release rules: [docs/VERSIONING.md](docs/VERSIONING.md).

## Unreleased

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
  github.com/skipstery/inline-measure. Install it by version instead of from a
  local archive; see the README.

## 0.1.0 - 2026-09-17

_First versioned release, assigned retroactively on 2026-09-25; `package.json` read 0.0.0 before._

### Changed

- Standalone package configuration, documentation and measurement demo.
