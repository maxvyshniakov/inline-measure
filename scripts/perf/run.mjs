import "./tmpdir.mjs";
import { createServer } from "vite";
import { chromium, firefox, webkit } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp, symlink, rm } from "node:fs/promises";
import { hostname, cpus, platform, release, arch, tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { summarize, compareReports, SCHEMA_VERSION } from "./report.mjs";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const name = option("--browser", "chromium");
const output = resolve(option("--output", `artifacts/perf/${name}.json`));
const samples = Number(option("--samples", "7"));
const iterations = Number(option("--iterations", "50"));
const scenarioPattern = option("--scenario", ".*");
const scenarioFilter = new RegExp(scenarioPattern);
if (!["chromium", "firefox", "webkit"].includes(name) || !Number.isInteger(samples) || samples < 3 || !Number.isInteger(iterations) || iterations < 1) {
  throw new Error("Use --browser chromium|firefox|webkit and --samples >= 3");
}
const ref = option("--ref");
const sourceDirectory = option("--source-dir");
if (ref && sourceDirectory) throw new Error("Use --ref or --source-dir, not both");
let scratch = sourceDirectory ? resolve(sourceDirectory) : undefined;
if (ref) {
  scratch = await mkdtemp(resolve(tmpdir(), "inline-measure-baseline-"));
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "src"], { encoding: "utf8" }).trim().split("\n");
  for (const file of files) {
    await mkdir(dirname(resolve(scratch, file)), { recursive: true });
    await writeFile(resolve(scratch, file), execFileSync("git", ["show", `${ref}:${file}`]));
  }
  await symlink(resolve("node_modules"), resolve(scratch, "node_modules"));
  // Historical refs before linebreak 2.0.0 use a default import; shim both
  // default and named exports against the installed linebreak package.
  await writeFile(
    resolve(scratch, ".linebreak-compat.mjs"),
    'import { LineBreaker } from "./node_modules/linebreak/src/linebreaker.js";\nexport { LineBreaker };\nexport default LineBreaker;\n',
  );
}
const viteCache = await mkdtemp(resolve(tmpdir(), "inline-measure-vite-"));
const server = await createServer({ configFile: false, cacheDir: viteCache,
  ...(scratch ? {
    resolve: {
      alias: [
        { find: "/src", replacement: resolve(scratch, "src") },
        ...(ref ? [{ find: /^linebreak$/, replacement: resolve(scratch, ".linebreak-compat.mjs") }] : []),
      ],
    },
  } : {}),
  server: { host: "127.0.0.1", port: 0, fs: { allow: [process.cwd(), ...(scratch ? [scratch] : [])] } },
});
let browser;
try {
  await server.listen();
  browser = await ({ chromium, firefox, webkit }[name]).launch({
    headless: true,
    ...(name === "firefox" && !args.includes("--bundled-firefox") ? { channel: "moz-firefox" } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(`${server.resolvedUrls.local[0]}scripts/perf/index.html`);
  await page.waitForFunction(() => typeof window.runScenario === "function");
  const fixtures = await page.evaluate(() => window.checkFixtures());
  const workloadHash = createHash("sha256");
  for (const file of ["scripts/perf/browser.mjs", "scripts/perf/index.html"]) workloadHash.update(await readFile(file));
  workloadHash.update(await readFile("node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2"));
  const sourceHash = createHash("sha256");
  for (const file of ["src/index.ts", "src/internal.ts", "src/multiline.ts", "src/multiline-internal.ts"]) {
    const filePath = resolve(scratch ?? ".", file);
    if (existsSync(filePath)) sourceHash.update(await readFile(filePath));
  }
  const report = {
    schemaVersion: SCHEMA_VERSION,
    package: "inline-measure",
    revision: execFileSync("git", ["rev-parse", ref ?? "HEAD"], { encoding: "utf8" }).trim(),
    dirty: !ref && Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
    sourceHash: sourceHash.digest("hex"),
    browser: { name, version: browser.version() },
    environment: {
      hostname: hostname(), platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model,
      viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
      font: "@fontsource/inter 5.3.0 latin 400", samples, iterations,
      harnessVersion: 2, scenarioPattern,
      workloadDigest: workloadHash.digest("hex"),
      timingMethod: "median of repeated batches; timing comparison method recorded in comparison.method",
      cachePolicy: "cold clears tabular glyph cache; warm primes one identical batch; timing excludes instrumentation and oracle",
    },
    fixtures,
    timerResolutionMs: await page.evaluate(() => window.timerResolution()),
    scenarios: [],
  };
  if (!args.includes("--correctness")) {
    for (const kind of ["regular", "tabular", "repeated", "mixed", "multiline2", "multiline3", "badges", "badges-repeated"]) {
      for (const accuracy of ["fast", "auto", "exact"]) {
        if (kind.startsWith("badges") && accuracy !== "fast") continue;
        for (const count of [50, 200]) {
          for (const phase of ["cold", "warm"]) {
            if (!scenarioFilter.test(`${kind}/${accuracy}/${count}/${phase}`)) continue;
            const scenario = await page.evaluate(({ config, samples, iterations }) => window.runScenario(config, samples, iterations), { config: { kind, accuracy, count, phase }, samples, iterations });
            Object.assign(scenario, summarize(scenario.samplesMs));
            report.scenarios.push(scenario);
            process.stdout.write(`${scenario.id}: ${scenario.medianMs.toFixed(2)} ms\n`);
          }
        }
      }
    }
  }
  if (option("--baseline")) {
    const baseline = JSON.parse(await readFile(resolve(option("--baseline")), "utf8"));
    report.comparison = compareReports(report, baseline);
    if (args.includes("--strict") && report.comparison.errors.length) process.exitCode = 1;
  } else if (args.includes("--strict")) throw new Error("--strict requires --baseline; existing DOM discrepancies need a recorded baseline");
  if (!fixtures.interleavedStable || !fixtures.fontsLoaded || fixtures.cases.some((fixture) => !fixture.passed)) process.exitCode = 1;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${output}`);
  console.log(`DOM fixture discrepancies >1px: ${fixtures.cases.filter((fixture) => Math.abs(fixture.errorPx) > 1).length}/${fixtures.cases.length}`);
  if (report.comparison?.errors.length) console.error(report.comparison.errors.join("\n"));
} finally {
  await browser?.close();
  await server.close();
  await rm(viteCache, { recursive: true, force: true });
  if (ref && scratch) await rm(scratch, { recursive: true, force: true });
}
