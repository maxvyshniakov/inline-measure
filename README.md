# @skipstery/inline-measure

Browser text measurement without React or design-system dependencies.

```ts
import { measureInlineTextWidth } from "@skipstery/inline-measure";
const width = measureInlineTextWidth({ sourceElement: element, text: "Hello", accuracy: "exact" });
```

Measure after fonts are ready. `exact` uses a hidden DOM node, `fast` uses canvas, and `auto` handles tabular numeric text with calibration. DOM-based methods require a browser. The `/multiline` entrypoint exposes line measurement utilities.

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
