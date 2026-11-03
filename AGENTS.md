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
Everyday pushes go to `dev`, where only the pre-push hook runs: `sha=$(git rev-parse HEAD)`, then
Straylight's `~/straylight/tools/lane promote "$sha"`, which pushes the SHA and fast-forwards the local
branch; never push `HEAD` or a branch by name. A release pushes the same tip to both branches with
`STRAYLIGHT_LANE_REVIEW_START=manual ~/straylight/tools/lane promote "$sha" --ship`, so `origin/main` stays an ancestor of
`origin/dev`; Checks runs on `main` only, on the self-hosted homelab runner. Never force-push.
All default examples and documentation use English.
