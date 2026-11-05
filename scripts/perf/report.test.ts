import { expect, it } from "vitest";
import { compareReports, summarize } from "./report.mjs";

it("calculates median and nearest-rank p95 without sorting the raw samples", () => {
  const samples = [5, 1, 4, 2, 3];
  expect(summarize(samples)).toEqual({ medianMs: 3, p95Ms: 5 });
  expect(samples).toEqual([5, 1, 4, 2, 3]);
});

const report = () => ({
  schemaVersion: 1,
  package: "inline-measure",
  browser: { name: "chromium", version: "1" },
  environment: { machine: "a" },
  scenarios: [{
    id: "one", samplesMs: [1, 2, 3], medianMs: 2, counters: {},
    correctness: { widths: [40], maxErrorPx: 0, underflows: 0 },
  }],
});

it("rejects incompatible environments before interpreting timing changes", () => {
  const baseline = report();
  baseline.environment.machine = "b";
  expect(compareReports(report(), baseline).errors).toEqual(["Incompatible environment"]);
});

it("rejects changed results even when their median becomes faster", () => {
  const current = report();
  current.scenarios[0]!.correctness.widths = [39];
  current.scenarios[0]!.medianMs = 1;
  expect(compareReports(current, report()).errors).toContain("Changed output: one");
});

it("reports spread and ratio without treating overlapping timings as a regression", () => {
  const current = report();
  current.scenarios[0]!.medianMs = 4;
  const comparison = compareReports(current, report());
  expect(comparison.errors).toEqual([]);
  expect(comparison.scenarios[0]).toMatchObject({ medianRatio: 2, baselineSpreadMs: 2 });
});

it("detects a timing regression when bootstrap median intervals separate beyond timer resolution", () => {
  const current = report();
  current.scenarios[0]!.samplesMs = [7, 7, 7, 7, 7];
  current.scenarios[0]!.medianMs = 7;
  expect(compareReports(current, report()).errors).toContain("Timing regression: one");
});

it("detects a sustained slowdown even when the baseline has one huge outlier", () => {
  const baseline = report();
  baseline.scenarios[0]!.samplesMs = [1, 1, 1, 1, 1, 1, 1000];
  baseline.scenarios[0]!.medianMs = 1;
  const current = report();
  current.scenarios[0]!.samplesMs = [10, 10, 10, 10, 10, 10, 10];
  current.scenarios[0]!.medianMs = 10;
  expect(compareReports(current, baseline).errors).toContain("Timing regression: one");
});

it("treats a separated median within observed robust repeat spread as inconclusive", () => {
  const baseline = report();
  baseline.scenarios[0]!.samplesMs = [0.95, 0.96, 0.97, 1, 1.03, 1.04, 1.05];
  baseline.scenarios[0]!.medianMs = 1;
  const current = report();
  current.scenarios[0]!.samplesMs = [1.06, 1.06, 1.06, 1.06, 1.06, 1.06, 1.06];
  current.scenarios[0]!.medianMs = 1.06;
  expect(compareReports(current, baseline).errors).toEqual([]);
});
