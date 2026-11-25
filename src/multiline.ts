import {
  applyTextTransform,
  collapseWhitespace,
  computeMultilineMinContentWidth,
  getHorizontalBoxWidthFromComputed,
  measureCanvasTextFromComputed,
  measureCanvasTextWithStyle,
  prepareWrapText,
  resolveCanvasStyleFromComputed,
  trimTrailingCollapsibleSpaces,
  watchFontLoads,
} from "./internal.js";
import {
  createInlineMeasurementRoot,
  type InlineMeasureAccuracy,
} from "./index.js";

export interface InlineTextMultilineMeasureInput {
  accuracy?: InlineMeasureAccuracy;
  sourceElement: HTMLElement;
  text: string;
  lines: number;
}

// Indices 1..WRAP_FONT_SHORTHAND_RESET_END are reset by assigning `style.font`.
const WRAP_FONT_SHORTHAND_RESET_END = 13;

const WRAP_TEXT_STYLE_PROPERTIES = [
  "font",
  "fontFamily",
  "fontFeatureSettings",
  "fontKerning",
  "fontOpticalSizing",
  "fontSize",
  "fontStretch",
  "fontStyle",
  "fontVariant",
  "fontVariantCaps",
  "fontVariantNumeric",
  "fontVariationSettings",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
] as const satisfies ReadonlyArray<keyof CSSStyleDeclaration>;

function createMultilineWrapProbe(
  ownerDocument: Document,
  styleValues: readonly string[],
  text: string,
  width: string,
) {
  const probe = ownerDocument.createElement("span");
  probe.textContent = text;
  const style = probe.style;
  style.borderLeftWidth = "0";
  style.borderRightWidth = "0";
  style.boxSizing = "border-box";
  style.display = "block";
  style.hyphens = "manual";
  style.overflowWrap = "normal";
  style.paddingLeft = "0";
  style.paddingRight = "0";
  style.textTransform = "none";
  style.whiteSpace = "normal";
  style.width = width;
  style.wordBreak = "normal";
  style.setProperty("text-wrap", "wrap");

  for (let i = 0; i < WRAP_TEXT_STYLE_PROPERTIES.length; i += 1) {
    style[WRAP_TEXT_STYLE_PROPERTIES[i] as never] = styleValues[i] as never;
  }
  style.textTransform = "none";
  return probe;
}

interface MultilineWrapProbes {
  root: HTMLElement;
  baseline: HTMLElement;
  candidate: HTMLElement;
  styleValues: string[];
  busy: boolean;
}

// Retain only one detached pair per document, never measured widths or heights.
// Reattaching it still lets the browser resolve loaded fonts and native breaks.
const multilineWrapProbes = /* @__PURE__ */ new WeakMap<Document, MultilineWrapProbes>();

function acquireMultilineWrapProbes(
  ownerDocument: Document,
  computed: CSSStyleDeclaration,
  text: string,
  width: number,
) {
  let probes = multilineWrapProbes.get(ownerDocument);
  if (!probes || probes.busy) {
    // A nested measurement must not overwrite the outer call's probes.
    const styleValues: string[] = [];
    for (let i = 0; i < WRAP_TEXT_STYLE_PROPERTIES.length; i += 1) {
      styleValues.push(computed[WRAP_TEXT_STYLE_PROPERTIES[i]!] as string);
    }
    const root = createInlineMeasurementRoot(ownerDocument);
    const baseline = createMultilineWrapProbe(ownerDocument, styleValues, text, "1000000px");
    const candidate = createMultilineWrapProbe(ownerDocument, styleValues, text, `${width}px`);
    root.append(baseline, candidate);
    const fresh: MultilineWrapProbes = { root, baseline, candidate, styleValues, busy: false };
    if (!probes) multilineWrapProbes.set(ownerDocument, fresh);
    probes = fresh;
  } else {
    probes.baseline.textContent = text;
    probes.candidate.textContent = text;
    probes.candidate.style.width = `${width}px`;
    const baselineStyle = probes.baseline.style;
    const candidateStyle = probes.candidate.style;
    const prev = probes.styleValues;
    const nextFont = computed.font;
    const fontChanged = prev[0] !== nextFont;
    if (fontChanged) {
      prev[0] = nextFont;
      baselineStyle.font = nextFont;
      candidateStyle.font = nextFont;
    }
    for (let index = 1; index < WRAP_TEXT_STYLE_PROPERTIES.length; index += 1) {
      const property = WRAP_TEXT_STYLE_PROPERTIES[index]!;
      const value = computed[property] as string;
      if (prev[index] !== value || (fontChanged && index <= WRAP_FONT_SHORTHAND_RESET_END)) {
        prev[index] = value;
        baselineStyle[property as never] = value as never;
        candidateStyle[property as never] = value as never;
      }
    }
    if (fontChanged) {
      baselineStyle.textTransform = "none";
      candidateStyle.textTransform = "none";
    }
  }
  probes.busy = true;
  return probes;
}

