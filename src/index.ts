import {
  applyTextTransform,
  getHorizontalBoxWidthFromComputed,
  tabularGlyphMeasurementCache,
} from "./internal.js";

export type InlineMeasureAccuracy = "auto" | "fast" | "exact";

export type InlineMeasureStyleMap = Partial<Record<keyof CSSStyleDeclaration, string>>;

export interface InlineTextMeasureInput {
  accuracy?: InlineMeasureAccuracy;
  sourceElement: HTMLElement;
  text: string;
}

export const INLINE_MEASUREMENT_ROOT_STYLES = {
  position: "absolute",
  left: "-9999px",
  top: "-9999px",
  visibility: "hidden",
  pointerEvents: "none",
} satisfies InlineMeasureStyleMap;

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
  "letterSpacing",
  "lineHeight",
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

let measurementCanvas: HTMLCanvasElement | null = null;
interface CanvasFontState {
  font: string;
  stretch: string;
  caps: string;
}
let canvasFonts = new WeakMap<CanvasRenderingContext2D, CanvasFontState>();
const watchedFontSets = new WeakSet<FontFaceSet>();
const watchedPendingFaces = new WeakSet<FontFace>();

function invalidateFontMeasurements() {
  // Safari can keep a resolved fallback font in the Canvas context even
  // when the declared string is unchanged. A fresh context resolves again.
  measurementCanvas = null;
  canvasFonts = new WeakMap();
  tabularGlyphMeasurementCache.clear();
}

function watchPendingFontFaces(fonts: FontFaceSet | undefined, status = fonts?.status) {
  if (status !== "loading" || !fonts?.forEach) return;
  fonts.forEach(face => {
    if (face.status === "loaded" || watchedPendingFaces.has(face)) return;
    watchedPendingFaces.add(face);
    // FontFaceSet.ready/loadingdone can wait for unrelated faces. A face's
    // own promise resolves as soon as its fallback metrics become obsolete.
    void face.loaded.then(invalidateFontMeasurements, invalidateFontMeasurements);
  });
}

function watchFontLoads(fonts: FontFaceSet | undefined) {
  if (!fonts?.addEventListener || watchedFontSets.has(fonts)) return;
  watchedFontSets.add(fonts);
  watchPendingFontFaces(fonts);
  fonts.addEventListener("loadingdone", invalidateFontMeasurements);
  fonts.addEventListener("loadingerror", invalidateFontMeasurements);
  // Some WebKit FontFaceSet implementations dispatch loading but omit
  // loadingdone. ready still resolves for that loading cycle.
  fonts.addEventListener("loading", () => {
    watchPendingFontFaces(fonts);
    void fonts.ready.then(invalidateFontMeasurements);
  });
}

export function applyInlineMeasurementStyles(
  element: HTMLElement,
  styles: InlineMeasureStyleMap,
) {
  for (const [property, value] of Object.entries(styles)) {
    if (value === undefined) continue;
    element.style[property as never] = value as never;
  }
}

export function parseCssPixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getHorizontalBoxWidth(element: HTMLElement) {
  const computed = window.getComputedStyle(element);
  return getHorizontalBoxWidthFromComputed(computed);
}

export function createInlineMeasurementRoot(ownerDocument: Document = document) {
  const root = ownerDocument.createElement("div");
  applyInlineMeasurementStyles(root, INLINE_MEASUREMENT_ROOT_STYLES);
  return root;
}

export function createCanvasTextMeasurer(
  fontOrComputedStyle: string | CSSStyleDeclaration,
) {
  if (typeof document !== "undefined") watchFontLoads(document.fonts);
  return (value: string) => {
    if (typeof document === "undefined") return value.length;
    measurementCanvas ??= document.createElement("canvas");
    const context = measurementCanvas.getContext("2d");
    if (!context) return value.length;

    if (typeof fontOrComputedStyle === "string") {
      const shorthand = setCanvasFont(context, fontOrComputedStyle);
      setCanvasContextProperty(context, "fontKerning", "auto");
      setCanvasContextProperty(context, "fontStretch", shorthand.stretch);
      setCanvasContextProperty(context, "fontVariantCaps", shorthand.caps);
      setCanvasContextProperty(context, "letterSpacing", "0px");
    } else {
      setCanvasFont(context, getCanvasFont(fontOrComputedStyle));
      setCanvasContextProperty(context, "fontKerning", fontOrComputedStyle.fontKerning || "auto");
      setCanvasContextProperty(context, "fontStretch", isCanvasFontStretchValue(fontOrComputedStyle.fontStretch) ? fontOrComputedStyle.fontStretch : "normal");
      setCanvasContextProperty(context, "fontVariantCaps", fontOrComputedStyle.fontVariantCaps || "normal");
      const supportsLetterSpacing = setCanvasContextProperty(
        context,
        "letterSpacing",
        fontOrComputedStyle.letterSpacing,
      );
      const measuredWidth = context.measureText(value).width;
      if (supportsLetterSpacing) return measuredWidth;

      const letterSpacing = parseCssPixelValue(fontOrComputedStyle.letterSpacing);
      return measuredWidth + letterSpacing * Math.max(0, Array.from(value).length - 1);
    }

    return context.measureText(value).width;
  };
}

