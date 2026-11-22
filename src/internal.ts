export interface TabularGlyphCacheEntry {
  ascii: Float64Array;
  other: Map<string, number>;
}

interface CanvasContextState {
  font: string;
  shorthandStretch: string;
  shorthandCaps: string;
  kerning: string;
  stretch: string;
  caps: string;
  letterSpacing: string;
  hasKerning: boolean;
  hasStretch: boolean;
  hasCaps: boolean;
  hasLetterSpacing: boolean;
}

export interface ResolvedCanvasStyle {
  font: string;
  kerning: string;
  stretch: string;
  caps: string;
  letterSpacing: string;
}

const MAX_TABULAR_STYLE_CACHES = 64;
const CAPITALIZE_RE = /\b\p{L}/gu;

// Tabular glyph widths calibrated against the DOM, keyed by text style
// signature. It lives here, outside the public entrypoints, so that the root
// entrypoint and `./testing` share one bounded cache.
const tabularGlyphMeasurementCache = /* @__PURE__ */ new Map<string, TabularGlyphCacheEntry>();
let lastTabularSignature = "";
let lastTabularEntry: TabularGlyphCacheEntry | undefined;

let measurementCanvas: HTMLCanvasElement | null = null;
let measurementContext: CanvasRenderingContext2D | null = null;
let measurementGetContext: typeof HTMLCanvasElement.prototype.getContext | null = null;
let canvasFonts = /* @__PURE__ */ new WeakMap<CanvasRenderingContext2D, CanvasContextState>();
let lastCanvasContext: CanvasRenderingContext2D | null = null;
let lastCanvasState: CanvasContextState | null = null;
const watchedFontSets = /* @__PURE__ */ new WeakSet<FontFaceSet>();
let lastWatchedFontSet: FontFaceSet | undefined;
const watchedPendingFaces = /* @__PURE__ */ new WeakSet<FontFace>();

export function getOrCreateTabularGlyphCache(signature: string): TabularGlyphCacheEntry {
  if (lastTabularEntry !== undefined && lastTabularSignature === signature) {
    return lastTabularEntry;
  }
  let entry = tabularGlyphMeasurementCache.get(signature);
  if (!entry) {
    if (tabularGlyphMeasurementCache.size >= MAX_TABULAR_STYLE_CACHES) {
      const oldestKey = tabularGlyphMeasurementCache.keys().next().value;
      if (oldestKey !== undefined) tabularGlyphMeasurementCache.delete(oldestKey);
    }
    const ascii = new Float64Array(128);
    ascii.fill(-1);
    entry = { ascii, other: new Map<string, number>() };
    tabularGlyphMeasurementCache.set(signature, entry);
  }
  lastTabularSignature = signature;
  lastTabularEntry = entry;
  return entry;
}

export function clearTabularGlyphMeasurementCache() {
  tabularGlyphMeasurementCache.clear();
  lastTabularSignature = "";
  lastTabularEntry = undefined;
}

function invalidateFontMeasurements() {
  // Safari can keep a resolved fallback font in the Canvas context even
  // when the declared string is unchanged. A fresh context resolves again.
  measurementCanvas = null;
  measurementContext = null;
  measurementGetContext = null;
  canvasFonts = new WeakMap();
  lastCanvasContext = null;
  lastCanvasState = null;
  clearTabularGlyphMeasurementCache();
}

export function watchPendingFontFaces(fonts: FontFaceSet | undefined, status = fonts?.status) {
  if (status !== "loading" || !fonts?.forEach) return;
  fonts.forEach((face) => {
    if (face.status === "loaded" || watchedPendingFaces.has(face)) return;
    watchedPendingFaces.add(face);
    // FontFaceSet.ready/loadingdone can wait for unrelated faces. A face's
    // own promise resolves as soon as its fallback metrics become obsolete.
    void face.loaded.then(invalidateFontMeasurements, invalidateFontMeasurements);
  });
}

