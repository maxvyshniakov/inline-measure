# Versions, changelog and publishing

The package owns its version and its `CHANGELOG.md`, and is published to
npmjs.org as `inline-measure` (it was `@maxvyshniakov/inline-measure` on GitHub
Packages up to 0.4.0).

## Rules

1. A change a consumer can notice adds an entry under `## Unreleased` in
   `CHANGELOG.md`, in the same change as the code. Consumer-visible means public
   API, exports, default behavior, accessibility contract, visual contract,
   packaging or dependencies. Internal refactors, tests and tooling need no entry.
2. Nothing reaches `main` with entries left under `## Unreleased`. Cut them into
   a version right before pushing:

   ```sh
   bun run release -- patch
   ```

   The script moves the entries under `## x.y.z - YYYY-MM-DD` and sets the
   version in `package.json`. `bun run verify -- --release` fails otherwise; CI
   runs it, and so does the pre-push hook for main.
3. Choose the level with semver. Before `1.0.0`:
   - **minor** for a breaking change (start its entry with `Breaking:`, or put
     it under `### Breaking`) and for a new entrypoint or broad default-behavior
     change;
   - **patch** for fixes and compatible additions.

   After `1.0.0`, breaking changes take a major version.
4. Depend on other `@maxvyshniakov` packages with `^x.y.z` ranges, so applications
   install one copy of each. Raise the floor when this package starts to need a
   newer version, and release this package with an entry saying so.
5. Keep entries consumer-facing: what changed for users of the package and what
   they must do, not which internal files moved.

## Publishing

After the release commit is on `origin/main`:

```sh
gh workflow run release-npm.yml --ref main
```

`.github/workflows/release-npm.yml` (package-kit's `docs/templates/release-npm.yml`) has two jobs:

1. `check` runs `bun run verify -- --release` on GitHub-hosted `ubuntu-latest`;
2. `publish`, only after `check` passes and only on `main`, is the one job granted `id-token: write` (npm trusted
   publishing and provenance) and `contents: write` (the tag). It runs `bun run release:publish`, which is
   `package-kit publish` (`@maxvyshniakov/package-kit`). In order, it:
   1. checks that HEAD is `origin/main` by SHA, the tree is clean, `## Unreleased` is empty and the tag is new;
   2. packs one archive, runs the packed-consumer check on it and uploads those bytes with
      `npm publish --access public --provenance`;
   3. waits until npmjs.org serves the version with its integrity and provenance attestation;
   4. pushes a `v<version>` tag.

`package-kit publish` refuses npmjs.org outside GitHub Actions. npmjs.org must trust the workflow file once, the
owner's step: `npm trust github inline-measure --file release-npm.yml --repo maxvyshniakov/inline-measure`.
If the tag push fails after publication, rerun the workflow; `bun run release:publish -- --resume` finishes it.

After publication and tag creation, the same command requests Data Grid's
**Update catalog dependencies** workflow. Its catalog and package dependencies
advance together only after Data Grid tests and every Storybook render/axe check
pass. Stable incompatible versions are included; Data Grid cuts and publishes
its own release when adopting them.

The publishing token needs access to Data Grid with Actions write permission
for the immediate notification. No additional cross-repository secret is stored.
If notification fails (including a repository-scoped Actions token), publication
still succeeds and Data Grid's daily registry check discovers the release.
Retry only the notification with `bunx package-kit notify`; do not
republish an existing version. Failed Data Grid checks leave its main and live
catalog unchanged and appear in its workflow log.

## Format

```md
# inline-measure Changelog

Versions and release rules: [docs/VERSIONING.md](docs/VERSIONING.md).

## Unreleased

## 0.2.0 - 2026-10-01

### Breaking

- Breaking: ...

### Changed

- ...
```

Sections, in this order and only when they have entries: Breaking, Added,
Changed, Deprecated, Removed, Fixed, Security. `bun run check:changelogs` checks
the layout and that `package.json` names the newest release.
