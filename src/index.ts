import {
  applyTextTransform,
  getHorizontalBoxWidthFromComputed,
  getOrCreateTabularGlyphCache,
  measureCanvasTextFromComputed,
  measureCanvasTextWithShorthand,
  parseCssPixelValue as parseCssPixelValueInternal,
  type TabularGlyphCacheEntry,
  watchFontLoads,
  watchPendingFontFaces,
} from "./internal.js";

export type InlineMeasureAccuracy = "auto" | "fast" | "exact";

export type InlineMeasureStyleMap = Partial<Record<keyof CSSStyleDeclaration, string>>;

export interface InlineTextMeasureInput {
  accuracy?: InlineMeasureAccuracy;
  sourceElement: HTMLElement;
  text: string;
}

// Indices 1..FONT_SHORTHAND_RESET_END are CSS properties reset by assigning
// `style.font`, so they are rewritten whenever the shorthand changes.
const FONT_SHORTHAND_RESET_END = 13;

const INLINE_TEXT_STYLE_PROPERTIES = [
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
  "textTransform",
  "paddingLeft",
  "paddingRight",
  "borderLeftWidth",
  "borderRightWidth",
  "borderLeftStyle",
  "borderRightStyle",
  "borderLeftColor",
  "borderRightColor",
  "columnGap",
  "gap",
] as const satisfies ReadonlyArray<keyof CSSStyleDeclaration>;

const TABULAR_NUMERIC_RE = /\b(?:tabular-nums|tabular|tnum)\b/;

interface ExactSingleLineProbe {
  root: HTMLElement;
  node: HTMLElement;
  styleValues: string[];
  busy: boolean;
}

// Retain only one detached probe per document, never measured widths.
// Reattaching it still lets the browser resolve loaded fonts and native layout.
const exactSingleLineProbes = /* @__PURE__ */ new WeakMap<Document, ExactSingleLineProbe>();

export function parseCssPixelValue(value: string) {
  return parseCssPixelValueInternal(value);
}

export function getHorizontalBoxWidth(element: HTMLElement) {
  const computed = window.getComputedStyle(element);
  return getHorizontalBoxWidthFromComputed(computed);
}

export function createInlineMeasurementRoot(ownerDocument: Document = document) {
  const root = ownerDocument.createElement("div");
  const style = root.style;
  style.position = "absolute";
  style.left = "-9999px";
  style.top = "-9999px";
  style.visibility = "hidden";
  style.pointerEvents = "none";
  return root;
}

export function createCanvasTextMeasurer(
  fontOrComputedStyle: string | CSSStyleDeclaration,
) {
  if (typeof document !== "undefined") watchFontLoads(document.fonts);
  if (typeof fontOrComputedStyle === "string") {
    return (value: string) => measureCanvasTextWithShorthand(fontOrComputedStyle, value);
  }
  return (value: string) => measureCanvasTextFromComputed(fontOrComputedStyle, value);
}

function getInlineTextStyleSignature(
  computed: CSSStyleDeclaration,
  fontStatus: string,
  fontVariantNumeric: string,
  letterSpacing: string,
  textTransform: string,
) {
  return `${fontStatus}\u001f${computed.font}\u001f${computed.fontFamily}\u001f${computed.fontSize}\u001f${computed.fontStyle}\u001f${computed.fontVariant}\u001f${computed.fontFeatureSettings}\u001f${computed.fontKerning}\u001f${computed.fontOpticalSizing}\u001f${computed.fontStretch}\u001f${computed.fontWeight}\u001f${computed.fontVariantCaps}\u001f${fontVariantNumeric}\u001f${computed.fontVariationSettings}\u001f${computed.lineHeight}\u001f${letterSpacing}\u001f${computed.wordSpacing}\u001f${textTransform}`;
}

function hasTabularNumericStyle(
  sourceElement: HTMLElement,
  computed: CSSStyleDeclaration,
  fontVariantNumeric: string,
) {
  const className = sourceElement.className;
  if (typeof className === "string" && className.length > 0 && TABULAR_NUMERIC_RE.test(className)) {
    return true;
  }
  if (fontVariantNumeric && fontVariantNumeric !== "normal" && TABULAR_NUMERIC_RE.test(fontVariantNumeric)) {
    return true;
  }
  const fontFeatureSettings = computed.fontFeatureSettings;
  if (fontFeatureSettings && fontFeatureSettings !== "normal" && TABULAR_NUMERIC_RE.test(fontFeatureSettings)) {
    return true;
  }
  return false;
}

function getElementMeasuredWidth(element: HTMLElement) {
  const rectWidth = element.getBoundingClientRect().width;
  return rectWidth > 0 ? rectWidth : element.offsetWidth;
}

