# Inline Measure

Browser text measurement. It must not depend on React, Sid-Kit or Data Grid.
Application labels, routes and fetching stay outside the package.

The package is `inline-measure` on npmjs.org, published with provenance from
`.github/workflows/release-npm.yml` as part of a release (docs/VERSIONING.md). Changing the
repository's visibility, a publication or enabling Pages needs explicit authorization.
Installing needs no token.

Behavior changes need focused tests. Public contracts need matching README and
changelog entries under `## Unreleased`; cut them into a version with
`bun run release -- <patch|minor|major>` right before pushing to main.
All default examples and documentation use English.

- Pushing, CI, releases and publishing: [docs/agents/publishing.md](docs/agents/publishing.md).
- Checks, the `bun run verify` gate and pins: [docs/agents/checks.md](docs/agents/checks.md).
- The gate, the pre-push hook, release and publish come from `@maxvyshniakov/package-kit`; this repository declares
  its verify steps in `package-kit.config.mjs`.
