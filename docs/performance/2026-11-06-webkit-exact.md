# WebKit exact multiline regression repair

Inline Measure 0.3.2 (`44caa3b`) vs the fixed working implementation.
Fixed production-source SHA-256: `e67c91017f2cda46dce5ccdf79cc379de6de2ad44aba96fb073319d5d575b65d`.

## Diagnosis

A fresh WebKit A/B/B/A reproduced the original 0.3.0 → 0.3.2 regression: two-line 200-item batches increased by 21.8% / 22.1% in the two comparisons, and three-line batches by 25.7% / 25.9%. Both strict comparisons failed.

The native minimum-width proof added after 0.3.0 increases rectangle reads from 400 to 602 (two lines) / 651 (three lines) per 200-item batch. Canvas measurement counts are unchanged. Removing the neighboring-width checks would bring back wrong minimum widths. Adding CSS containment alone did not produce a supported gain.

The repair retains all native checks and removes repeated setup: one detached root and two probes per document, with a complete typography key to avoid unchanged style writes. Text and changed styles are refreshed on every call. No widths, heights, or final answers are cached. The nodes are removed in finally, failures release them, and nested measurements receive a separate temporary pair.

## Matched published-baseline comparison

All captures used every Slotfather slot exclusively, separate browser processes, A/B/B/A, nine raw samples and 20 batch repetitions per sample. There are eight exact cases (two/three lines × 50/200 items × cold/warm) and two 200-item fast controls per engine. The harness, fonts, hardware and environment fingerprints match within each pair. Values below are medians of the pooled 18 samples per state, milliseconds per 200-item warm batch. Improvements shown are confirmed in both independent pairs by the unchanged bootstrap/IQR/timer-quantum comparator.

| Engine | Lines | 0.3.2 ms | Fixed ms | Change |
| --- | ---: | ---: | ---: | ---: |
| webkit | 2 | 33.050 | 25.175 | -23.8% |
| webkit | 3 | 35.550 | 28.075 | -21.0% |
| chromium | 2 | 17.440 | 13.740 | -21.2% |
| chromium | 3 | 19.163 | 15.563 | -18.8% |
| firefox | 2 | 24.725 | 19.175 | -22.4% |
| firefox | 3 | 28.175 | 21.475 | -23.8% |

Both strict comparisons pass in every engine. All eight WebKit exact scenarios improve by 20–24%; the fast controls remain within noise. Some Firefox cold-case improvements are conclusive in only one pair and are not claimed as confirmed. Native rectangle/overflow-read counts remain unchanged from 0.3.2.

A separate full eight-case WebKit A/B/B/A against original 0.3.0 (`6d16493c`) also passes both strict comparisons: the original regression is removed. Historical original-version accuracy failures remain in its raw reports. These are headless browser workloads; Playwright WebKit is not installed Safari or a Data Grid resize run.

## Correctness and regression protection

- The published/fixed output arrays match exactly in all timed scenarios; the 79 native fixtures pass in all candidate captures.
- An independent 936-case before/after native suite covers Inter Variable 4.1, optical sizing auto/none, variable axes, numeric features, word/letter spacing, normal line height, text transforms, soft hyphens, CJK, emoji, RTL and iframe-owned documents. Zero oracle failures and zero changed answers.
- The maintained delayed-font check now includes exact multiline against an independent DOM minimum, both after fonts.ready and while an unrelated face keeps the global set loading. All three engines pass.
- The allocation regression test failed with 18 native elements for six calls against a bound of three, then passed. Unit coverage also checks changed text/font size, detached cleanup, nested measurements and recovery after native-read failure. 70 unit/report tests pass.

Raw reports, source snapshots, rejected prototype, hashes and reproducible scripts are retained outside the working tree at `~/.local/state/inline-webkit-exact-2026-11-06/`. The standalone harness itself was unchanged. To reproduce, use `bun run perf --browser webkit --samples 9 --iterations 20 --scenario "^multiline[23]/(exact/(50|200)/(cold|warm)|fast/200/warm)$"`, capturing committed 0.3.2 with `--ref 44caa3b` and working source without `--ref`, in A/B/B/A order. Compare each pair with `bun run perf:report <before> <after> --strict`.
