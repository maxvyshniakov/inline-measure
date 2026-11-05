import { measureInlineTextWidth, createCanvasTextMeasurer } from "/src/index.ts";
import { measureInlineTextMultilineWidth } from "/src/multiline.ts";
import { clearInlineMeasurementCacheForTests } from "/src/testing.ts";

const labels = [
  "Quarterly revenue", "Product information", "Assigned team member", "Date modified",
  "Available storage", "Привіт світе", "日本語の製品情報", "co\u00adoperation settings",
  "Office affinity final", "AVATAR To Wa", "A very long unbreakable_identifier_1234567890",
  "File size and transfer status",
];

function texts(kind, count) {
  return Array.from({ length: count }, (_, index) => kind === "tabular"
    ? index % 2 ? `2026-11-${String(index % 28 + 1).padStart(2, "0")}, 12:34:56` : `$${index + 11},234.50 (19.5%)`
    : kind === "repeated" ? labels[index % 6]
    : `${labels[index % labels.length]} ${index + 1}`);
}

function sourceFor(kind, style = 0) {
  const source = document.createElement("span");
  source.style.cssText = 'font: 14px "Probe Inter", Arial, sans-serif; line-height: 20px; padding: 0 3px; border: 1px solid transparent;';
  if (kind === "tabular") source.style.fontVariantNumeric = "tabular-nums";
  if (kind === "mixed") {
    source.style.font = ['14px "Probe Inter", Arial, sans-serif', '700 18px "Probe Inter", Arial, sans-serif', "small-caps 20px Georgia, serif"][style];
    if (style === 2) source.style.letterSpacing = "-0.08px";
  }
  document.body.append(source);
  return source;
}

function measure(config, source, text) {
  const input = { sourceElement: source, accuracy: config.accuracy, text };
  return config.kind.startsWith("multiline")
    ? measureInlineTextMultilineWidth({ ...input, lines: Number(config.kind.slice(-1)) })
    : measureInlineTextWidth(input);
}

// This oracle lays out native text; it neither calls the package's helpers nor
// reuses its breakpoint model. Timed measurement never includes oracle work.
function oracle(source, text, lines) {
  const node = document.createElement("span");
  node.style.cssText = source.style.cssText;
  Object.assign(node.style, {
    position: "absolute", visibility: "hidden", display: "inline-block",
    whiteSpace: lines ? "normal" : "pre", width: "max-content",
    minWidth: "0", maxWidth: "none", boxSizing: "content-box",
    hyphens: "manual", overflowWrap: "normal", wordBreak: "normal",
  });
  // text-wrap changes white-space's wrapping component. Setting wrap after pre
  // would accidentally turn the single-line oracle into pre-wrap in WebKit.
  if (lines) node.style.textWrap = "wrap";
  node.textContent = text;
  document.body.append(node);
  try {
    if (!lines) return node.getBoundingClientRect().width;
    node.style.padding = "0";
    node.style.border = "0";
    let hi = Math.ceil(node.getBoundingClientRect().width);
    let lo = -1;
    node.style.display = "block";
    while (hi - lo > 1) {
      const middle = Math.floor((hi + lo) / 2);
      node.style.width = `${middle}px`;
      if (node.getBoundingClientRect().height <= 20 * lines + 0.5 && node.scrollWidth <= middle) hi = middle;
      else lo = middle;
    }
    // Fixture's independent horizontal box: 2 * 3px padding + 2 * 1px border.
    return hi + 8;
  } finally {
    node.remove();
  }
}

function instrumentation() {
  const counters = { measureText: 0, canvasStateWrites: 0, computedStyle: 0, rectReads: 0, offsetReads: 0, scrollReads: 0 };
  const restore = [];
  function wrap(owner, key, counter) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (!descriptor) return;
    if (descriptor.value) Object.defineProperty(owner, key, { ...descriptor, value(...args) {
      counters[counter] += 1;
      return descriptor.value.apply(this, args);
    } });
    else Object.defineProperty(owner, key, { ...descriptor,
      ...(descriptor.get ? { get() { if (counter !== "canvasStateWrites") counters[counter] += 1; return descriptor.get.call(this); } } : {}),
      ...(descriptor.set ? { set(value) { if (counter === "canvasStateWrites") counters[counter] += 1; descriptor.set.call(this, value); } } : {}),
    });
    restore.push(() => Object.defineProperty(owner, key, descriptor));
  }
  wrap(CanvasRenderingContext2D.prototype, "measureText", "measureText");
  for (const key of ["font", "fontKerning", "fontStretch", "fontVariantCaps", "letterSpacing"]) {
    wrap(CanvasRenderingContext2D.prototype, key, "canvasStateWrites");
  }
  wrap(window, "getComputedStyle", "computedStyle");
  wrap(Element.prototype, "getBoundingClientRect", "rectReads");
  wrap(HTMLElement.prototype, "offsetWidth", "offsetReads");
  wrap(Element.prototype, "scrollWidth", "scrollReads");
  return { counters, restore: () => restore.reverse().forEach((undo) => undo()) };
}