export function watchFontLoads(fonts: FontFaceSet | undefined) {
  if (!fonts) return;
  if (fonts === lastWatchedFontSet) return;
  if (!fonts.addEventListener || watchedFontSets.has(fonts)) {
    lastWatchedFontSet = fonts;
    return;
  }
  watchedFontSets.add(fonts);
  lastWatchedFontSet = fonts;
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

export function isCanvasFontStretchValue(value: string) {
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

function getCanvasFont(computed: CSSStyleDeclaration) {
  const shorthand = computed.font;
  if (shorthand) return shorthand;

  let result = "";
  const style = computed.fontStyle;
  if (style && style !== "normal") result = style;
  // The font shorthand accepts CSS2 small-caps, not numeric variants such as
  // tabular-nums. Passing those makes Canvas silently keep its previous font.
  if (computed.fontVariant === "small-caps") {
    result = result ? `${result} small-caps` : "small-caps";
  }
  const weight = computed.fontWeight;
  if (weight && weight !== "normal") {
    result = result ? `${result} ${weight}` : weight;
  }
  const stretch = computed.fontStretch;
  if (stretch && stretch !== "normal" && isCanvasFontStretchValue(stretch)) {
    result = result ? `${result} ${stretch}` : stretch;
  }
  const size = computed.fontSize || "16px";
  const family = computed.fontFamily || "sans-serif";
  return result ? `${result} ${size} ${family}` : `${size} ${family}`;
}

export function resolveCanvasStyleFromComputed(computed: CSSStyleDeclaration): ResolvedCanvasStyle {
  const rawStretch = computed.fontStretch;
  const rawLetterSpacing = computed.letterSpacing;
  return {
    font: getCanvasFont(computed),
    kerning: computed.fontKerning || "auto",
    stretch: isCanvasFontStretchValue(rawStretch) ? rawStretch : "normal",
    caps: computed.fontVariantCaps || "normal",
    letterSpacing: !rawLetterSpacing || rawLetterSpacing === "normal" ? "0px" : rawLetterSpacing,
  };
}

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (measurementCanvas === null) {
    measurementCanvas = document.createElement("canvas");
    measurementContext = null;
    measurementGetContext = null;
  }
  const getContextFn = measurementCanvas.getContext;
  if (measurementContext !== null && measurementGetContext === getContextFn) {
    return measurementContext;
  }
  measurementGetContext = getContextFn;
  measurementContext = measurementCanvas.getContext("2d");
  return measurementContext;
}

function getCanvasContextState(context: CanvasRenderingContext2D): CanvasContextState {
  if (lastCanvasContext === context && lastCanvasState !== null) {
    return lastCanvasState;
  }
  let state = canvasFonts.get(context);
  if (!state) {
    const hasKerning = "fontKerning" in context;
    const hasStretch = "fontStretch" in context;
    const hasCaps = "fontVariantCaps" in context;
    const hasLetterSpacing = "letterSpacing" in context;
    const props = context as unknown as Record<string, string>;
    state = {
      font: "",
      shorthandStretch: "normal",
      shorthandCaps: "normal",
      kerning: hasKerning ? props.fontKerning! : "",
      stretch: hasStretch ? props.fontStretch! : "",
      caps: hasCaps ? props.fontVariantCaps! : "",
      letterSpacing: hasLetterSpacing ? props.letterSpacing! : "",
      hasKerning,
      hasStretch,
      hasCaps,
      hasLetterSpacing,
    };
    canvasFonts.set(context, state);
  }
  lastCanvasContext = context;
  lastCanvasState = state;
  return state;
}

function applyCanvasFont(context: CanvasRenderingContext2D, state: CanvasContextState, font: string) {
  // Canvas normalizes the shorthand it reads back. Keep the requested string so
  // an equivalent browser serialization does not cause repeated font parsing.
  if (state.font === font) return;
  const props = context as unknown as Record<string, string>;
  if (state.hasStretch && state.stretch !== "normal") {
    props.fontStretch = "normal";
    state.stretch = "normal";
  }
  if (state.hasCaps && state.caps !== "normal") {
    props.fontVariantCaps = "normal";
    state.caps = "normal";
  }
  context.font = font;
  state.font = font;
  const shorthandStretch = state.hasStretch ? (props.fontStretch || "normal") : "normal";
  const shorthandCaps = state.hasCaps ? (props.fontVariantCaps || "normal") : "normal";
  state.shorthandStretch = shorthandStretch;
  state.shorthandCaps = shorthandCaps;
  state.stretch = shorthandStretch;
  state.caps = shorthandCaps;
}

function countCodePoints(value: string) {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    count += 1;
  }
  return count;
}

