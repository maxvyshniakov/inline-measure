# Inline boxes and overlapping font loads — 2026-11-05

Raw widths are checked before a host column's minimum/maximum clamp. A badge's
own CSS minimum is a separate component constraint and is recorded explicitly.

## Plain Badge and groups

An independent fixture mirrors the ordinary Badge font (Inter Variable at 12px,
weight 500), padding of 4px per side and borders of 1px per side. A read-only check of
Default Storybook 6073 also inspected 83 actual rendered Badge elements per engine,
after fonts.ready: optical sizing was `auto`, every badge was above its own
minimum and none was clipped. Maximum raw fast error was 0.01485px in
Chromium 156.0.8078.4,0.000008px in installed Firefox 159.0.1, and0.01483px in
Playwright WebKit 27.2. This is functional geometry evidence, not a Grid benchmark
or physical Safari acceptance.

`verify:boxes` has 19 independent fixtures. Five cover groups of 2–8 badges with
outer gaps, repeated/distinct labels, mixed sizes and short-label minima. Each
group compares native inline-flex width with the sum of label+badge boxes, gap
constants and group chrome. Maximum group error is 0.094px across the engines.
Eight identical labels reuse seven cached values. The icon fixture similarly
verifies one measured label plus fixed icon/gap/chrome constants.

Fast is a uniformly styled text-box approximation. Explicit feature/variation
axes, disabled optical sizing and nonzero word spacing can disagree with Canvas.
Neither fast nor exact text includes arbitrary nested content or icons. The
README now explains those bounds and the composition formula; no public API
change is needed. Normal Badge optical `auto` still uses fast.

## Exact text and truncation

Before this change, exact text omitted word spacing (6px error in the fixture)
and optical sizing (about 14px error at 32px with optical sizing disabled). Exact
single-line now copies both, exact multiline copies optical sizing, and tabular
style identity includes these properties. Exact text is within 1px of the native
oracle, including integer rounding.

Text Truncate independently selects its existing lazy DOM session for explicit
optical `none`, copies that style even with installed Inline Measure 0.3.0, and
invalidates its component width cache on optical-style changes. Its browser
oracle reproduced four overflows before the fix (middle/end at 160/220px), then
passed in Chromium, Firefox and WebKit. The separate Text Truncate commit owns
that source, tests and documentation.

## Required font loads while another face is pending

Inline Measure 0.3.1 invalidated at FontFaceSet.ready/loadingdone. A required face
could finish while an unrelated request kept global status=`loading`, leaving
old fallback tabular glyphs cached. The new native test deliberately compares
raw widths at unchanged global status:

| Engine | Stale auto | Native after required face | Fixed auto |
| --- | ---: | ---: | ---: |
| Chromium |117.68750 |116.46875 |116.46875 |
| Firefox |118.06668 |116.53334 |116.86667 |
| WebKit |118.12500 |116.46875 |116.81250 |

Both before and after statuses are `loading`; the blocker is awaited only after
the assertion. The fix observes pending FontFace.loaded promises, including faces
added during an existing cycle, and invalidates package Canvas/tabular caches on
individual completion. The loaded common fast path still returns immediately
for an already watched FontFaceSet. Only tabular auto scans pending faces during
loading. A unit regression also proves cached 14px becomes 18px while global
status stays `loading`. Consumers must still invalidate and recompute their own
saved widths after the relevant font completes.

## Performance scope and rejected prototype

The standalone harness now has 80 scenarios. Eight measure 50/200 groups of three
badges, distinct/repeated labels and cold/warm label caches. The native group
oracle also runs in `verify:browser`, raising that command to 79 correctness
cases per engine. Timings include group arithmetic and label caching; they do
not pretend a cache hit is a newly measured string.

A Canvas word-spacing prototype was rejected: an isolated Chromium A/B/B/A
capture reported cold 200 distinct groups at 1.853→1.963ms and 1.870→1.983ms
(about 6% slower). The first pair crossed the existing noise-aware strict gate;
the second did not. Warm/repeated scenarios were within the gate. Final fast
Canvas measurement functions retain the 0.3.1 implementation; word spacing is
supported by exact and documented as a limitation of fast. No speedup is claimed.
The requested final all-slot capture timed out while other suites held the Mac;
final candidate throughput remains unmeasured. Do not use the prototype's
candidate timings as the final implementation's timings.

## Evidence and checks

Raw native evidence: [before boxes](inline-boxes-2026-11-05/boxes-before.json),
[after boxes](inline-boxes-2026-11-05/boxes-after.json),
[before overlapping fonts](inline-boxes-2026-11-05/fonts-before.json),
[after overlapping fonts](inline-boxes-2026-11-05/fonts-after.json).
Rejected prototype: [A1](inline-boxes-2026-11-05/prototype-A1.json),
[B1](inline-boxes-2026-11-05/prototype-B1.json),
[A2](inline-boxes-2026-11-05/prototype-A2.json),
[B2](inline-boxes-2026-11-05/prototype-B2.json).

Inline Measure 67 unit/report tests, types, lint, changelog, build and packed
consumer pass. Native box 19 and general 79 fixtures pass in all three engines;
both delayed-font cycles pass in each engine. Each harness owns a temporary Vite
cache and removes it on completion, so parallel checks cannot race a shared
optimizer directory. Text Truncate 45 unit tests, 9 harness tests, types, lint,
changelog, build, packed consumer and all three native correctness checks pass.
No registry publication, release, Grid-core or Sid-Kit change is included.
