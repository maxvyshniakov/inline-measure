import { LineBreaker } from "linebreak";

export interface WrapOpportunity {
  position: number;
  softHyphen: boolean;
}

export interface ComputeMultilineMinContentWidthInput {
  normalized: string;
  opportunities: readonly WrapOpportunity[];
  lines: number;
  measureContent: (value: string) => number;
}

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

const COLLAPSIBLE_WS_RE = /[\t\n\v\f\r \u2028\u2029]+/g;
const NEEDS_COLLAPSE_RE = /^ |[\t\n\v\f\r\u2028\u2029]|  /;

export function collapseWhitespace(text: string) {
  if (!NEEDS_COLLAPSE_RE.test(text)) return text;
  const collapsed = text.replace(COLLAPSIBLE_WS_RE, " ");
  return collapsed.charCodeAt(0) === 32 ? collapsed.slice(1) : collapsed;
}

export function prepareWrapText(text: string): {
  collapsed: string;
  normalized: string;
  opportunities: WrapOpportunity[];
} {
  const withSoftHyphens = collapseWhitespace(text);
  const firstShy = withSoftHyphens.indexOf("\u00ad");
  const opportunities: WrapOpportunity[] = [];

  if (firstShy === -1) {
    const lineBreaker = new LineBreaker(withSoftHyphens);
    let prevPos = -1;
    for (let lineBreak = lineBreaker.nextBreak(); lineBreak; lineBreak = lineBreaker.nextBreak()) {
      const position = lineBreak.position;
      if (position !== prevPos) {
        opportunities.push({ position, softHyphen: false });
        prevPos = position;
      }
    }
    return {
      collapsed: withSoftHyphens,
      normalized: withSoftHyphens,
      opportunities,
    };
  }

  const softHyphenOffsets: number[] = [];
  let normalized = "";
  let chunkStart = 0;
  for (let index = firstShy; index !== -1; index = withSoftHyphens.indexOf("\u00ad", index + 1)) {
    softHyphenOffsets.push(index);
    normalized += withSoftHyphens.slice(chunkStart, index);
    chunkStart = index + 1;
  }
  normalized += withSoftHyphens.slice(chunkStart);

  const lineBreaker = new LineBreaker(withSoftHyphens);
  let shyIndex = 0;
  const shyCount = softHyphenOffsets.length;
  for (let lineBreak = lineBreaker.nextBreak(); lineBreak; lineBreak = lineBreaker.nextBreak()) {
    const breakPos = lineBreak.position;
    while (shyIndex < shyCount && softHyphenOffsets[shyIndex]! < breakPos) {
      shyIndex += 1;
    }
    const position = breakPos - shyIndex;
    const softHyphen = shyIndex > 0 && softHyphenOffsets[shyIndex - 1] === breakPos - 1;
    const last = opportunities[opportunities.length - 1];
    if (last !== undefined && last.position === position) {
      if (softHyphen) last.softHyphen = true;
    } else {
      opportunities.push({ position, softHyphen });
    }
  }

  return {
    collapsed: withSoftHyphens,
    normalized,
    opportunities,
  };
}

export function trimTrailingCollapsibleSpacePosition(value: string, position: number) {
  let trimmedPosition = position;
  while (trimmedPosition > 0 && value.charCodeAt(trimmedPosition - 1) === 32) trimmedPosition -= 1;
  return trimmedPosition;
}

export function trimTrailingCollapsibleSpaces(value: string) {
  const trimmedPosition = trimTrailingCollapsibleSpacePosition(value, value.length);
  return trimmedPosition === value.length ? value : value.slice(0, trimmedPosition);
}

