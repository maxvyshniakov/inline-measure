import { readFile } from "node:fs/promises";
import { compareReports } from "./report.mjs";

const [baselinePath, currentPath, ...flags] = process.argv.slice(2);
if (!baselinePath || !currentPath) throw new Error("Usage: perf:report baseline.json current.json [--strict]");
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const current = JSON.parse(await readFile(currentPath, "utf8"));
const comparison = compareReports(current, baseline);
console.log(comparison.method);
console.log("| Scenario | Before ms | After ms | Change | Timing |");
console.log("| --- | ---: | ---: | ---: | --- |");
for (const row of comparison.scenarios) {
  if (row.beforeMs === undefined) continue;
  console.log(`| ${row.id} | ${row.beforeMs.toFixed(3)} | ${row.afterMs.toFixed(3)} | ${row.changePercent.toFixed(1)}% | ${row.timingRegression ? "regression" : "within gate"} |`);
}
if (comparison.errors.length) console.error(comparison.errors.join("\n"));
if (flags.includes("--strict") && comparison.errors.length) process.exitCode = 1;
