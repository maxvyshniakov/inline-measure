# Inline Measure

Browser text measurement. It must not depend on React, Sid-Kit or Data Grid.
Application labels, routes and fetching stay outside the package.

The repository and the package are private; the package is published to the private
GitHub Packages registry as part of a release (docs/VERSIONING.md). Making either
public, publishing to npm or enabling Pages needs explicit authorization.

Behavior changes need focused tests. Public contracts need matching README and
changelog entries under `## Unreleased`; cut them into a version with
`bun run release -- <patch|minor|major>` right before pushing to main.
`bun run verify` is the push gate and the command CI runs; the pre-push hook runs it.
All default examples and documentation use English.
