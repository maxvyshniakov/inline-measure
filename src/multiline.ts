import LineBreaker from "linebreak";
import { applyTextTransform, getHorizontalBoxWidthFromComputed } from "./internal.js";
import {
  applyInlineMeasurementStyles,
  createCanvasTextMeasurer,
  createInlineMeasurementRoot,
  createInlineTextMeasurementNode,
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

export function prepareWrapText(text: string): {
  collapsed: string;
  normalized: string;
  opportunities: WrapOpportunity[];
} {
  const withSoftHyphens = text.replace(/[\t\n\v\f\r \u2028\u2029]+/g, " ").replace(/^ +/, "");
  const softHyphenOffsets = new Set<number>();
  let normalized = "";

  for (let index = 0; index < withSoftHyphens.length; index += 1) {
    if (withSoftHyphens[index] === "\u00ad") {
      softHyphenOffsets.add(index);
    } else {
      normalized += withSoftHyphens[index];
    }
  }

  const opportunitiesByPosition = new Map<number, WrapOpportunity>();
  const lineBreaker = new LineBreaker(withSoftHyphens);
  for (let lineBreak = lineBreaker.nextBreak(); lineBreak; lineBreak = lineBreaker.nextBreak()) {
    let removedSoftHyphens = 0;
    for (const offset of softHyphenOffsets) {
      if (offset < lineBreak.position) removedSoftHyphens += 1;
    }
    const position = lineBreak.position - removedSoftHyphens;
    const softHyphen = softHyphenOffsets.has(lineBreak.position - 1);
    const existing = opportunitiesByPosition.get(position);
    opportunitiesByPosition.set(position, {
      position,
      softHyphen: existing?.softHyphen || softHyphen,
    });
  }

  return {
    collapsed: withSoftHyphens,
    normalized,
    opportunities: [...opportunitiesByPosition.values()].sort((left, right) => left.position - right.position),
  };
}

const WRAP_TEXT_STYLE_PROPERTIES = [
  "font",
  "fontFamily",
  "fontFeatureSettings",
  "fontKerning",
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
] as const satisfies ReadonlyArray<keyof CSSStyleDeclaration>;

function createMultilineWrapProbe(
  ownerDocument: Document,
  computed: CSSStyleDeclaration,
  text: string,
  width: string,
) {
  const probe = ownerDocument.createElement("span");
  probe.textContent = text;
  applyInlineMeasurementStyles(probe, {
    borderLeftWidth: "0",
    borderRightWidth: "0",
    boxSizing: "border-box",
    display: "block",
    hyphens: "manual",
    overflowWrap: "normal",
    paddingLeft: "0",
    paddingRight: "0",
    textTransform: "none",
    whiteSpace: "normal",
    width,
    wordBreak: "normal",
  });
  probe.style.setProperty("text-wrap", "wrap");

  for (const property of WRAP_TEXT_STYLE_PROPERTIES) {
    probe.style[property as never] = computed[property] as never;
  }
  probe.style.textTransform = "none";
  return probe;
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
  const root = createInlineMeasurementRoot(ownerDocument);
  const baseline = createMultilineWrapProbe(ownerDocument, computed, collapsed, "1000000px");
  const candidate = createMultilineWrapProbe(
    ownerDocument,
    computed,
    collapsed,
    `${canvasContentWidth}px`,
  );
  root.append(baseline, candidate);
  ownerDocument.body.appendChild(root);

  try {
    const singleLineHeight = baseline.getBoundingClientRect().height;
    const fits = (width: number) => {
      candidate.style.width = `${width}px`;
      const height = candidate.getBoundingClientRect().height;
      return height <= singleLineHeight * lines + 0.5
        && candidate.scrollWidth <= Math.ceil(width);
    };

    if (fits(canvasContentWidth)) return canvasContentWidth;

    const singleLineNode = createInlineTextMeasurementNode({
      sourceElement,
      text: collapsed,
    });
    singleLineNode.style.textTransform = "none";
    root.appendChild(singleLineNode);
    const boxWidth = getHorizontalBoxWidthFromComputed(computed);
    let hi = Math.ceil(singleLineNode.getBoundingClientRect().width - boxWidth);
    let lo = canvasContentWidth;
    hi = Math.max(hi, lo + 1);

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
  }
}

export function computeMultilineMinContentWidth({
  lines,
  measureContent,
  normalized,
  opportunities,
}: ComputeMultilineMinContentWidthInput) {
  if (!normalized) return 0;
  if (lines <= 1) return Math.ceil(measureContent(trimTrailingCollapsibleSpaces(normalized)));

  const measurementCache = new Map<string, number>();
  const measureCached = (value: string) => {
    const cached = measurementCache.get(value);
    if (cached !== undefined) return cached;

    const measured = measureContent(value);
    measurementCache.set(value, measured);
    return measured;
  };
  const measureCandidate = (start: number, opportunity: WrapOpportunity) => {
    let contentStart = start;
    while (normalized[contentStart] === " ") contentStart += 1;

    const contentEnd = trimTrailingCollapsibleSpacePosition(normalized, opportunity.position);

    const candidate = normalized.slice(contentStart, contentEnd)
      + (opportunity.softHyphen ? "-" : "");
    return measureCached(candidate);
  };
  const isFeasible = (width: number) => {
    let start = 0;
    let usedLines = 0;

    while (start < normalized.length) {
      usedLines += 1;
      if (usedLines > lines) return false;

      let farthestFittingOpportunity: WrapOpportunity | undefined;
      for (const opportunity of opportunities) {
        if (opportunity.position <= start) continue;
        if (measureCandidate(start, opportunity) <= width) {
          farthestFittingOpportunity = opportunity;
        }
      }

      if (!farthestFittingOpportunity) return false;
      if (farthestFittingOpportunity.position >= normalized.length) return true;
      start = farthestFittingOpportunity.position;
    }

    return true;
  };

  let lo = -1;
  let hi = Math.ceil(measureCached(trimTrailingCollapsibleSpaces(normalized)));
  while (hi - lo > 1) {
    const middle = Math.floor((lo + hi) / 2);
    if (isFeasible(middle)) {
      hi = middle;
    } else {
      lo = middle;
    }
  }

  return hi;
}

function trimTrailingCollapsibleSpaces(value: string) {
  return value.slice(0, trimTrailingCollapsibleSpacePosition(value, value.length));
}

function trimTrailingCollapsibleSpacePosition(value: string, position: number) {
  let trimmedPosition = position;
  while (value[trimmedPosition - 1] === " ") trimmedPosition -= 1;
  return trimmedPosition;
}

export function measureInlineTextMultilineWidth({
  accuracy,
  sourceElement,
  text,
  lines,
}: InlineTextMultilineMeasureInput) {
  const computed = window.getComputedStyle(sourceElement);
  const prepared = prepareWrapText(applyTextTransform(text, computed.textTransform));
  const contentWidth = computeMultilineMinContentWidth({
    ...prepared,
    lines,
    measureContent: createCanvasTextMeasurer(computed),
  });
  if (!prepared.normalized || accuracy !== "exact" || lines <= 1) {
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