export function measureCanvasTextWithShorthand(font: string, value: string): number {
  const context = getMeasurementContext();
  if (!context) return value.length;
  const state = getCanvasContextState(context);
  applyCanvasFont(context, state, font);
  const props = context as unknown as Record<string, string>;
  if (state.hasKerning && state.kerning !== "auto") {
    props.fontKerning = "auto";
    state.kerning = "auto";
  }
  if (state.hasStretch && state.stretch !== state.shorthandStretch && isCanvasFontStretchValue(state.shorthandStretch)) {
    props.fontStretch = state.shorthandStretch;
    state.stretch = state.shorthandStretch;
  }
  if (state.hasCaps && state.caps !== state.shorthandCaps) {
    props.fontVariantCaps = state.shorthandCaps;
    state.caps = state.shorthandCaps;
  }
  if (state.hasLetterSpacing && state.letterSpacing !== "0px") {
    props.letterSpacing = "0px";
    state.letterSpacing = "0px";
  }
  return context.measureText(value).width;
}

export function measureCanvasTextWithStyle(style: ResolvedCanvasStyle, value: string): number {
  const context = getMeasurementContext();
  if (!context) return value.length;
  const state = getCanvasContextState(context);
  applyCanvasFont(context, state, style.font);
  const props = context as unknown as Record<string, string>;
  if (state.hasKerning && state.kerning !== style.kerning) {
    props.fontKerning = style.kerning;
    state.kerning = style.kerning;
  }
  if (state.hasStretch && state.stretch !== style.stretch) {
    props.fontStretch = style.stretch;
    state.stretch = style.stretch;
  }
  if (state.hasCaps && state.caps !== style.caps) {
    props.fontVariantCaps = style.caps;
    state.caps = style.caps;
  }
  if (state.hasLetterSpacing) {
    if (state.letterSpacing !== style.letterSpacing) {
      props.letterSpacing = style.letterSpacing;
      state.letterSpacing = style.letterSpacing;
    }
    return context.measureText(value).width;
  }
  const measuredWidth = context.measureText(value).width;
  const letterSpacing = parseCssPixelValue(style.letterSpacing);
  if (letterSpacing === 0) return measuredWidth;
  return measuredWidth + letterSpacing * Math.max(0, countCodePoints(value) - 1);
}

export function measureCanvasTextFromComputed(computed: CSSStyleDeclaration, value: string): number {
  if (typeof document !== "undefined") watchFontLoads(document.fonts);
  const context = getMeasurementContext();
  if (!context) return value.length;
  const state = getCanvasContextState(context);
  const font = getCanvasFont(computed);
  applyCanvasFont(context, state, font);
  const props = context as unknown as Record<string, string>;
  if (state.hasKerning) {
    const kerning = computed.fontKerning || "auto";
    if (state.kerning !== kerning) {
      props.fontKerning = kerning;
      state.kerning = kerning;
    }
  }
  if (state.hasStretch) {
    const rawStretch = computed.fontStretch;
    const stretch = isCanvasFontStretchValue(rawStretch) ? rawStretch : "normal";
    if (state.stretch !== stretch) {
      props.fontStretch = stretch;
      state.stretch = stretch;
    }
  }
  if (state.hasCaps) {
    const caps = computed.fontVariantCaps || "normal";
    if (state.caps !== caps) {
      props.fontVariantCaps = caps;
      state.caps = caps;
    }
  }
  const rawLetterSpacing = computed.letterSpacing;
  const letterSpacing = !rawLetterSpacing || rawLetterSpacing === "normal" ? "0px" : rawLetterSpacing;
  if (state.hasLetterSpacing) {
    if (state.letterSpacing !== letterSpacing) {
      props.letterSpacing = letterSpacing;
      state.letterSpacing = letterSpacing;
    }
    return context.measureText(value).width;
  }
  const measuredWidth = context.measureText(value).width;
  const letterSpacingPx = parseCssPixelValue(letterSpacing);
  if (letterSpacingPx === 0) return measuredWidth;
  return measuredWidth + letterSpacingPx * Math.max(0, countCodePoints(value) - 1);
}

export function parseCssPixelValue(value: string) {
  if (!value || value === "0px" || value === "0" || value === "normal") return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getHorizontalBoxWidthFromComputed(computed: CSSStyleDeclaration) {
  return parseCssPixelValue(computed.paddingLeft)
    + parseCssPixelValue(computed.paddingRight)
    + parseCssPixelValue(computed.borderLeftWidth)
    + parseCssPixelValue(computed.borderRightWidth);
}

function toUpperCaseMatch(match: string) {
  return match.toUpperCase();
}

export function applyTextTransform(text: string, textTransform: string) {
  switch (textTransform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(CAPITALIZE_RE, toUpperCaseMatch);
    default:
      return text;
  }
}
