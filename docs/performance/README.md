# Browser correctness and performance

This harness runs Inline Measure directly through a local Vite server and
Playwright. It has no Data Grid, React, Storybook or package-build dependency.
Inter is a pinned local `@fontsource/inter` development fixture; requests never
depend on a font CDN. Install dependencies with `bun install` and install missing
Playwright Chromium/WebKit browsers with `bunx playwright install chromium webkit`.
Firefox uses installed Firefox through the `moz-firefox` BiDi channel; pass
`--bundled-firefox` explicitly to use Playwright's patched browser instead.

`bun run verify:browser` runs the correctness, font-loading and inline-box
checks in all three engines, each stopped with its process tree after 2 minutes
(`verify.browser` in `package-kit.config.mjs`); the commands below run one part:

```sh
bun run check:browser --browser chromium
bun run check:browser --browser firefox
bun run check:browser --browser webkit
bun run verify:fonts
bun run verify:boxes
bun run perf:test

# Capture the committed implementation without checking out or changing files.
bun run perf --ref HEAD --browser chromium --output artifacts/perf/baseline.json

# Capture working source and compare to the matching baseline.
bun run perf --browser chromium --baseline artifacts/perf/baseline.json --strict --output artifacts/perf/current.json
bun run perf:report artifacts/perf/baseline.json artifacts/perf/current.json --strict
```

Scripts own their machine leases: correctness uses one slot and timing captures
use all slots. Do not wrap these commands in another `slotfather` invocation.
The runner closes its browser, server and temporary source snapshot in `finally`.
`--source-dir /absolute/snapshot` serves an explicit source snapshot for staged
experiments; it must include `src` and have access to these dependencies. That
directory remains owned by the caller and is never deleted by the runner.

## Workload and timing

There are 80 scenarios: 72 for 50/200 strings, cold/warm cache state, fast/auto/exact,
and single-line labels/tabular currency and dates/repeated labels/interleaved
font styles/multiline 2/3 lines. Samples
contain 50 identical batch repetitions by default (`--iterations 50`), with
seven raw samples (`--samples 7`). Reported milliseconds are per batch, including
all 50/200 strings. This keeps the timed sample above clock quantization even
when a batch takes less than one millisecond.

Eight additional `badges`/`badges-repeated` scenarios measure 50/200 groups of
three badges with two outer 6px gaps and group padding/border. They use `fast`
and a cache local to one stable badge style: cold clears that label cache per
batch; warm primes it once and reuses it. Distinct groups have 150/600 unique
labels; repeated groups share six labels. `count` means groups, not labels.
Both the group timing oracle and the correctness-only command compare raw
group widths to native inline-flex geometry before any column minimum/clamp.
For example, `--scenario '^badges.*?/fast/200/(cold|warm)$'` captures four cases.

Cold means the package's tabular glyph cache is cleared before each batch;
warm primes an identical batch first. It does not mean a new browser process,
cold CPU caches, cold fonts, or library import time. Both phases include public
API computation and fresh per-call multiline preparation. Timing excludes DOM
oracle checks and instrumentation. Instrumented counters come from a separate
single batch and count Canvas measurements/state writes, computed-style reads,
rectangle reads, offset-width reads and scroll-width reads.

Raw JSON uses `schemaVersion: 1`, `package`, `revision`, `browser`, `environment`
and `scenarios`, each with `id`, `samplesMs`, `medianMs`, `p95Ms`, `counters` and
`correctness`. Source hashes distinguish uncommitted implementations at the
same revision. Environment identity includes hardware, OS, browser version,
viewport/DPR, font version, sample/iteration counts and a digest of the browser
workload. A different workload or environment is not a comparable baseline.

The DOM oracle uses independently styled native text to find a minimum integer
content width with greedy normal wrapping, plus the fixture's box width. It
checks both height and horizontal overflow; it does not reuse package wrapping
or measurement helpers. Exact single-line widths have integer rounding; the
fixture tolerance is 1px. Fast/auto remain approximate and their raw error
counts are retained. Strict comparisons permit changed outputs only when the
individual result is closer to the same DOM oracle. They reject worse accuracy,
incompatible reports and supported timing regressions; timing changes within
the measured noise are reported without a hard percentage cutoff. The strict
timing gate requires separated bootstrap 95% median intervals, with a gap larger
than the larger observed interquartile range or one timer quantum per batch.
An isolated large outlier cannot set this floor. Small differences remain
inconclusive; the report prints their raw milliseconds and percentage anyway.

