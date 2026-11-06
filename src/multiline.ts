import LineBreaker from "linebreak";
import { applyTextTransform, getHorizontalBoxWidthFromComputed } from "./internal.js";
import {
  applyInlineMeasurementStyles,
  createCanvasTextMeasurer,
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

interface MultilineWrapProbes {
  root: HTMLElement;
  baseline: HTMLElement;
  candidate: HTMLElement;
  styleKey: string;
  busy: boolean;
}

// Retain only one detached pair per document, never measured widths or heights.
// Reattaching it still lets the browser resolve loaded fonts and native breaks.
const multilineWrapProbes = new WeakMap<Document, MultilineWrapProbes>();

function acquireMultilineWrapProbes(
  ownerDocument: Document,
  computed: CSSStyleDeclaration,
  text: string,
  width: number,
) {
  const styleValues = WRAP_TEXT_STYLE_PROPERTIES.map(property => computed[property]);
  const styleKey = styleValues.join("\0");
  let probes = multilineWrapProbes.get(ownerDocument);
  if (!probes || probes.busy) {
    // A nested measurement must not overwrite the outer call's probes.
    const root = createInlineMeasurementRoot(ownerDocument);
    const baseline = createMultilineWrapProbe(ownerDocument, computed, text, "1000000px");
    const candidate = createMultilineWrapProbe(ownerDocument, computed, text, `${width}px`);
    root.append(baseline, candidate);
    const fresh = { root, baseline, candidate, styleKey, busy: false };
    if (!probes) multilineWrapProbes.set(ownerDocument, fresh);
    probes = fresh;
  } else {
    probes.baseline.textContent = text;
    probes.candidate.textContent = text;
    probes.candidate.style.width = `${width}px`;
    if (probes.styleKey !== styleKey) {
      for (const probe of [probes.baseline, probes.candidate]) {
        for (let index = 0; index < WRAP_TEXT_STYLE_PROPERTIES.length; index += 1) {
          probe.style[WRAP_TEXT_STYLE_PROPERTIES[index] as never] = styleValues[index] as never;
        }
        probe.style.textTransform = "none";
      }
      probes.styleKey = styleKey;
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

  try {
    ownerDocument.body.appendChild(root);
    const singleLineHeight = baseline.getBoundingClientRect().height;
    const fits = (width: number) => {
      candidate.style.width = `${width}px`;
      const height = candidate.getBoundingClientRect().height;
      return height <= singleLineHeight * lines + 0.5
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
  const contentEnds = opportunities.map((opportunity) =>
    trimTrailingCollapsibleSpacePosition(normalized, opportunity.position));
  const rows = new Map<number, { contentStart: number; widths: (number | undefined)[] }>();
  const getRow = (start: number) => {
    let row = rows.get(start);
    if (!row) {
      let contentStart = start;
      while (normalized[contentStart] === " ") contentStart += 1;
      row = { contentStart, widths: [] };
      rows.set(start, row);
    }
    return row;
  };
  const isFeasible = (width: number) => {
    let start = 0;
    let usedLines = 0;

    while (start < normalized.length) {
      usedLines += 1;
      if (usedLines > lines) return false;

      let farthestFittingOpportunity: WrapOpportunity | undefined;
      const row = getRow(start);
      for (let index = 0; index < opportunities.length; index += 1) {
        const opportunity = opportunities[index]!;
        if (opportunity.position <= start) continue;
        let candidateWidth = row.widths[index];
        if (candidateWidth === undefined) {
          // Keep full-substring shaping, including kerning and signed spacing.
          // Later feasibility passes use numbers without constructing strings.
          const candidate = normalized.slice(row.contentStart, contentEnds[index])
            + (opportunity.softHyphen ? "-" : "");
          candidateWidth = measureCached(candidate);
          row.widths[index] = candidateWidth;
        }
        if (candidateWidth <= width) {
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