export function computeMultilineMinContentWidth({
  lines,
  measureContent,
  normalized,
  opportunities,
}: ComputeMultilineMinContentWidthInput) {
  const normalizedLength = normalized.length;
  if (normalizedLength === 0) return 0;
  if (lines <= 1) return Math.ceil(measureContent(trimTrailingCollapsibleSpaces(normalized)));

  const opportunityCount = opportunities.length;
  if (
    opportunityCount === 0
    || (opportunityCount === 1
      && opportunities[0]!.position >= normalizedLength
      && !opportunities[0]!.softHyphen)
  ) {
    return Math.ceil(measureContent(trimTrailingCollapsibleSpaces(normalized)));
  }

  const measurementCache = new Map<string, number>();
  const measureCached = (value: string) => {
    const cached = measurementCache.get(value);
    if (cached !== undefined) return cached;

    const measured = measureContent(value);
    measurementCache.set(value, measured);
    return measured;
  };

  const fullTrimmed = trimTrailingCollapsibleSpaces(normalized);
  const fullWidth = measureCached(fullTrimmed);
  let hi = Math.ceil(fullWidth);
  if (hi <= 0) return hi;

  const contentEnds = new Int32Array(opportunityCount);
  for (let i = 0; i < opportunityCount; i += 1) {
    contentEnds[i] = trimTrailingCollapsibleSpacePosition(normalized, opportunities[i]!.position);
  }

  // Row 0 is startPos = 0 (startIndex = -1); row k + 1 is opportunities[k].position.
  const rowStarts = new Int32Array(opportunityCount + 1);
  rowStarts.fill(-1);
  const rowWidths: (Float64Array | undefined)[] = [];

  const getRowWidths = (rowIndex: number, startPos: number) => {
    let widths = rowWidths[rowIndex];
    if (widths === undefined) {
      let contentStart = startPos;
      while (contentStart < normalizedLength && normalized.charCodeAt(contentStart) === 32) {
        contentStart += 1;
      }
      rowStarts[rowIndex] = contentStart;
      widths = new Float64Array(opportunityCount);
      widths.fill(Number.NaN);
      rowWidths[rowIndex] = widths;
    }
    return widths;
  };

  if (normalized.charCodeAt(0) !== 32) {
    const lastOpp = opportunities[opportunityCount - 1]!;
    if (lastOpp.position === normalizedLength && !lastOpp.softHyphen) {
      const widths0 = getRowWidths(0, 0);
      widths0[opportunityCount - 1] = fullWidth;
    }
  }

  let usedMaxWidth = Number.NEGATIVE_INFINITY;
  let minRejectedWidth = Number.POSITIVE_INFINITY;

  const isFeasible = (width: number) => {
    let startIndex = -1;
    let startPos = 0;
    let usedLines = 0;
    usedMaxWidth = Number.NEGATIVE_INFINITY;
    minRejectedWidth = Number.POSITIVE_INFINITY;

    while (startPos < normalizedLength) {
      usedLines += 1;
      if (usedLines > lines) return false;

      const rowIndex = startIndex + 1;
      const widths = getRowWidths(rowIndex, startPos);
      const contentStart = rowStarts[rowIndex]!;
      const isLastLine = usedLines === lines;

      let fittedIndex = -1;
      // Scan from the farthest opportunity backward: the first fitting candidate
      // is guaranteed to be the farthest greedy break, even with non-monotonic
      // soft-hyphen widths. On the final line, only end-reaching opportunities
      // can succeed, skipping all intermediate break measurements.
      for (let index = opportunityCount - 1; index > startIndex; index -= 1) {
        const opportunity = opportunities[index]!;
        if (opportunity.position <= startPos) break;
        if (isLastLine && opportunity.position < normalizedLength) return false;

        let candidateWidth = widths[index]!;
        if (candidateWidth !== candidateWidth) {
          // Keep full-substring shaping, including kerning and signed spacing.
          // Later feasibility passes use numbers without constructing strings.
          const slice = normalized.slice(contentStart, contentEnds[index]!);
          const candidate = opportunity.softHyphen ? `${slice}-` : slice;
          candidateWidth = measureCached(candidate);
          widths[index] = candidateWidth;
        }

        if (candidateWidth <= width) {
          if (candidateWidth > usedMaxWidth) usedMaxWidth = candidateWidth;
          if (opportunity.position >= normalizedLength) return true;
          fittedIndex = index;
          startPos = opportunity.position;
          break;
        }
        if (candidateWidth < minRejectedWidth) minRejectedWidth = candidateWidth;
      }

      if (fittedIndex === -1) return false;
      startIndex = fittedIndex;
    }

    return true;
  };

  let lo = -1;
  let firstProbe = lines > 2;
  while (hi - lo > 1) {
    let middle: number;
    if (firstProbe) {
      firstProbe = false;
      const estimate = Math.ceil(hi / lines);
      middle = estimate > lo && estimate < hi ? estimate : Math.floor((lo + hi) / 2);
    } else {
      middle = Math.floor((lo + hi) / 2);
    }
    if (isFeasible(middle)) {
      const tightenedHi = Number.isFinite(usedMaxWidth) ? Math.max(lo + 1, Math.ceil(usedMaxWidth)) : middle;
      hi = tightenedHi < middle ? tightenedHi : middle;
    } else if (Number.isFinite(minRejectedWidth)) {
      const nextLo = Math.ceil(minRejectedWidth) - 1;
      lo = nextLo > middle ? Math.min(nextLo, hi - 1) : middle;
    } else {
      lo = middle;
    }
  }

  return hi;
}