function verifyExactMultilineContentWidth({
  canvasContentWidth,
  collapsed,
  computed,
  lines,
  sourceElement,
}: {
  canvasContentWidth: number;
  collapsed: string;
  computed: CSSStyleDeclaration;
  lines: number;
  sourceElement: HTMLElement;
}) {
  const ownerDocument = sourceElement.ownerDocument;
  const probes = acquireMultilineWrapProbes(ownerDocument, computed, collapsed, canvasContentWidth);
  const { root, baseline, candidate } = probes;
  let lastAppliedWidth: number | string = canvasContentWidth;

  try {
    ownerDocument.body.appendChild(root);
    const singleLineHeight = baseline.getBoundingClientRect().height;
    const maxHeight = singleLineHeight * lines + 0.5;
    const fits = (width: number) => {
      if (lastAppliedWidth !== width) {
        candidate.style.width = `${width}px`;
        lastAppliedWidth = width;
      }
      const height = candidate.getBoundingClientRect().height;
      return height <= maxHeight
        && candidate.scrollWidth <= Math.ceil(width);
    };

    let lo = -1;
    let hi = canvasContentWidth;
    if (fits(hi)) {
      // Most Canvas estimates already are the native minimum. Prove it with
      // the neighboring integer before paying for a downward search.
      if (hi === 0 || !fits(hi - 1)) return hi;
      hi -= 1;
      // Rounding commonly makes the estimate just one pixel too wide. Prove
      // that nearby minimum before searching the whole remaining interval.
      if (hi === 0 || !fits(hi - 1)) return hi;
      hi -= 1;
    } else {
      // Measure an upper bound with the same native wrap styles, including
      // word spacing and OpenType features, rather than another Canvas guess.
      candidate.style.width = "max-content";
      lastAppliedWidth = "max-content";
      hi = Math.max(Math.ceil(candidate.getBoundingClientRect().width), hi + 1);
    }

    while (hi - lo > 1) {
      const middle = Math.floor((lo + hi) / 2);
      if (fits(middle)) {
        hi = middle;
      } else {
        lo = middle;
      }
    }
    return hi;
  } finally {
    root.remove();
    probes.busy = false;
  }
}

export function measureInlineTextMultilineWidth({
  accuracy,
  sourceElement,
  text,
  lines,
}: InlineTextMultilineMeasureInput) {
  const computed = window.getComputedStyle(sourceElement);
  const transformed = applyTextTransform(text, computed.textTransform);
  if (lines <= 1) {
    const collapsed = collapseWhitespace(transformed);
    const normalized = collapsed.includes("\u00ad") ? collapsed.replaceAll("\u00ad", "") : collapsed;
    const trimmed = trimTrailingCollapsibleSpaces(normalized);
    const contentWidth = trimmed ? Math.ceil(measureCanvasTextFromComputed(computed, trimmed)) : 0;
    return contentWidth + getHorizontalBoxWidthFromComputed(computed);
  }

  const prepared = prepareWrapText(transformed);
  if (typeof document !== "undefined") watchFontLoads(document.fonts);
  const canvasStyle = resolveCanvasStyleFromComputed(computed);
  const contentWidth = computeMultilineMinContentWidth({
    ...prepared,
    lines,
    measureContent: (value) => measureCanvasTextWithStyle(canvasStyle, value),
  });
  if (!prepared.normalized || accuracy !== "exact") {
    return contentWidth + getHorizontalBoxWidthFromComputed(computed);
  }

  const verifiedContentWidth = verifyExactMultilineContentWidth({
    canvasContentWidth: contentWidth,
    collapsed: prepared.collapsed,
    computed,
    lines,
    sourceElement,
  });

  return verifiedContentWidth + getHorizontalBoxWidthFromComputed(computed);
}
