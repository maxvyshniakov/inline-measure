import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compareRatios, compareReports } from "./report.mjs";

const DEFAULT_PAIRS = [
  ["docs/performance/before-0.4.0-chromium.json", "docs/performance/after-0.4.0-chromium.json"],
  ["docs/performance/before-0.4.0-firefox.json", "docs/performance/after-0.4.0-firefox.json"],
  ["docs/performance/before-0.4.0-webkit.json", "docs/performance/after-0.4.0-webkit.json"],
];

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const maxRatio = Number(option("--max-ratio", "1.1"));
const maxGeoMeanRatio = Number(option("--max-geomean", "1.05"));
const strict = args.includes("--strict");
if (!Number.isFinite(maxRatio) || maxRatio <= 0 || !Number.isFinite(maxGeoMeanRatio) || maxGeoMeanRatio <= 0) {
  throw new Error("Use positive numeric values for --max-ratio and --max-geomean");
}

const pairs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--pair" && args[i + 1]) {
    const [beforePath, afterPath] = args[i + 1].split(":");
    if (!beforePath || !afterPath) throw new Error("Use --pair before.json:after.json");
    pairs.push([beforePath, afterPath]);
    i += 1;
  }
}
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--max-ratio" || args[i] === "--max-geomean" || args[i] === "--pair") {
    i += 1;
    continue;
  }
  if (args[i].startsWith("--")) continue;
  positional.push(args[i]);
}
if (positional.length === 2) pairs.push([positional[0], positional[1]]);
else if (positional.length > 0) throw new Error("Usage: perf:check-ratios [before.json after.json] [--pair before:after ...] [--max-ratio 1.1] [--max-geomean 1.05] [--strict]");

const targetPairs = pairs.length ? pairs : DEFAULT_PAIRS;
let failed = false;

for (const [beforePath, afterPath] of targetPairs) {
  const baseline = JSON.parse(await readFile(resolve(beforePath), "utf8"));
  const current = JSON.parse(await readFile(resolve(afterPath), "utf8"));
  const result = compareRatios(current, baseline, { maxRatio, maxGeoMeanRatio });
  console.log(`\n## ${current.browser?.name ?? "unknown"} (${beforePath} -> ${afterPath})`);
  console.log(`${result.method}; geoMeanRatio=${Number.isFinite(result.geoMeanRatio) ? result.geoMeanRatio.toFixed(3) : "n/a"}x`);
  console.log("| Scenario | Before ms | After ms | Ratio | Change | Status |");
  console.log("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const row of result.scenarios) {
    if (row.beforeMs === undefined) continue;
    console.log(`| ${row.id} | ${row.beforeMs.toFixed(3)} | ${row.afterMs.toFixed(3)} | ${row.medianRatio.toFixed(3)}x | ${row.changePercent.toFixed(1)}% | ${row.ratioRegression ? "regression" : "pass"} |`);
  }
  const allErrors = [...result.errors];
  if (strict) {
    const strictResult = compareReports(current, baseline);
    allErrors.push(...strictResult.errors);
  }
  if (allErrors.length) {
    console.error(allErrors.join("\n"));
    failed = true;
  }
}

if (failed) process.exitCode = 1;