async function ready() {
  await document.fonts.load('14px "Probe Inter"', "0123456789 Office affinity");
  await document.fonts.ready;
  if (!document.fonts.check('14px "Probe Inter"')) throw new Error("Probe Inter did not load");
}

window.runScenario = async (config, samples, iterations) => {
  await ready();
  const source = sourceFor(config.kind);
  const sources = config.kind === "mixed" ? [source, sourceFor("mixed", 1), sourceFor("mixed", 2)] : [source];
  const values = texts(config.kind, config.count);
  const batch = () => values.map((text, index) => measure(config, sources[index % sources.length], text));
  try {
    const samplesMs = [];
    for (let sample = 0; sample < samples; sample += 1) {
      clearInlineMeasurementCacheForTests();
      if (config.phase === "warm") batch();
      const start = performance.now();
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        if (config.phase === "cold") clearInlineMeasurementCacheForTests();
        batch();
      }
      samplesMs.push((performance.now() - start) / iterations);
    }
    clearInlineMeasurementCacheForTests();
    if (config.phase === "warm") batch();
    const trace = instrumentation();
    let widths;
    try { widths = batch(); } finally { trace.restore(); }
    const expected = values.map((text, index) => oracle(sources[index % sources.length], text, config.kind.startsWith("multiline") ? Number(config.kind.slice(-1)) : 0));
    const errors = widths.map((width, index) => width - expected[index]);
    return {
      id: `${config.kind}/${config.accuracy}/${config.count}/${config.phase}`,
      samplesMs,
      counters: trace.counters,
      correctness: {
        widths, expectedWidths: expected, maxErrorPx: Math.max(...errors.map(Math.abs)),
        underflows: errors.filter((error) => error < -1).length,
        overflows: errors.filter((error) => error > 1).length,
      },
    };
  } finally {
    sources.forEach((item) => item.remove());
  }

};

window.checkFixtures = async () => {
  await ready();
  const cases = [];
  for (const style of ["", "letter-spacing: -0.08px", "font-variant-numeric: tabular-nums", "font-kerning: none"]) {
    const source = sourceFor("regular");
    source.style.cssText += `;${style}`;
    for (const text of ["AVATAR To affinity office", "$1,234.50 (19.5%)", "2026-11-05, 12:34:56", "co\u00adoperation status", "identifier_".repeat(12)]) {
      for (const lines of [0, 2, 3]) {
        const expected = oracle(source, text, lines);
        const actual = lines
          ? measureInlineTextMultilineWidth({ sourceElement: source, text, lines, accuracy: "exact" })
          : measureInlineTextWidth({ sourceElement: source, text, accuracy: "exact" });
        const errorPx = actual - expected;
        cases.push({ style, text, lines, actual, expected, errorPx, passed: Math.abs(errorPx) <= 1 });
      }
    }
    source.remove();
  }
  for (const font of ["small-caps 20px Georgia", "condensed 20px Arial"]) {
    const source = sourceFor("regular");
    source.style.font = font;
    const text = "small caps and narrow text";
    const measure = createCanvasTextMeasurer(font);
    const actual = measure(text) + 8;
    createCanvasTextMeasurer("24px Arial")("interleaved");
    const repeat = measure(text) + 8;
    const expected = oracle(source, text, 0);
    cases.push({ style: font, text, lines: 0, actual, expected, errorPx: actual - expected,
      passed: Math.abs(actual - expected) <= 1 && actual === repeat });
    source.remove();
  }
  const wordSpaced = sourceFor("regular");
  wordSpaced.style.wordSpacing = "4px";
  const expected = oracle(wordSpaced, "a\u00a0b", 2);
  const actual = measureInlineTextMultilineWidth({ sourceElement: wordSpaced, text: "a\u00a0b", lines: 2, accuracy: "exact" });
  cases.push({ style: "word-spacing:4px", text: "a\u00a0b", lines: 2, actual, expected, errorPx: actual - expected, passed: actual === expected });
  wordSpaced.remove();
  // Interleave independent public measurers to detect leaked Canvas state.
  const spaced = sourceFor("regular");
  spaced.style.letterSpacing = "-0.08px";
  const a = createCanvasTextMeasurer(getComputedStyle(spaced));
  const b = createCanvasTextMeasurer('20px "Probe Inter"');
  const first = a("Office affinity");
  b("WIDE");
  const repeat = a("Office affinity");
  spaced.remove();
  return { cases, interleavedStable: first === repeat, fontsLoaded: document.fonts.check('14px "Probe Inter"') };
};

window.timerResolution = () => {
  let minimum = Infinity;
  let before = performance.now();
  for (let i = 0; i < 100000; i += 1) {
    const now = performance.now();
    if (now > before) minimum = Math.min(minimum, now - before);
    before = now;
  }
  return minimum;
};
