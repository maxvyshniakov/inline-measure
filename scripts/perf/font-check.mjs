import { createServer } from "vite";
import { chromium, firefox, webkit } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const requested = args[args.indexOf("--browser") + 1];
const engines = args.includes("--browser") ? [requested] : ["chromium", "firefox", "webkit"];
const outputIndex = args.indexOf("--output");
const output = resolve(outputIndex < 0 ? "artifacts/perf/font-loading.json" : args[outputIndex + 1]);
const font = await readFile("node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2");
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "late-font-fixture", configureServer(server) {
    server.middlewares.use("/late-inter.woff2", async (_request, response) => {
      // A real asynchronous load, unlike an immediately resolved local() font.
      await new Promise((resolve) => setTimeout(resolve, 100));
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
      ...(engine === "firefox" ? { channel: "moz-firefox" } : {}),
    });
    try {
      const page = await browser.newPage();
      await page.goto(`${server.resolvedUrls.local[0]}scripts/perf/index.html`);
      const result = await page.evaluate(async () => {
        const { createCanvasTextMeasurer, measureInlineTextWidth } = await import("/src/index.ts");
        await document.fonts.ready;
        const source = document.createElement("span");
        source.style.cssText = 'font: 14px LateProbe, monospace; display: inline-block; white-space: pre; font-variant-numeric: tabular-nums;';
        source.textContent = "1111 2222 3333";
        document.body.append(source);
        const canvas = createCanvasTextMeasurer(getComputedStyle(source));
        const beforeCanvas = canvas(source.textContent);
        const beforeAuto = measureInlineTextWidth({ sourceElement: source, text: source.textContent });
        const events = { loading: 0, loadingdone: 0 };
        document.fonts.addEventListener("loading", () => { events.loading += 1; });
        document.fonts.addEventListener("loadingdone", () => { events.loadingdone += 1; });
        const face = new FontFace("LateProbe", 'url("/late-inter.woff2")');
        document.fonts.add(face);
        await document.fonts.load("14px LateProbe", source.textContent);
        await document.fonts.ready;
        const afterCanvas = canvas(source.textContent);
        const afterAuto = measureInlineTextWidth({ sourceElement: source, text: source.textContent });
        const native = source.getBoundingClientRect().width;
        source.style.fontVariantNumeric = "normal";
        const plainNative = source.getBoundingClientRect().width;
        return { beforeCanvas, beforeAuto, afterCanvas, afterAuto, native, plainNative, events,
          passed: events.loading > 0 && Math.abs(afterCanvas - beforeCanvas) > 1 && Math.abs(afterCanvas - plainNative) < 1 && Math.abs(afterAuto - native) < 1,
        };
      });
      reports.push({ browser: { name: engine, version: browser.version() }, ...result });
      if (!result.passed) process.exitCode = 1;
    } finally { await browser.close(); }
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schemaVersion: 1, reports }, null, 2)}\n`);
  console.log(JSON.stringify(reports));
} finally { await server.close(); }
