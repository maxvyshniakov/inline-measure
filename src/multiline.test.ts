import { afterEach, describe, expect, it, vi } from "vitest";
import { measureInlineTextWidth } from "./index";
import {
  computeMultilineMinContentWidth,
  prepareWrapText,
} from "./multiline-internal";
import { measureInlineTextMultilineWidth } from "./multiline";

const originalGetContext = HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  vi.restoreAllMocks();
});

function stubCanvasMeasurement(measureText: (value: string) => number) {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    font: "",
    measureText: (value: string) => ({ width: measureText(value) }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

describe("prepareWrapText", () => {
  it("collapses collapsible whitespace and preserves UAX#14 opportunities", () => {
    expect(prepareWrapText(" aa\t bb\ncc")).toEqual({
      collapsed: "aa bb cc",
      normalized: "aa bb cc",
      opportunities: [
        { position: 3, softHyphen: false },
        { position: 6, softHyphen: false },
        { position: 8, softHyphen: false },
      ],
    });
  });

  it("keeps non-breaking spaces and remaps soft-hyphen opportunities", () => {
    expect(prepareWrapText(" aa\u00a0bb ")).toEqual({
      collapsed: "aa\u00a0bb ",
      normalized: "aa\u00a0bb ",
      opportunities: [{ position: 6, softHyphen: false }],
    });
    expect(prepareWrapText("супер\u00adдлинное")).toEqual({
      collapsed: "супер\u00adдлинное",
      normalized: "супердлинное",
      opportunities: [
        { position: 5, softHyphen: true },
        { position: 12, softHyphen: false },
      ],
    });
    expect(prepareWrapText("aaaaa").opportunities).toEqual([
      { position: 5, softHyphen: false },
    ]);
  });

  it("collapses every CSS-collapsible line separator before finding opportunities", () => {
    expect(prepareWrapText("aa\u2028bb")).toEqual(prepareWrapText("aa bb"));
  });

  it("preserves soft hyphens in collapsed probe text", () => {
    expect(prepareWrapText("aa\u00adbb\t cc").collapsed).toBe("aa\u00adbb cc");
  });
});

describe("computeMultilineMinContentWidth", () => {
  it("finds the minimum integer width for greedy wrapping", () => {
    const prepared = prepareWrapText("aa bb cc");

    expect(computeMultilineMinContentWidth({
      ...prepared,
      lines: 2,
      measureContent: (value) => value.length,
    })).toBe(5);
    expect(computeMultilineMinContentWidth({
      ...prepared,
      lines: 3,
      measureContent: (value) => value.length,
    })).toBe(2);
    expect(computeMultilineMinContentWidth({
      ...prepared,
      lines: 1,
      measureContent: (value) => value.length,
    })).toBe(8);
  });

  it("trims a trailing collapsible space for the single-line shortcut", () => {
    expect(computeMultilineMinContentWidth({
      ...prepareWrapText("aa "),
      lines: 1,
      measureContent: (value) => value.length,
    })).toBe(2);
  });

  it("returns the first feasible integer width", () => {
    const prepared = prepareWrapText("aa bb ccc");

    expect(computeMultilineMinContentWidth({
      ...prepared,
      lines: 2,
      measureContent: (value) => value.length,
    })).toBe(5);
  });

  it("trims collapsible spaces at line edges but not non-breaking spaces", () => {
    expect(computeMultilineMinContentWidth({
      ...prepareWrapText("aa bb"),
      lines: 2,
      measureContent: (value) => value.length,
    })).toBe(2);
    expect(computeMultilineMinContentWidth({
      normalized: "aa\u00a0bb",
      opportunities: [
        { position: 3, softHyphen: false },
        { position: 5, softHyphen: false },
      ],
      lines: 2,
      measureContent: (value) => value.length,
    })).toBe(3);
  });

  it("does not count forced overflow as fitting", () => {
    expect(computeMultilineMinContentWidth({
      ...prepareWrapText("aaaaa"),
      lines: 10,
      measureContent: (value) => value.length,
    })).toBe(5);
  });

  it("measures a taken soft-hyphen break with its rendered hyphen", () => {
    expect(computeMultilineMinContentWidth({
      ...prepareWrapText("aa\u00adbb"),
      lines: 2,
      measureContent: (value) => value.length,
    })).toBe(3);
  });

  it("continues past a failing soft-hyphen candidate to a later fitting break", () => {
    expect(computeMultilineMinContentWidth({
      ...prepareWrapText("aa\u00adbb cc"),
      lines: 2,
      measureContent: (value) => value === "aa-" ? 5 : value.length,
    })).toBe(4);
  });

  it("memoizes candidates per solver call without leaking between measurers", () => {
    const prepared = prepareWrapText("aa bb cc");
    const calls = new Map<string, number>();
    const firstWidth = computeMultilineMinContentWidth({
      ...prepared,
      lines: 2,
      measureContent: (value) => {
        calls.set(value, (calls.get(value) ?? 0) + 1);
        return value.length;
      },
    });
    const secondWidth = computeMultilineMinContentWidth({
      ...prepared,
      lines: 2,
      measureContent: (value) => value.length * 2,
    });

    expect(firstWidth).toBe(5);
    expect(secondWidth).toBe(10);
    expect([...calls.values()].every((count) => count === 1)).toBe(true);
  });

  it("reuses a shaped candidate across feasibility passes without slicing it again", () => {
    const prepared = prepareWrapText("aa bbb cccc");
    const measurements: string[] = [];
    const slice = vi.spyOn(String.prototype, "slice");
    const width = computeMultilineMinContentWidth({
      ...prepared, lines: 2,
      measureContent: (value) => { measurements.push(value); return value.length; },
    });
    const slices = slice.mock.calls.length;
    slice.mockRestore();
    expect(width).toBe(6);
    // Each exact substring is prepared once, plus the initial full-text bound.
    expect(slices).toBeLessThanOrEqual(measurements.length + 1);
  });
});

describe("measureInlineTextMultilineWidth", () => {
  function createSource() {
    const source = document.createElement("span");
    source.style.lineHeight = "10px";
    document.body.append(source);
    return source;
  }

  function countGreedyLines(text: string, width: number, charWidth: number) {
    const words = text.split(" ");
    let lines = 1;
    let lineWidth = 0;
    for (const word of words) {
      const wordWidth = Array.from(word).length * charWidth;
      const separatorWidth = lineWidth > 0 ? charWidth : 0;
      if (lineWidth > 0 && lineWidth + separatorWidth + wordWidth > width) {
        lines += 1;
        lineWidth = wordWidth;
      } else {
        lineWidth += separatorWidth + wordWidth;
      }
    }
    return lines;
  }

  it("narrows an exact estimate when native wrapping fits at an earlier break", () => {
    stubCanvasMeasurement((value) => value.length * 2);
    const source = createSource();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.style.whiteSpace !== "normal" || this.style.width === "max-content") return { width: 16 } as DOMRect;
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        return { height: countGreedyLines(this.textContent ?? "", width, 1) * 10, width } as DOMRect;
      });
    expect(measureInlineTextMultilineWidth({
      accuracy: "exact", sourceElement: source, text: "aa bb cc", lines: 2,
    })).toBe(5);
    source.remove();
  });

  it("uses native word spacing to establish a feasible exact upper bound", () => {
    stubCanvasMeasurement((value) => value.length);
    const source = createSource();
    source.style.wordSpacing = "4px";
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const nativeWidth = this.style.wordSpacing === "4px" ? 7 : 3;
      return { width: this.style.width === "max-content" ? nativeWidth : Number.parseFloat(this.style.width), height: 10 } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(7);
    expect(measureInlineTextMultilineWidth({
      accuracy: "exact", sourceElement: source, text: "a\u00a0b", lines: 2,
    })).toBe(7);
    source.remove();
  });

  it("proves a nearby exact minimum with a bounded number of native reads", () => {
    stubCanvasMeasurement((value) => value.length + 1);
    const source = createSource();
    const reads = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        return { width, height: countGreedyLines(this.textContent ?? "", width, 1) * 10 } as DOMRect;
      });
    expect(measureInlineTextMultilineWidth({
      accuracy: "exact", sourceElement: source, text: "aa bb cc", lines: 2,
    })).toBe(5);
    expect(reads.mock.calls.length).toBeLessThanOrEqual(4);
    source.remove();
  });

  it("bounds native probe allocation while refreshing text and typography", () => {
    stubCanvasMeasurement(value => value.length);
    const source = createSource();
    const children = document.body.childElementCount;
    const createElement = vi.spyOn(document, "createElement");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        const charWidth = this.style.fontSize === "20px" ? 2 : 1;
        return { width, height: countGreedyLines(this.textContent ?? "", width, charWidth) * 10 } as DOMRect;
      });

    for (let repeat = 0; repeat < 3; repeat += 1) {
      source.style.fontSize = "10px";
      expect(measureInlineTextMultilineWidth({
        accuracy: "exact", sourceElement: source, text: "aa bb cc", lines: 2,
      })).toBe(5);
      source.style.fontSize = "20px";
      expect(measureInlineTextMultilineWidth({
        accuracy: "exact", sourceElement: source, text: "aaa bb ccc", lines: 2,
      })).toBe(12);
      expect(document.body.childElementCount).toBe(children);
    }

    const probeAllocations = createElement.mock.calls.filter(([tag]) => tag === "span" || tag === "div");
    expect(probeAllocations.length).toBeLessThanOrEqual(3);
    source.remove();
  });

  it("keeps an outer exact measurement intact during a nested measurement", () => {
    stubCanvasMeasurement(value => value.length);
    const source = createSource();
    source.style.fontSize = "10px";
    const nestedSource = createSource();
    nestedSource.style.fontSize = "20px";
    const children = document.body.childElementCount;
    let nestedWidth: number | undefined;
    let nested = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (!nested && nestedWidth === undefined) {
          nested = true;
          nestedWidth = measureInlineTextMultilineWidth({
            accuracy: "exact", sourceElement: nestedSource, text: "aaa bb ccc", lines: 2,
          });
          nested = false;
        }
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        const charWidth = this.style.fontSize === "20px" ? 2 : 1;
        return { width, height: countGreedyLines(this.textContent ?? "", width, charWidth) * 10 } as DOMRect;
      });
    expect(measureInlineTextMultilineWidth({
      accuracy: "exact", sourceElement: source, text: "aa bb cc", lines: 2,
    })).toBe(5);
    expect(nestedWidth).toBe(12);
    expect(document.body.childElementCount).toBe(children);
    source.remove();
    nestedSource.remove();
  });

  it("releases detached probes after a failed native read", () => {
    stubCanvasMeasurement(value => value.length);
    const source = createSource();
    source.style.fontSize = "10px";
    const children = document.body.childElementCount;
    const readRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementationOnce(() => { throw new Error("native read failed"); });
    const input = { accuracy: "exact" as const, sourceElement: source, text: "aa bb cc", lines: 2 };
    expect(() => measureInlineTextMultilineWidth(input)).toThrow("native read failed");
    expect(document.body.childElementCount).toBe(children);
    readRect.mockImplementation(function (this: HTMLElement) {
      const width = Number.parseFloat(this.style.width) || 1_000_000;
      return { width, height: countGreedyLines(this.textContent ?? "", width, 1) * 10 } as DOMRect;
    });
    const createElement = vi.spyOn(document, "createElement");
    for (let repeat = 0; repeat < 3; repeat += 1) {
      expect(measureInlineTextMultilineWidth(input)).toBe(5);
    }
    expect(createElement.mock.calls.filter(([tag]) => tag === "span" || tag === "div")).toHaveLength(0);
    expect(document.body.childElementCount).toBe(children);
    source.remove();
  });


  it("adds letter spacing exactly once in the fast path when canvas does not support it", () => {
    stubCanvasMeasurement((value) => value.length);
    const source = document.createElement("span");
    source.style.letterSpacing = "1px";
    document.body.append(source);

    expect(measureInlineTextWidth({
      accuracy: "fast",
      sourceElement: source,
      text: "aa bb",
    })).toBe(9);
    source.remove();
  });

  it("matches fast single-line measurement after wrapping normalization", () => {
    stubCanvasMeasurement((value) => value.length);
    const source = document.createElement("span");
    source.style.paddingLeft = "3px";
    source.style.paddingRight = "2px";
    document.body.append(source);

    const multilineWidth = measureInlineTextMultilineWidth({
      sourceElement: source,
      text: "aa  bb",
      lines: 1,
    });
    const normalizedFastWidth = measureInlineTextWidth({
      accuracy: "fast",
      sourceElement: source,
      text: "aa bb",
    });
    const rawFastWidth = measureInlineTextWidth({
      accuracy: "fast",
      sourceElement: source,
      text: "aa  bb",
    });

    expect(multilineWidth).toBe(normalizedFastWidth);
    expect(rawFastWidth).not.toBe(multilineWidth);
    source.remove();
  });

  it("uses a smaller width for two lines while preserving the widest word", () => {
    stubCanvasMeasurement((value) => value.length);
    const source = document.createElement("span");
    document.body.append(source);

    const oneLineWidth = measureInlineTextMultilineWidth({
      sourceElement: source,
      text: "aa bb cc dd",
      lines: 1,
    });
    const twoLineWidth = measureInlineTextMultilineWidth({
      sourceElement: source,
      text: "aa bb cc dd",
      lines: 2,
    });

    expect(twoLineWidth).toBeLessThan(oneLineWidth);
    expect(twoLineWidth).toBeGreaterThanOrEqual(2);
    source.remove();
  });

  // This test should fail if: exact multiline measurement widens a canvas
  // answer that the real DOM already confirms fits within the line budget.
  it("keeps the canvas answer when the exact DOM wrap probe agrees", () => {
    stubCanvasMeasurement((value) => Array.from(value).length);
    const source = createSource();
    const readRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.style.whiteSpace !== "normal" || this.style.width === "max-content") {
          return { width: 8 } as DOMRect;
        }
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        const lines = countGreedyLines(this.textContent ?? "", width, 1);
        return { height: lines * 10, width } as DOMRect;
      });
    const readOffsetWidth = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(8);

    expect(measureInlineTextMultilineWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "aa bb cc",
      lines: 2,
    })).toBe(5);
    expect(readRect.mock.calls.length).toBeLessThanOrEqual(8);
    expect(readOffsetWidth).not.toHaveBeenCalled();
    source.remove();
  });

  // This test should fail if: exact multiline measurement trusts the
  // canvas-only answer even though real DOM glyphs wrap more widely.
  it("widens to the narrowest exact DOM-feasible integer width", () => {
    stubCanvasMeasurement((value) => Array.from(value).length);
    const source = createSource();
    const readRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.style.whiteSpace !== "normal" || this.style.width === "max-content") {
          return { width: 16 } as DOMRect;
        }
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        const lines = countGreedyLines(this.textContent ?? "", width, 2);
        return { height: lines * 10, width } as DOMRect;
      });

    expect(measureInlineTextMultilineWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "aa bb cc",
      lines: 2,
    })).toBe(10);
    expect(readRect.mock.calls.length).toBeLessThanOrEqual(8);
    source.remove();
  });

  // This test should fail if: exact multiline measurement checks only line
  // count and accepts a line whose unbreakable token overflows horizontally.
  it("widens when an unbreakable token overflows the exact DOM probe", () => {
    stubCanvasMeasurement((value) => Array.from(value).length);
    const source = createSource();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.style.whiteSpace !== "normal" || this.style.width === "max-content") {
          return { width: 12 } as DOMRect;
        }
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        const lines = countGreedyLines(this.textContent ?? "", width, 2);
        return { height: lines * 10, width } as DOMRect;
      });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        if (this.style.whiteSpace !== "normal") return 12;
        return Math.max(
          ...Array.from(this.textContent?.split(" ") ?? [], (word) => word.length * 2),
        );
      });

    expect(measureInlineTextMultilineWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "aaaaa b",
      lines: 2,
    })).toBe(10);
    source.remove();
  });

  it("ceils a fractional exact single-line width before the upward search", () => {
    stubCanvasMeasurement((value) => Array.from(value).length);
    const source = createSource();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.style.whiteSpace !== "normal" || this.style.width === "max-content") {
          return { width: 100.4 } as DOMRect;
        }
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        return { height: width >= 101 ? 10 : 30, width } as DOMRect;
      });

    expect(measureInlineTextMultilineWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "aa bb cc",
      lines: 2,
    })).toBe(101);
    source.remove();
  });

  it.each([undefined, "fast" as const])(
    "keeps %s multiline measurement canvas-only",
    (accuracy) => {
      stubCanvasMeasurement((value) => Array.from(value).length);
      const source = createSource();
      const readRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");

      expect(measureInlineTextMultilineWidth({
        accuracy,
        sourceElement: source,
        text: "aa bb cc",
        lines: 2,
      })).toBe(5);
      expect(readRect).not.toHaveBeenCalled();
      source.remove();
    },
  );

  it("preserves collapsed soft hyphens in the exact DOM probe", () => {
    stubCanvasMeasurement((value) => Array.from(value).length);
    const source = createSource();
    const probeTexts: string[] = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.style.whiteSpace !== "normal" || this.style.width === "max-content") {
          return { width: 8 } as DOMRect;
        }
        probeTexts.push(this.textContent ?? "");
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        const hasManualBreak = this.textContent?.includes("\u00ad") ?? false;
        return { height: hasManualBreak || width >= 8 ? 10 : 30, width } as DOMRect;
      });

    measureInlineTextMultilineWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "aa\u00adbb\t cc",
      lines: 2,
    });
    expect(probeTexts).toContain("aa\u00adbb cc");
    source.remove();
  });

  // This test should fail if: the detached exact-wrap probe omits the source's
  // computed word spacing and therefore wraps with different text metrics.
  it("copies word spacing and optical sizing to the exact DOM wrap probe", () => {
    stubCanvasMeasurement((value) => Array.from(value).length);
    const source = createSource();
    source.style.wordSpacing = "3px";
    source.style.fontOpticalSizing = "none";
    const probeWordSpacings: string[] = [];
    const probeOpticalSizing: string[] = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.style.whiteSpace !== "normal" || this.style.width === "max-content") {
          return { width: 8 } as DOMRect;
        }
        probeWordSpacings.push(this.style.wordSpacing);
        probeOpticalSizing.push(this.style.fontOpticalSizing);
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        return { height: 10, width } as DOMRect;
      });

    measureInlineTextMultilineWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "aa bb cc",
      lines: 2,
    });

    expect(probeWordSpacings.length).toBeGreaterThan(0);
    expect(probeWordSpacings.every((value) => value === "3px")).toBe(true);
    expect(probeOpticalSizing.every((value) => value === "none")).toBe(true);
    source.remove();
  });

  it("adds letter spacing exactly once when canvas does not support it", () => {
    stubCanvasMeasurement((value) => value.length);
    const source = document.createElement("span");
    source.style.letterSpacing = "1px";
    document.body.append(source);

    expect(measureInlineTextMultilineWidth({
      sourceElement: source,
      text: "aa bb",
      lines: 1,
    })).toBe(9);
    source.remove();
  });

  it("applies text transform before preparing wrap opportunities", () => {
    stubCanvasMeasurement((value) => value === "AA BB" ? 17 : value.length);
    const source = document.createElement("span");
    source.style.textTransform = "uppercase";
    document.body.append(source);

    expect(measureInlineTextMultilineWidth({
      sourceElement: source,
      text: "aa  bb",
      lines: 1,
    })).toBe(17);
    source.remove();
  });

  it("returns only inline box chrome for empty text", () => {
    const source = document.createElement("span");
    source.style.paddingLeft = "3px";
    source.style.paddingRight = "5px";
    source.style.borderLeft = "2px solid";
    source.style.borderRight = "4px solid";
    document.body.append(source);
    const readRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");

    expect(measureInlineTextMultilineWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "",
      lines: 2,
    })).toBe(14);
    expect(readRect).not.toHaveBeenCalled();
    source.remove();
  });

  it("handles multiple and consecutive soft hyphens in prepareWrapText", () => {
    expect(prepareWrapText("a\u00adb\u00adc")).toEqual({
      collapsed: "a\u00adb\u00adc",
      normalized: "abc",
      opportunities: [
        { position: 1, softHyphen: true },
        { position: 2, softHyphen: true },
        { position: 3, softHyphen: false },
      ],
    });
    expect(prepareWrapText("aa\u00ad\u00adbb")).toEqual({
      collapsed: "aa\u00ad\u00adbb",
      normalized: "aabb",
      opportunities: [
        { position: 2, softHyphen: true },
        { position: 4, softHyphen: false },
      ],
    });
  });

  it("matches brute-force greedy wrapping across multi-line and soft-hyphen cases", () => {
    const cases = [
      "aa bb cc dd ee ff",
      "Quarterly revenue report for assigned team member 12",
      "co\u00adoperation settings and available storage",
      "super\u00adcali\u00adfragilistic expiali\u00addocious",
      "singleunbreakableword",
      "a b c d e f g h",
      "trailing space   ",
    ];
    const measureContent = (value: string) => {
      let width = 0;
      for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        width += code === 32 ? 3.5 : code === 45 ? 4.2 : (code % 5) + 5.1;
      }
      return width;
    };

    const bruteForce = (normalized: string, opportunities: readonly { position: number; softHyphen: boolean }[], lines: number) => {
      const fullWidth = Math.ceil(measureContent(normalized.replace(/ +$/, "")));
      for (let w = 0; w <= fullWidth; w += 1) {
        let start = 0;
        let used = 0;
        let feasible = true;
        while (start < normalized.length) {
          used += 1;
          if (used > lines) { feasible = false; break; }
          let contentStart = start;
          while (normalized[contentStart] === " ") contentStart += 1;
          let best: { position: number; softHyphen: boolean } | undefined;
          for (const opp of opportunities) {
            if (opp.position <= start) continue;
            let end = opp.position;
            while (end > 0 && normalized[end - 1] === " ") end -= 1;
            const candidate = normalized.slice(contentStart, end) + (opp.softHyphen ? "-" : "");
            if (measureContent(candidate) <= w) best = opp;
          }
          if (!best) { feasible = false; break; }
          if (best.position >= normalized.length) break;
          start = best.position;
        }
        if (feasible) return w;
      }
      return fullWidth;
    };

    for (const text of cases) {
      const prepared = prepareWrapText(text);
      for (const lines of [1, 2, 3, 4]) {
        expect(computeMultilineMinContentWidth({ ...prepared, lines, measureContent }))
          .toBe(bruteForce(prepared.normalized, prepared.opportunities, lines));
      }
    }
  });

  it("skips intermediate last-line break measurements in computeMultilineMinContentWidth", () => {
    const prepared = prepareWrapText("alpha beta gamma delta epsilon zeta");
    const measured: string[] = [];
    const width = computeMultilineMinContentWidth({
      ...prepared,
      lines: 2,
      measureContent: (value) => {
        measured.push(value);
        return value.length * 8;
      },
    });
    expect(width).toBe(144);
    // Reverse scan + last-line shortcut measures far fewer than all O(n^2) substrings.
    expect(measured.length).toBeLessThanOrEqual(8);
  });
});
