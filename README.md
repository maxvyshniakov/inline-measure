# @maxvyshniakov/inline-measure

Browser text measurement without React or design-system dependencies.

```ts
import { measureInlineTextWidth } from "@maxvyshniakov/inline-measure";

await document.fonts.ready;
const width = measureInlineTextWidth({ sourceElement: element, text: "Hello" });
```

`measureInlineTextWidth` returns the width in pixels that `text` would take
inside `sourceElement`: its font and text styles, plus its horizontal padding
and border. Measure after fonts are ready. `accuracy` picks the method:

- `"auto"` (default) measures with canvas and calibrates tabular numerals
  against the DOM.
- `"fast"` measures with canvas only.
- `"exact"` lays out a hidden node styled like the element, which costs a reflow.

The DOM-based methods need a browser. `measureInlineElementWidth` reads an
element's rendered width, and `createCanvasTextMeasurer` returns a reusable
`(text) => width` function for a font or computed style.

The `@maxvyshniakov/inline-measure/multiline` entrypoint measures wrapped text:
`measureInlineTextMultilineWidth` returns the narrowest width at which `text`
fits in `lines` lines, using the same `accuracy` options.
`fast` and `auto` use Canvas estimates and Unicode break opportunities;
`exact` verifies native wrapping and searches both narrower and wider integer
content widths. The native check includes horizontal overflow of long tokens.

Reusable Canvas measurers and tabular glyph calibration refresh after font
loading cycles. Load the required fonts before the first measurement so its
initial answer uses the intended font.

The `@maxvyshniakov/inline-measure/testing` entrypoint is for tests that fake
layout: `clearInlineMeasurementCacheForTests` forgets the tabular glyph widths
that `auto` accuracy calibrated against the DOM.

## Install

The package is private and lives in GitHub Packages. Point bun at the registry
for the `@maxvyshniakov` scope:

```toml
# bunfig.toml
[install.scopes]
maxvyshniakov = { url = "https://npm.pkg.github.com/", token = "$GITHUB_TOKEN" }
```

Then install with a token that has `read:packages`
(`gh auth refresh -h github.com -s read:packages` adds the scope):

```sh
export GITHUB_TOKEN=$(gh auth token)
bun add @maxvyshniakov/inline-measure
```

Inline Measure needs no React, CSS or Tailwind setup.

## Development

```sh
bun install
bun run verify
```

`bun run verify` is the push gate and the command CI runs: changelog, build,
packed-consumer check, lint, tests and types. `bun install` points Git at
`.githooks`, whose pre-push hook runs it on each pushed commit. Releases and
publishing follow [docs/VERSIONING.md](docs/VERSIONING.md).

Live examples are in the Data Grid Storybook, which renders Inline Measure and
Text Truncate demos alongside the grid.

The package also has an independent browser correctness and performance harness;
it runs directly against this source without a Data Grid build. See
[performance checks](docs/performance/README.md) for baselines and comparison commands.

## License

MIT for owner-authored code; see [LICENSE](LICENSE).