function setCanvasFont(context: CanvasRenderingContext2D, font: string) {
  // Canvas normalizes the shorthand it reads back. Keep the requested string so
  // an equivalent browser serialization does not cause repeated font parsing.
  const previous = canvasFonts.get(context);
  if (previous?.font === font) return previous;
  setCanvasContextProperty(context, "fontStretch", "normal");
  setCanvasContextProperty(context, "fontVariantCaps", "normal");
  context.font = font;
  const state = { font, stretch: context.fontStretch || "normal", caps: context.fontVariantCaps || "normal" };
  canvasFonts.set(context, state);
  return state;
}

function getCanvasFont(computed: CSSStyleDeclaration) {
  if (computed.font) return computed.font;

  const style = computed.fontStyle && computed.fontStyle !== "normal" ? computed.fontStyle : "";
  // The font shorthand accepts CSS2 small-caps, not numeric variants such as
  // tabular-nums. Passing those makes Canvas silently keep its previous font.
  const variant = computed.fontVariant === "small-caps" ? "small-caps" : "";
  const weight = computed.fontWeight && computed.fontWeight !== "normal" ? computed.fontWeight : "";
  const stretch = computed.fontStretch && computed.fontStretch !== "normal" && isCanvasFontStretchValue(computed.fontStretch)
    ? computed.fontStretch
    : "";
  const size = computed.fontSize || "16px";
  const family = computed.fontFamily || "sans-serif";
  return [style, variant, weight, stretch, size, family].filter(Boolean).join(" ");
}

function setCanvasContextProperty(
  context: CanvasRenderingContext2D,
  property: "fontKerning" | "fontStretch" | "fontVariantCaps" | "letterSpacing",
  value: string,
) {
  if (!(property in context)) return false;
  if (property === "fontStretch" && !isCanvasFontStretchValue(value)) return false;

  const nextValue = property === "letterSpacing" && (!value || value === "normal")
      ? "0px"
      : value;
  const properties = context as unknown as Record<typeof property, string>;
  if (properties[property] !== nextValue) properties[property] = nextValue;
  return true;
}

function isCanvasFontStretchValue(value: string) {
  return value === "ultra-condensed"
    || value === "extra-condensed"
    || value === "condensed"
    || value === "semi-condensed"
    || value === "normal"
    || value === "semi-expanded"
    || value === "expanded"
    || value === "extra-expanded"
    || value === "ultra-expanded";
}

function getInlineTextStyleSignature(computed: CSSStyleDeclaration, fontStatus: string) {
  return [
    fontStatus,
    computed.font,
    computed.fontFamily,
    computed.fontSize,
    computed.fontStyle,
    computed.fontVariant,
    computed.fontFeatureSettings,
    computed.fontKerning,
    computed.fontOpticalSizing,
    computed.fontStretch,
    computed.fontWeight,
    computed.fontVariantCaps,
    computed.fontVariantNumeric,
    computed.fontVariationSettings,
    computed.lineHeight,
    computed.letterSpacing,
    computed.wordSpacing,
    computed.textTransform,
  ].join("\u001f");
}

function hasTabularNumericStyle(sourceElement: HTMLElement, computed: CSSStyleDeclaration) {
  return /\b(tabular-nums|tabular|tnum)\b/.test([
    sourceElement.className,
    computed.fontVariantNumeric,
    computed.fontFeatureSettings,
  ].join(" "));
}

function getElementMeasuredWidth(element: HTMLElement) {
  const rectWidth = element.getBoundingClientRect().width;
  return rectWidth > 0 ? rectWidth : element.offsetWidth;
}

