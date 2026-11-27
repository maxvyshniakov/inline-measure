import "./tmpdir.mjs";
import { createServer } from "vite";
import { chromium, firefox, webkit } from "playwright";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const requested = args[args.indexOf("--browser") + 1];
const engines = args.includes("--browser") ? [requested] : ["chromium", "firefox", "webkit"];
const outputIndex = args.indexOf("--output");
const output = resolve(outputIndex < 0 ? "artifacts/perf/font-loading.json" : args[outputIndex + 1]);
const font = await readFile("node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2");
const viteCache = await mkdtemp(resolve(tmpdir(), "inline-font-vite-"));
const server = await createServer({ configFile: false, cacheDir: viteCache, server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "late-font-fixture", configureServer(server) {
    server.middlewares.use("/late-inter.woff2", async (request, response) => {
      // A real asynchronous load, unlike an immediately resolved local() font.
      await new Promise((resolve) => setTimeout(resolve, request.url.includes("blocker") ? 1000 : 100));
      response.setHeader("Content-Type", "font/woff2");
      response.end(font);
    });
  } }],
});
const reports = [];
try {
  await server.listen();
  for (const engine of engines) {
    console.log(`Checking delayed font in ${engine}`);
    const browser = await ({ chromium, firefox, webkit }[engine]).launch({ headless: true,
      ...(engine === "firefox" && !args.includes("--bundled-firefox") ? { channel: "moz-firefox" } : {}),
    });
    try {
      const page = await browser.newPage();
      await page.goto(`${server.resolvedUrls.local[0]}scripts/perf/index.html`);
      const result = await page.evaluate(async () => {
        const { createCanvasTextMeasurer, measureInlineTextWidth } = await import("/src/index.ts");
        const { measureInlineTextMultilineWidth } = await import("/src/multiline.ts");
        const multiline = source => measureInlineTextMultilineWidth({
          sourceElement: source, text: source.textContent, lines: 2, accuracy: "exact",
        });
        // Independent native minimum, including normal line-height and numeric
        // features. No package probes or Canvas estimates participate here.
        const nativeMultiline = source => {
          const probe = source.cloneNode(true);
          Object.assign(probe.style, {
            position: "absolute", display: "block", whiteSpace: "normal",
            width: "max-content", padding: "0", border: "0",
            hyphens: "manual", overflowWrap: "normal", wordBreak: "normal",
          });
          document.body.append(probe);
          try {
            const baseline = probe.getBoundingClientRect();
            let lo = -1;
            let hi = Math.ceil(baseline.width);
            while (hi - lo > 1) {
              const middle = Math.floor((lo + hi) / 2);
              probe.style.width = `${middle}px`;
              if (probe.getBoundingClientRect().height <= baseline.height * 2 + 0.5
                && probe.scrollWidth <= middle) hi = middle;
              else lo = middle;
            }
            return hi;
          } finally { probe.remove(); }
        };
        await document.fonts.ready;
        const source = document.createElement("span");
        source.style.cssText = 'font: 14px LateProbe, monospace; display: inline-block; white-space: pre; font-variant-numeric: tabular-nums;';
        source.textContent = "1111 2222 3333 4444 5555";
        document.body.append(source);
        const canvas = createCanvasTextMeasurer(getComputedStyle(source));
        const beforeCanvas = canvas(source.textContent);
        const beforeAuto = measureInlineTextWidth({ sourceElement: source, text: source.textContent });
        const beforeMultiline = multiline(source);
        const events = { loading: 0, loadingdone: 0 };
        document.fonts.addEventListener("loading", () => { events.loading += 1; });
        document.fonts.addEventListener("loadingdone", () => { events.loadingdone += 1; });
        const face = new FontFace("LateProbe", 'url("/late-inter.woff2")');
        document.fonts.add(face);
        await document.fonts.load("14px LateProbe", source.textContent);
        await document.fonts.ready;
        const afterCanvas = canvas(source.textContent);
        const afterAuto = measureInlineTextWidth({ sourceElement: source, text: source.textContent });
        const afterMultiline = multiline(source);
        const nativeMultilineWidth = nativeMultiline(source);
        const native = source.getBoundingClientRect().width;
        source.style.fontVariantNumeric = "normal";
        const plainNative = source.getBoundingClientRect().width;
        const firstCycle = { beforeCanvas, beforeAuto, afterCanvas, afterAuto, native, plainNative, events,
          beforeMultiline, afterMultiline, nativeMultilineWidth,
          passed: events.loading > 0 && Math.abs(afterCanvas - beforeCanvas) > 1 && Math.abs(afterCanvas - plainNative) < 1 && Math.abs(afterAuto - native) < 1
            && beforeMultiline !== afterMultiline && afterMultiline === nativeMultilineWidth,
        };
        const overlapping = document.createElement("span");
        overlapping.style.cssText = 'font:14px OverlappingProbe,monospace;display:inline-block;white-space:pre;font-variant-numeric:tabular-nums';
        overlapping.textContent = "1111 2222 3333 4444 5555";
        document.body.append(overlapping);
        const requiredFace = new FontFace("OverlappingProbe", 'url("/late-inter.woff2?required=1")');
        const blockerFace = new FontFace("UnrelatedProbe", 'url("/late-inter.woff2?blocker=1")');
        document.fonts.add(requiredFace);
        document.fonts.add(blockerFace);
        const blockerLoaded = blockerFace.load();
        const statusBefore = document.fonts.status;
        const overlappingCanvas = createCanvasTextMeasurer(getComputedStyle(overlapping));
        const fallbackCanvas = overlappingCanvas(overlapping.textContent);
        const fallbackAuto = measureInlineTextWidth({ sourceElement: overlapping, text: overlapping.textContent });
        const fallbackMultiline = multiline(overlapping);
        await requiredFace.load();
        // Deliberately do not await fonts.ready: another face is still pending.
        const statusAfter = document.fonts.status;
        const requiredCanvas = overlappingCanvas(overlapping.textContent);
        const requiredAuto = measureInlineTextWidth({ sourceElement: overlapping, text: overlapping.textContent });
        const requiredMultiline = multiline(overlapping);
        const requiredNativeMultiline = nativeMultiline(overlapping);
        const requiredNative = overlapping.getBoundingClientRect().width;
        overlapping.style.fontVariantNumeric = "normal";
        const requiredPlainNative = overlapping.getBoundingClientRect().width;
        const overlappingCycle = { statusBefore, statusAfter, fallbackCanvas, fallbackAuto,
          requiredCanvas, requiredAuto, requiredNative, requiredPlainNative,
          fallbackMultiline, requiredMultiline, requiredNativeMultiline,
          passed: statusBefore === "loading" && statusAfter === "loading"
            && Math.abs(fallbackAuto - requiredNative) > 1
            && Math.abs(requiredAuto - requiredNative) < 1
            && Math.abs(requiredCanvas - requiredPlainNative) < 1
            && fallbackMultiline !== requiredMultiline && requiredMultiline === requiredNativeMultiline,
        };
        await blockerLoaded;
        await document.fonts.ready;
        return { firstCycle, overlappingCycle, passed: firstCycle.passed && overlappingCycle.passed };
      });
      reports.push({ browser: { name: engine, version: browser.version() }, ...result });
      if (!result.passed) process.exitCode = 1;
    } finally { await browser.close(); }
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schemaVersion: 1, reports }, null, 2)}\n`);
  console.log(JSON.stringify(reports));
} finally {
  await server.close();
  await rm(viteCache, { recursive: true, force: true });
}
