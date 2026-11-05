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

Tabular calibration also refreshes when an individual font face loads while
other faces keep `document.fonts.status` at `loading`. Consumers that impose a
font timeout must still remeasure their own saved widths when the required face
becomes ready; package invalidation does not schedule a consumer update.

## Text boxes and composed content

For a plain badge or label, `fast` measures the supplied text using the source's
font, weight, kerning and letter spacing, then adds padding and
border. It returns a natural text-box width before CSS `min-width`, `max-width`
or an application's column clamp. A short badge can render wider because of its
own `min-width`; apply that constraint separately.

`fast` is approximate: Canvas cannot reproduce arbitrary
`font-feature-settings`, `font-variation-settings`, `font-optical-sizing` or
nonzero `word-spacing`.
Numeric OpenType features can change widths substantially; use `auto` for
tabular numeric text or `exact` for other feature/axis settings. `exact` copies
these settings to a native text node, with integer width rounding.

All text methods measure one uniformly styled string. Neither `fast` nor
`exact` measures child icons, nested styles, flex gaps, pseudo-elements or an
arbitrary component tree. For a simple icon + label layout, measure the label
from its own text element and add separately calibrated constants:

```ts
const constantWidth = getHorizontalBoxWidth(badge)
  + icon.getBoundingClientRect().width
  + parseFloat(getComputedStyle(badge).columnGap);
const width = measureInlineTextWidth({
  sourceElement: label,
  text: label.textContent ?? "",
  accuracy: "fast",
}) + constantWidth;
```

Import `getHorizontalBoxWidth` from the root entrypoint. This example assumes
one fixed-size icon, a pixel gap, no margins and no flex shrinking. Calibrate
constants once for a stable composition rather than cloning every label.
Invalidate them when icon dimensions, gap, padding or border change. Cache text
widths by text and its complete style (including feature/axis settings, optical
sizing and both spacings), and invalidate font-dependent values after font
loading cycles. The library refreshes its own caches; it does not invalidate a
consumer's saved widths or schedule another fit.

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
