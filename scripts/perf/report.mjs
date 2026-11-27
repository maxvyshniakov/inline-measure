export const SCHEMA_VERSION = 1;

export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
  };
}

function medianInterval(samples) {
  let state = 173;
  const medians = [];
  for (let bootstrap = 0; bootstrap < 2000; bootstrap += 1) {
    const resampled = samples.map(() => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return samples[state % samples.length];
    });
    medians.push(summarize(resampled).medianMs);
  }
  medians.sort((a, b) => a - b);
  return [medians[50], medians[1949]];
}

function interquartileRange(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)];
}

// Compare only an identical workload, browser and machine. Timing noise is
// reported, never converted into an arbitrary hard percentage gate.
export function compareReports(current, baseline) {
  const errors = [];
  for (const key of ["schemaVersion", "package", "browser", "environment"]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(baseline[key])) {
      errors.push(`Incompatible ${key}`);
    }
  }
  if (errors.length) return { errors, scenarios: [] };
  const old = new Map(baseline.scenarios.map((scenario) => [scenario.id, scenario]));
  if (old.size !== current.scenarios.length) errors.push("Incompatible scenario count");
  const scenarios = current.scenarios.map((scenario) => {
    const previous = old.get(scenario.id);
    if (!previous) {
      errors.push(`Missing baseline scenario: ${scenario.id}`);
      return { id: scenario.id };
    }
    const widths = scenario.correctness.widths;
    const previousWidths = previous.correctness.widths;
    if (widths.length !== previousWidths.length || widths.some((width, index) => {
      if (Math.abs(width - previousWidths[index]) <= 0.001) return false;
      const expected = scenario.correctness.expectedWidths?.[index];
      return expected === undefined || Math.abs(width - expected) >= Math.abs(previousWidths[index] - expected);
    })) {
      errors.push(`Changed output: ${scenario.id}`);
    }
    if (scenario.correctness.maxErrorPx > previous.correctness.maxErrorPx + 0.001
      || scenario.correctness.underflows > previous.correctness.underflows) {
      errors.push(`DOM accuracy regression: ${scenario.id}`);
    }
    const spread = (report) => Math.max(...report.samplesMs) - Math.min(...report.samplesMs);
    const baselineIntervalMs = medianInterval(previous.samplesMs);
    const currentIntervalMs = medianInterval(scenario.samplesMs);
    const resolution = Math.max(current.timerResolutionMs ?? 0, baseline.timerResolutionMs ?? 0)
      / (current.environment.iterations ?? 1);
    const noiseFloorMs = Math.max(resolution, interquartileRange(previous.samplesMs), interquartileRange(scenario.samplesMs));
    const timingRegression = currentIntervalMs[0] > baselineIntervalMs[1] + noiseFloorMs;
    if (timingRegression) errors.push(`Timing regression: ${scenario.id}`);
    return {
      id: scenario.id,
      medianRatio: scenario.medianMs / previous.medianMs,
      beforeMs: previous.medianMs,
      afterMs: scenario.medianMs,
      changePercent: (scenario.medianMs / previous.medianMs - 1) * 100,
      baselineIntervalMs,
      currentIntervalMs,
      timingRegression,
      noiseFloorMs,
      baselineSpreadMs: spread(previous),
      currentSpreadMs: spread(scenario),
      countersBefore: previous.counters,
      countersAfter: scenario.counters,
    };
  });
  return { method: "Deterministic bootstrap 95% median intervals; separation must exceed observed IQR or one timer quantum per batch, whichever is larger", errors, scenarios };
}

// Compare two reports by per-scenario median ratio (afterMs / beforeMs) rather
// than absolute wall-clock times. Enforces identical workload/schema/package
// and DOM correctness while allowing an explicit maxRatio threshold.
export function compareRatios(current, baseline, options = {}) {
  const maxRatio = options.maxRatio ?? 1.1;
  const maxGeoMeanRatio = options.maxGeoMeanRatio ?? 1.05;
  const errors = [];
  for (const key of ["schemaVersion", "package"]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(baseline[key])) {
      errors.push(`Incompatible ${key}`);
    }
  }
  if (current.browser?.name !== baseline.browser?.name) {
    errors.push("Incompatible browser");
  }
  if (current.environment?.workloadDigest !== baseline.environment?.workloadDigest
    || current.environment?.harnessVersion !== baseline.environment?.harnessVersion
    || current.environment?.scenarioPattern !== baseline.environment?.scenarioPattern) {
    errors.push("Incompatible workload");
  }
  if (errors.length) {
    return { method: `Ratio gate (maxRatio=${maxRatio}, maxGeoMeanRatio=${maxGeoMeanRatio})`, errors, geoMeanRatio: Number.NaN, scenarios: [] };
  }
  const old = new Map(baseline.scenarios.map((scenario) => [scenario.id, scenario]));
  if (old.size !== current.scenarios.length) errors.push("Incompatible scenario count");
  let logSum = 0;
  let ratioCount = 0;
  const scenarios = current.scenarios.map((scenario) => {
    const previous = old.get(scenario.id);
    if (!previous) {
      errors.push(`Missing baseline scenario: ${scenario.id}`);
      return { id: scenario.id };
    }
    const widths = scenario.correctness.widths;
    const previousWidths = previous.correctness.widths;
    if (widths.length !== previousWidths.length || widths.some((width, index) => {
      if (Math.abs(width - previousWidths[index]) <= 0.001) return false;
      const expected = scenario.correctness.expectedWidths?.[index];
      return expected === undefined || Math.abs(width - expected) >= Math.abs(previousWidths[index] - expected);
    })) {
      errors.push(`Changed output: ${scenario.id}`);
    }
    if (scenario.correctness.maxErrorPx > previous.correctness.maxErrorPx + 0.001
      || scenario.correctness.underflows > previous.correctness.underflows) {
      errors.push(`DOM accuracy regression: ${scenario.id}`);
    }
    const medianRatio = scenario.medianMs / previous.medianMs;
    if (Number.isFinite(medianRatio) && medianRatio > 0) {
      logSum += Math.log(medianRatio);
      ratioCount += 1;
    }
    const ratioRegression = medianRatio > maxRatio;
    if (ratioRegression) {
      errors.push(`Ratio regression: ${scenario.id} (${medianRatio.toFixed(3)}x > ${maxRatio}x)`);
    }
    return {
      id: scenario.id,
      beforeMs: previous.medianMs,
      afterMs: scenario.medianMs,
      medianRatio,
      changePercent: (medianRatio - 1) * 100,
      ratioRegression,
    };
  });
  const geoMeanRatio = ratioCount > 0 ? Math.exp(logSum / ratioCount) : Number.NaN;
  if (Number.isFinite(geoMeanRatio) && geoMeanRatio > maxGeoMeanRatio) {
    errors.push(`Geometric mean ratio regression: ${geoMeanRatio.toFixed(3)}x > ${maxGeoMeanRatio}x`);
  }
  return {
    method: `Ratio gate (maxRatio=${maxRatio}, maxGeoMeanRatio=${maxGeoMeanRatio})`,
    errors,
    geoMeanRatio,
    scenarios,
  };
}
