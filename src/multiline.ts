import LineBreaker from "linebreak";
import {
  applyTextTransform,
  getHorizontalBoxWidthFromComputed,
  measureCanvasTextFromComputed,
  measureCanvasTextWithStyle,
  resolveCanvasStyleFromComputed,
  watchFontLoads,
} from "./internal.js";
import {
  createInlineMeasurementRoot,
  type InlineMeasureAccuracy,
} from "./index.js";

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

export interface InlineTextMultilineMeasureInput {
  accuracy?: InlineMeasureAccuracy;
  sourceElement: HTMLElement;
  text: string;
  lines: number;
}

const COLLAPSIBLE_WS_RE = /[\t\n\v\f\r \u2028\u2029]+/g;
const NEEDS_COLLAPSE_RE = /^ |[\t\n\v\f\r\u2028\u2029]|  /;

function collapseWhitespace(text: string) {
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

function trimTrailingCollapsibleSpaces(value: string) {
  const trimmedPosition = trimTrailingCollapsibleSpacePosition(value, value.length);
  return trimmedPosition === value.length ? value : value.slice(0, trimmedPosition);
}

function trimTrailingCollapsibleSpacePosition(value: string, position: number) {
  let trimmedPosition = position;
  while (trimmedPosition > 0 && value.charCodeAt(trimmedPosition - 1) === 32) trimmedPosition -= 1;
  return trimmedPosition;
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
