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
