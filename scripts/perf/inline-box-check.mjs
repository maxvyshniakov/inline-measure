import "./tmpdir.mjs";
import { createServer } from "vite";
import { chromium, firefox, webkit } from "playwright";
import { readFile, writeFile, mkdir, mkdtemp, symlink, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const engines = option("--browser", "chromium,firefox,webkit").split(",");
if (engines.some(engine => !["chromium", "firefox", "webkit"].includes(engine))) throw new Error("Unknown browser");
const fontPath = resolve(option("--font", "node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2"));
const output = resolve(option("--output", "artifacts/perf/inline-boxes.json"));
const font = await readFile(fontPath);
const ref = option("--ref");
let scratch;
if (ref) {
  scratch = await mkdtemp(resolve(tmpdir(), "inline-box-source-"));
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "src"], { encoding: "utf8" }).trim().split("\n");
  for (const file of files) {
    await mkdir(dirname(resolve(scratch, file)), { recursive: true });
    await writeFile(resolve(scratch, file), execFileSync("git", ["show", `${ref}:${file}`]));
  }
  await symlink(resolve("node_modules"), resolve(scratch, "node_modules"));
}
const viteCache = await mkdtemp(resolve(tmpdir(), "inline-box-vite-"));
const server = await createServer({ configFile: false, cacheDir: viteCache,
  server: { host: "127.0.0.1", port: 0, fs: { allow: [process.cwd(), ...(scratch ? [scratch] : [])] } },
  ...(scratch ? { resolve: { alias: { "/src": resolve(scratch, "src") } } } : {}),
  plugins: [{ name: "inline-box-font", configureServer(server) {
    server.middlewares.use("/box-font.woff2", (_request, response) => {
      response.setHeader("Content-Type", "font/woff2");
      response.end(font);
    });
  } }],
});
const reports = [];
try {
  await server.listen();
  for (const engine of engines) {
    const browser = await ({ chromium, firefox, webkit }[engine]).launch({ headless: true,
      ...(engine === "firefox" && !args.includes("--bundled-firefox") ? { channel: "moz-firefox" } : {}),
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`${server.resolvedUrls.local[0]}scripts/perf/index.html`);
      const cases = await page.evaluate(async () => {
        const { measureInlineTextWidth, getHorizontalBoxWidth } = await import("/src/index.ts");
        const font = new FontFace("Box Inter", 'url("/box-font.woff2")', { weight: "100 900" });
        document.fonts.add(font);
        await font.load();
        await document.fonts.ready;
        const fixtures = [
          { id: "badge-md", text: "In progress", style: "" },
          { id: "badge-sm", text: "Archived", style: "font-size:11px;padding-inline:3px" },
          { id: "badge-lg", text: "Published", style: "font-size:14px;padding-inline:6px" },
          { id: "weight-700", text: "In progress", style: "font-weight:700" },
          { id: "letter-spacing", text: "Archived", style: "letter-spacing:1.5px" },
          { id: "word-spacing", text: "In progress now", style: "word-spacing:3px", limitation: true },
          { id: "optical-none", text: "In progress", style: "font-size:32px;font-optical-sizing:none", limitation: true },
          { id: "variation-weight", text: "In progress", style: 'font-variation-settings:"wght" 850', limitation: true },
          { id: "variation-optical", text: "In progress", style: 'font-variation-settings:"opsz" 32', limitation: true },
          { id: "tabular", text: "1111 7777", style: "font-variant-numeric:tabular-nums", limitation: true },
          { id: "features", text: "1111 7777", style: 'font-feature-settings:"tnum" 1', limitation: true },
          { id: "icon", text: "Published", style: "padding-inline:3px", icon: true, limitation: true },
          { id: "nested-weight", text: "Published", style: "", nested: true, limitation: true },
          { id: "minimum", text: "1", style: "min-width:20px", limitation: true },
        ];
        const cases = fixtures.map(fixture => {
          const node = document.createElement("span");
          node.style.cssText = 'display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;white-space:pre;font:500 12px "Box Inter";padding:2px 4px;border:1px solid transparent;min-width:0;max-width:none;' + fixture.style;
          if (fixture.icon) {
            const icon = document.createElement("span");
            icon.style.cssText = "display:block;width:14px;height:14px;flex:none;background:#888";
            node.append(icon);
          }
          if (fixture.nested) {
            const label = document.createElement("b");
            label.textContent = fixture.text;
            node.append(label);
          } else node.append(fixture.text);
          document.body.append(node);
          const computed = getComputedStyle(node);
          const native = node.getBoundingClientRect().width;
          const fast = measureInlineTextWidth({ sourceElement: node, text: fixture.text, accuracy: "fast" });
          const exact = measureInlineTextWidth({ sourceElement: node, text: fixture.text, accuracy: "exact" });
          const auto = measureInlineTextWidth({ sourceElement: node, text: fixture.text });
          let composed;
          if (fixture.icon) {
            const label = document.createElement("span");
            label.textContent = fixture.text;
            node.lastChild.replaceWith(label);
            // Constants are read once per stable composition, not cloned per label.
            const constant = getHorizontalBoxWidth(node) + node.firstChild.getBoundingClientRect().width + parseFloat(computed.columnGap);
            composed = measureInlineTextWidth({ sourceElement: label, text: fixture.text, accuracy: "fast" }) + constant;
          }
          const exactSupported = !fixture.icon && !fixture.nested && fixture.id !== "minimum";
          const result = { ...fixture, native, fast, exact, auto, composed, errorPx: fast - native, exactErrorPx: exact - native,
            computed: Object.fromEntries(["font", "fontFamily", "fontWeight", "letterSpacing", "wordSpacing", "fontOpticalSizing", "fontVariationSettings", "fontFeatureSettings", "paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].map(key => [key, computed[key]])),
            passed: (Boolean(fixture.limitation) || Math.abs(fast - native) <= 1)
              && (!exactSupported || Math.abs(exact - native) <= 1)
              && (composed === undefined || Math.abs(composed - native) <= 1),
          };
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:20px;padding:7px";
          const title = document.createElement("span");
          title.style.cssText = "display:inline-block;width:180px;font:13px monospace";
          title.textContent = fixture.id;
          node.style.borderColor = "#aaa";
          row.append(title, node);
          document.body.append(row);
          return result;
        });
        for (const fixture of [
          { id: "badge-group-two", labels: ["Draft", "Published"], gap: 4 },
          { id: "badge-group-eight-repeated", labels: Array(8).fill("Published"), gap: 8 },
          { id: "badge-group-eight-distinct", labels: ["Design", "Review", "Approved", "Archived", "Draft", "Blocked", "Ready", "Published"], gap: 6 },
          { id: "badge-group-mixed-sizes", labels: ["Draft", "Published", "Archived"], sizes: [11, 12, 14], gap: 8 },
          { id: "badge-group-minimum", labels: ["1", "2", "3", "Draft"], gap: 4, minWidth: 20 },
        ]) {
          const group = document.createElement("span");
          group.style.cssText = `display:inline-flex;align-items:center;gap:${fixture.gap}px;width:max-content;padding:0 3px;border:1px solid #aaa;white-space:nowrap`;
          const badges = fixture.labels.map((text, index) => {
            const badge = document.createElement("span");
            badge.style.cssText = `display:inline-flex;flex:none;white-space:pre;font:500 ${fixture.sizes?.[index] ?? 12}px "Box Inter";padding:2px 4px;border:1px solid #aaa;box-sizing:border-box;min-width:${fixture.minWidth ?? 0}px`;
            badge.textContent = text;
            group.append(badge);
            return badge;
          });
          document.body.append(group);
          const cache = new Map();
          let cacheHits = 0;
          const pieces = badges.map((badge, index) => {
            const computed = getComputedStyle(badge);
            const key = JSON.stringify([fixture.labels[index], computed.font, computed.paddingLeft, computed.paddingRight, computed.borderLeftWidth, computed.borderRightWidth]);
            let raw = cache.get(key);
            if (raw === undefined) {
              raw = measureInlineTextWidth({ sourceElement: badge, text: fixture.labels[index], accuracy: "fast" });
              cache.set(key, raw);
            } else cacheHits += 1;
            const minimum = parseFloat(computed.minWidth) || 0;
            return { text: fixture.labels[index], raw, minimum, width: Math.max(minimum, raw), native: badge.getBoundingClientRect().width };
          });
          // Only the component's own badge minimum is applied. No column clamp.
          const gaps = parseFloat(getComputedStyle(group).columnGap) * (badges.length - 1);
          const constants = getHorizontalBoxWidth(group) + gaps;
          const fast = pieces.reduce((sum, piece) => sum + piece.width, constants);
          const native = group.getBoundingClientRect().width;
          cases.push({ ...fixture, native, fast, errorPx: fast - native, constants, pieces, cacheHits,
            passed: Math.abs(fast - native) <= 1 && pieces.every(piece => Math.abs(piece.width - piece.native) <= 1)
              && (fixture.id !== "badge-group-eight-repeated" || cacheHits === 7),
          });
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:20px;padding:7px";
          const title = document.createElement("span");
          title.style.cssText = "display:inline-block;min-width:240px;font:13px monospace";
          title.textContent = fixture.id;
          row.append(title, group);
          document.body.append(row);
        }
        return cases;
      });
      reports.push({ browser: { name: engine, version: browser.version() }, cases });
      await mkdir(dirname(output), { recursive: true });
      await page.screenshot({ path: output.replace(/\.json$/, `-${engine}.png`), fullPage: true });
      console.log(engine, JSON.stringify(cases.map(({ id, errorPx, exactErrorPx, passed }) => ({ id, errorPx, exactErrorPx, passed }))));
      if (cases.some(fixture => !fixture.passed)) process.exitCode = 1;
    } finally { await browser.close(); }
  }
  await mkdir(dirname(output), { recursive: true });
  const sourceHash = createHash("sha256");
  for (const file of ["src/index.ts", "src/internal.ts", "src/multiline.ts"]) sourceHash.update(await readFile(resolve(scratch ?? ".", file)));
  await writeFile(output, `${JSON.stringify({ schemaVersion: 1,
    revision: execFileSync("git", ["rev-parse", ref ?? "HEAD"], { encoding: "utf8" }).trim(),
    sourceSha256: sourceHash.digest("hex"),
    harnessSha256: createHash("sha256").update(await readFile("scripts/perf/inline-box-check.mjs")).digest("hex"),
    fontPath, fontSha256: createHash("sha256").update(font).digest("hex"), reports }, null, 2)}\n`);
} finally {
  await server.close();
  await rm(viteCache, { recursive: true, force: true });
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