function getTabularGlyphCache(
  computed: CSSStyleDeclaration,
  fontVariantNumeric: string,
  letterSpacing: string,
  textTransform: string,
): TabularGlyphCacheEntry {
  const fonts = document.fonts;
  const status = fonts?.status ?? "";
  watchFontLoads(fonts);
  // Catch faces added during an already active global loading cycle too.
  watchPendingFontFaces(fonts, status);
  return getOrCreateTabularGlyphCache(
    getInlineTextStyleSignature(computed, status, fontVariantNumeric, letterSpacing, textTransform),
  );
}

function copyInlineTextMeasurementStylesFromComputed(
  target: HTMLElement,
  computed: CSSStyleDeclaration,
) {
  const style = target.style;
  style.width = "max-content";
  style.minWidth = "0";
  style.maxWidth = "none";
  // Not inline-flex: a flex container drops a whitespace-only text run, so a
  // space glyph or a whitespace-only string would measure 0px.
  style.display = "inline-block";
  style.boxSizing = "border-box";
  style.whiteSpace = "pre";

  for (let i = 0; i < INLINE_TEXT_STYLE_PROPERTIES.length; i += 1) {
    const property = INLINE_TEXT_STYLE_PROPERTIES[i]!;
    style[property as never] = computed[property] as never;
  }
}

function calibrateMissingTabularGlyphs(
  boxWidth: number,
  cache: TabularGlyphCacheEntry,
  missingGlyphs: readonly string[],
  sourceElement: HTMLElement,
  computed: CSSStyleDeclaration,
) {
  const uniqueMissing: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < missingGlyphs.length; i += 1) {
    const glyph = missingGlyphs[i]!;
    if (!seen.has(glyph)) {
      seen.add(glyph);
      uniqueMissing.push(glyph);
    }
  }
  const ownerDocument = sourceElement.ownerDocument;
  const root = createInlineMeasurementRoot(ownerDocument);
  const nodes: HTMLElement[] = [];
  for (let i = 0; i < uniqueMissing.length; i += 1) {
    const node = ownerDocument.createElement("span");
    node.textContent = uniqueMissing[i]!;
    copyInlineTextMeasurementStylesFromComputed(node, computed);
    root.appendChild(node);
    nodes.push(node);
  }

  ownerDocument.body.appendChild(root);
  try {
    for (let i = 0; i < uniqueMissing.length; i += 1) {
      const glyph = uniqueMissing[i]!;
      const width = Math.max(0, getElementMeasuredWidth(nodes[i]!) - boxWidth);
      if (glyph.length === 1) {
        const code = glyph.charCodeAt(0);
        if (code < 128) {
          cache.ascii[code] = width;
          continue;
        }
      }
      cache.other.set(glyph, width);
    }
  } finally {
    root.remove();
  }
}