function getTabularGlyphCache(computed: CSSStyleDeclaration) {
  const fonts = document.fonts;
  const status = fonts?.status ?? "";
  watchFontLoads(fonts);
  // Catch faces added during an already active global loading cycle too.
  watchPendingFontFaces(fonts, status);
  const signature = getInlineTextStyleSignature(computed, status);
  let cache = tabularGlyphMeasurementCache.get(signature);
  if (!cache) {
    cache = new Map<string, number>();
    tabularGlyphMeasurementCache.set(signature, cache);
  }
  return cache;
}

function calibrateMissingTabularGlyphs({
  boxWidth,
  cache,
  glyphs,
  sourceElement,
}: {
  boxWidth: number;
  cache: Map<string, number>;
  glyphs: readonly string[];
  sourceElement: HTMLElement;
}) {
  const missingGlyphs = Array.from(new Set(glyphs)).filter((glyph) => !cache.has(glyph));
  if (missingGlyphs.length === 0) return;
  const ownerDocument = sourceElement.ownerDocument;
  const root = createInlineMeasurementRoot(ownerDocument);
  const nodes = missingGlyphs.map((glyph) => {
    const node = createInlineTextMeasurementNode({ sourceElement, text: glyph });
    root.appendChild(node);
    return { glyph, node };
  });

  ownerDocument.body.appendChild(root);
  try {
    for (const { glyph, node } of nodes) {
      cache.set(glyph, Math.max(0, getElementMeasuredWidth(node) - boxWidth));
    }
  } finally {
    root.remove();
  }
}

function measureTabularTextWidthCalibrated({
  computed,
  sourceElement,
  text,
}: InlineTextMeasureInput & { computed: CSSStyleDeclaration }) {
  const measuredText = applyTextTransform(text, computed.textTransform);
  if (!measuredText) return getHorizontalBoxWidthFromComputed(computed);

  const boxWidth = getHorizontalBoxWidthFromComputed(computed);
  const glyphs = Array.from(measuredText);
  const glyphCache = getTabularGlyphCache(computed);
  calibrateMissingTabularGlyphs({
    boxWidth,
    cache: glyphCache,
    glyphs,
    sourceElement,
  });
  const letterSpacing = parseCssPixelValue(computed.letterSpacing);
  const spacingWidth = letterSpacing > 0 && glyphs.length > 1
    ? letterSpacing * (glyphs.length - 1)
    : 0;
  const contentWidth = glyphs.reduce((total, glyph) => total + (glyphCache.get(glyph) ?? 0), 0);

  return contentWidth + spacingWidth + boxWidth;
}

export function measureInlineTextWidthFast({
  sourceElement,
  text,
}: InlineTextMeasureInput) {
  const computed = window.getComputedStyle(sourceElement);
  const measuredText = applyTextTransform(text, computed.textTransform);
  const measureText = createCanvasTextMeasurer(computed);

  return measureText(measuredText) + getHorizontalBoxWidthFromComputed(computed);
}

export function measureInlineTextWidthAuto(input: InlineTextMeasureInput) {
  const computed = window.getComputedStyle(input.sourceElement);
  if (hasTabularNumericStyle(input.sourceElement, computed)) {
    return measureTabularTextWidthCalibrated({ ...input, computed });
  }

  return measureInlineTextWidthFast(input);
}

export function copyInlineTextMeasurementStyles(
  target: HTMLElement,
  sourceElement: HTMLElement,
) {
  const computed = window.getComputedStyle(sourceElement);
  applyInlineMeasurementStyles(target, {
    width: "max-content",
    minWidth: "0",
    maxWidth: "none",
    // Not inline-flex: a flex container drops a whitespace-only text run, so a
    // space glyph or a whitespace-only string would measure 0px.
    display: "inline-block",
    boxSizing: "border-box",
    whiteSpace: "pre",
  });

  for (const property of INLINE_TEXT_STYLE_PROPERTIES) {
    target.style[property as never] = computed[property] as never;
  }
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

export function measureInlineTextWidthExact(input: InlineTextMeasureInput) {
  const root = createInlineMeasurementRoot(input.sourceElement.ownerDocument);
  const node = createInlineTextMeasurementNode(input);
  root.appendChild(node);
  input.sourceElement.ownerDocument.body.appendChild(root);
  const width = node.offsetWidth;
  root.remove();
  return width;
}

export function measureInlineTextWidth(input: InlineTextMeasureInput) {
  if (input.accuracy === "exact") return measureInlineTextWidthExact(input);
  if (input.accuracy === "fast") return measureInlineTextWidthFast(input);
  return measureInlineTextWidthAuto(input);
}

export function measureInlineElementWidth(element: HTMLElement) {
  return element.getBoundingClientRect().width;
}
