# @skipstery/inline-measure

Browser text measurement without React or design-system dependencies.

```ts
import { measureInlineTextWidth } from "@skipstery/inline-measure";

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

The `@skipstery/inline-measure/multiline` entrypoint measures wrapped text:
`measureInlineTextMultilineWidth` returns the narrowest width at which `text`
fits in `lines` lines, using the same `accuracy` options.

## Install

The package is private and lives in GitHub Packages. Point bun at the registry
for the `@skipstery` scope:

```toml
# bunfig.toml
[install.scopes]
skipstery = { url = "https://npm.pkg.github.com/", token = "$GITHUB_TOKEN" }
```

Then install with a token that has `read:packages`
(`gh auth refresh -h github.com -s read:packages` adds the scope):

```sh
export GITHUB_TOKEN=$(gh auth token)
bun add @skipstery/inline-measure
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

## License

MIT for owner-authored code; see [LICENSE](LICENSE).