function measureTabularTextWidthCalibrated(
  sourceElement: HTMLElement,
  text: string,
  computed: CSSStyleDeclaration,
  fontVariantNumeric: string,
) {
  const textTransform = computed.textTransform;
  const measuredText = applyTextTransform(text, textTransform);
  const boxWidth = getHorizontalBoxWidthFromComputed(computed);
  if (!measuredText) return boxWidth;

  const rawLetterSpacing = computed.letterSpacing;
  const cache = getTabularGlyphCache(computed, fontVariantNumeric, rawLetterSpacing, textTransform);
  const asciiWidths = cache.ascii;
  const otherWidths = cache.other;
  let contentWidth = 0;
  let glyphCount = 0;
  let missingGlyphs: string[] | null = null;

  for (let i = 0; i < measuredText.length; ) {
    const code = measuredText.charCodeAt(i);
    if (code < 128) {
      const width = asciiWidths[code]!;
      if (width >= 0) {
        contentWidth += width;
      } else {
        (missingGlyphs ??= []).push(measuredText[i]!);
      }
      i += 1;
    } else {
      const isPair = code >= 0xd800 && code <= 0xdbff && i + 1 < measuredText.length
        && (measuredText.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
      const glyph = isPair ? measuredText.slice(i, i + 2) : measuredText[i]!;
      const width = otherWidths.get(glyph);
      if (width !== undefined) {
        contentWidth += width;
      } else {
        (missingGlyphs ??= []).push(glyph);
      }
      i += isPair ? 2 : 1;
    }
    glyphCount += 1;
  }

  if (missingGlyphs !== null) {
    calibrateMissingTabularGlyphs(boxWidth, cache, missingGlyphs, sourceElement, computed);
    for (let i = 0; i < missingGlyphs.length; i += 1) {
      const glyph = missingGlyphs[i]!;
      if (glyph.length === 1 && glyph.charCodeAt(0) < 128) {
        contentWidth += asciiWidths[glyph.charCodeAt(0)]!;
      } else {
        contentWidth += otherWidths.get(glyph) ?? 0;
      }
    }
  }

  const letterSpacing = parseCssPixelValueInternal(rawLetterSpacing);
  const spacingWidth = letterSpacing > 0 && glyphCount > 1
    ? letterSpacing * (glyphCount - 1)
    : 0;

  return contentWidth + spacingWidth + boxWidth;
}

function measureInlineTextWidthFastFromComputed(computed: CSSStyleDeclaration, text: string) {
  const measuredText = applyTextTransform(text, computed.textTransform);
  return measureCanvasTextFromComputed(computed, measuredText)
    + getHorizontalBoxWidthFromComputed(computed);
}

function measureInlineTextWidthFast({
  sourceElement,
  text,
}: InlineTextMeasureInput) {
  return measureInlineTextWidthFastFromComputed(window.getComputedStyle(sourceElement), text);
}

function measureInlineTextWidthAuto(input: InlineTextMeasureInput) {
  const computed = window.getComputedStyle(input.sourceElement);
  const fontVariantNumeric = computed.fontVariantNumeric;
  if (hasTabularNumericStyle(input.sourceElement, computed, fontVariantNumeric)) {
    return measureTabularTextWidthCalibrated(input.sourceElement, input.text, computed, fontVariantNumeric);
  }

  return measureInlineTextWidthFastFromComputed(computed, input.text);
}

function copyInlineTextMeasurementStyles(
  target: HTMLElement,
  sourceElement: HTMLElement,
) {
  copyInlineTextMeasurementStylesFromComputed(target, window.getComputedStyle(sourceElement));
}

export function createInlineTextMeasurementNode({
  sourceElement,
  text,
}: InlineTextMeasureInput) {
  const measurementNode = sourceElement.ownerDocument.createElement("span");
  measurementNode.textContent = text;
  copyInlineTextMeasurementStyles(measurementNode, sourceElement);
  return measurementNode;
}

function acquireExactSingleLineProbe(
  ownerDocument: Document,
  computed: CSSStyleDeclaration,
  text: string,
): ExactSingleLineProbe {
  let probe = exactSingleLineProbes.get(ownerDocument);
  if (!probe || probe.busy) {
    // A nested measurement must not overwrite the outer call's probe.
    const root = createInlineMeasurementRoot(ownerDocument);
    const node = ownerDocument.createElement("span");
    node.textContent = text;
    const style = node.style;
    style.width = "max-content";
    style.minWidth = "0";
    style.maxWidth = "none";
    style.display = "inline-block";
    style.boxSizing = "border-box";
    style.whiteSpace = "pre";
    const styleValues: string[] = [];
    for (let i = 0; i < INLINE_TEXT_STYLE_PROPERTIES.length; i += 1) {
      const property = INLINE_TEXT_STYLE_PROPERTIES[i]!;
      const value = computed[property] as string;
      styleValues.push(value);
      style[property as never] = value as never;
    }
    root.appendChild(node);
    const fresh: ExactSingleLineProbe = { root, node, styleValues, busy: false };
    if (!probe) exactSingleLineProbes.set(ownerDocument, fresh);
    probe = fresh;
  } else {
    probe.node.textContent = text;
    const style = probe.node.style;
    const prev = probe.styleValues;
    const nextFont = computed.font;
    const fontChanged = prev[0] !== nextFont;
    if (fontChanged) {
      prev[0] = nextFont;
      style.font = nextFont;
    }
    for (let i = 1; i < INLINE_TEXT_STYLE_PROPERTIES.length; i += 1) {
      const property = INLINE_TEXT_STYLE_PROPERTIES[i]!;
      const value = computed[property] as string;
      if (prev[i] !== value || (fontChanged && i <= FONT_SHORTHAND_RESET_END)) {
        prev[i] = value;
        style[property as never] = value as never;
      }
    }
  }
  probe.busy = true;
  return probe;
}

function measureInlineTextWidthExact(input: InlineTextMeasureInput) {
  const ownerDocument = input.sourceElement.ownerDocument;
  const computed = window.getComputedStyle(input.sourceElement);
  const probe = acquireExactSingleLineProbe(ownerDocument, computed, input.text);
  try {
    ownerDocument.body.appendChild(probe.root);
    return probe.node.offsetWidth;
  } finally {
    probe.root.remove();
    probe.busy = false;
  }
}

export function measureInlineTextWidth(input: InlineTextMeasureInput) {
  if (input.accuracy === "exact") return measureInlineTextWidthExact(input);
  if (input.accuracy === "fast") return measureInlineTextWidthFast(input);
  return measureInlineTextWidthAuto(input);
}

export function measureInlineElementWidth(element: HTMLElement) {
  return element.getBoundingClientRect().width;
}
