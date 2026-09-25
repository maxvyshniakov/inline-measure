import { afterEach, describe, expect, it, vi } from "vitest";
import { measureInlineTextWidthFast } from "./index";
import {
  computeMultilineMinContentWidth,
  measureInlineTextMultilineWidth,
  prepareWrapText,
} from "./multiline";

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

  it("adds letter spacing exactly once in the fast path when canvas does not support it", () => {
    stubCanvasMeasurement((value) => value.length);
    const source = document.createElement("span");
    source.style.letterSpacing = "1px";
    document.body.append(source);

    expect(measureInlineTextWidthFast({
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
    const normalizedFastWidth = measureInlineTextWidthFast({
      sourceElement: source,
      text: "aa bb",
    });
    const rawFastWidth = measureInlineTextWidthFast({
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
        if (this.style.whiteSpace !== "normal") {
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
    expect(readRect).toHaveBeenCalledTimes(2);
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
        if (this.style.whiteSpace !== "normal") {
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
        if (this.style.whiteSpace !== "normal") {
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
        if (this.style.whiteSpace !== "normal") {
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
        if (this.style.whiteSpace !== "normal") {
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
  it("copies word spacing to the exact DOM wrap probe", () => {
    stubCanvasMeasurement((value) => Array.from(value).length);
    const source = createSource();
    source.style.wordSpacing = "3px";
    const probeWordSpacings: string[] = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.style.whiteSpace !== "normal") {
          return { width: 8 } as DOMRect;
        }
        probeWordSpacings.push(this.style.wordSpacing);
        const width = Number.parseFloat(this.style.width) || 1_000_000;
        return { height: 10, width } as DOMRect;
      });

    measureInlineTextMultilineWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "aa bb cc",
      lines: 2,
    });

    expect(probeWordSpacings).toEqual(["3px", "3px"]);
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
});