Use `--scenario '^(mixed|multiline[23])/(fast|exact)/200/warm$'` for the six
representative mixed-style and multiline scenarios. Baseline and candidate
must use the same filter. `perf:capture` aliases `perf`. The separate delayed-font
check serves a local font with a real network delay and verifies both reusable
Canvas measurement and tabular calibration after the font loads.
It also holds an unrelated font request open while the required face loads,
asserting fresh raw widths while the global font status remains `loading`.

The retained before/canvas/final captures separate unchanged-output Canvas
optimization from accuracy changes that can add DOM layout work. All source
snapshots use the same harness files. Do not edit `scripts/perf/browser.mjs` or
its HTML while capturing a comparison pair: Vite HMR would alter the workload.

`before-canvas-*.json` and `canvas-*.json` retain the original 48-case isolated
experiment (harness version 1). Its WebKit single-line soft-hyphen oracle
accidentally enabled `text-wrap: wrap` after `white-space: pre`; those four
discrepancies were oracle errors, not package defects. Harness version 2 fixes
that and adds repeated/mixed workloads. Its `before-final-*` and `after-final-*`
reports are the final comparison pair; version 1 is not a compatible baseline
for version 2. Full final timings use Chromium; Firefox/WebKit use the six
representative scenarios and all engines run the complete native oracle.

`after-before-nearby-*` retain the accuracy-correct implementation before the
second neighboring integer proof was added. That bounded proof avoids a full
downward search when the Canvas estimate is only 1px too wide. A separate
three-node batching experiment (`neighbor-prototype-webkit.json`) showed no
supported gain and was rejected. The two-node nearby bracket
(`nearby-prototype-webkit.json`) kept every answer and reduced native reads;
the final implementation adopts it. These experiments retain their original
source hashes and raw samples.

The subsequent [WebKit exact-multiline repair](2026-11-06-webkit-exact.md)
retains that complete native proof while reusing a detached pair of probes.
It removes the remaining regression against 0.3.0 without caching answers or
loosening accuracy. The delayed-font check also verifies exact multiline
minimum widths while font loading overlaps an unrelated pending face.

## Coverage limits

These are synthetic label and cell workloads, not a Data Grid resize benchmark.
The native oracle reports real browser geometry but is not a full CSS layout
engine acceptance suite. Playwright WebKit is not installed Safari. Browser
fonts, language, emoji, font fallback and arbitrary OpenType features can still
differ; fast/auto approximations are not promoted to exact guarantees.

## Inline boxes and typography

`verify:boxes` checks raw single-line widths independently of Data Grid clamps.
It mirrors simple badge typography and box styles, then observes explicitly
unsupported text-only estimates for icons, nested weights, minimum widths,
OpenType numeric features and variable-font axes. The icon fixture also asserts
a label + cached constant composition; exact text is checked against native
geometry for all uniformly styled fixtures. A 1px tolerance covers integer
rounding of exact measurement. Unsupported fast fixtures are observations, not
accuracy guarantees. This is correctness evidence, not a throughput benchmark.
Five additional group fixtures cover 2–8 badges, repeated/distinct labels,
mixed sizes, gaps and each badge's own minimum width. They verify raw group
geometry and seven cache hits for eight identical labels, before column clamps.

The default font is the existing local Inter 400 fixture. To exercise actual
variable axes, pass `--font /absolute/path/to/InterVariable.woff2`; the report
records the font's SHA-256, source hash, harness hash, engine versions and raw
widths. This is a supplied test asset, not a runtime dependency on its owner.
`--ref <commit>` compares committed source without changing a checkout. Each
engine also saves a fixture screenshot next to the JSON output. For example:

```sh
bun run verify:boxes --font /path/to/InterVariable.woff2 --ref 6197258 --output artifacts/perf/boxes-before.json
bun run verify:boxes --font /path/to/InterVariable.woff2 --output artifacts/perf/boxes-after.json
```
