import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyInlineMeasurementStyles,
  copyInlineTextMeasurementStyles,
  createCanvasTextMeasurer,
  createInlineMeasurementRoot,
  createInlineTextMeasurementNode,
  getHorizontalBoxWidth,
  INLINE_MEASUREMENT_ROOT_STYLES,
  measureInlineElementWidth,
  measureInlineTextWidth,
  measureInlineTextWidthAuto,
  measureInlineTextWidthExact,
  measureInlineTextWidthFast,
  parseCssPixelValue,
} from "./index";
import { clearInlineMeasurementCacheForTests } from "./testing";

const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const originalGetContext = HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  if (originalOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
  }
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  clearInlineMeasurementCacheForTests();
  vi.restoreAllMocks();
});

function stubCanvasMeasurement(widthPerCharacter: number) {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    font: "",
    measureText: (value: string) => ({ width: value.length * widthPerCharacter }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

describe("inline-measure", () => {
  it("reuses canvas state for repeated measurements and restores interleaved styles", () => {
    const values: Record<string, string> = {
      font: "10px sans-serif", fontKerning: "auto", fontStretch: "normal",
      fontVariantCaps: "normal", letterSpacing: "0px",
    };
    const writes: string[] = [];
    const context = {
      measureText(value: string) {
        return { width: value.length * Number.parseFloat(values.font!) + Number.parseFloat(values.letterSpacing!) };
      },
    };
    for (const property of Object.keys(values)) Object.defineProperty(context, property, {
      get: () => values[property],
      set: (value: string) => { writes.push(property); values[property] = value; },
    });
    HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const styled = createCanvasTextMeasurer({
      font: "16px Inter", fontKerning: "none", fontStretch: "normal",
      fontVariantCaps: "small-caps", letterSpacing: "1px",
    } as CSSStyleDeclaration);
    const normal = createCanvasTextMeasurer("20px Inter");

    expect(styled("AB")).toBe(33);
    const firstWrites = writes.length;
    expect(styled("CD")).toBe(33);
    expect(writes).toHaveLength(firstWrites);
    expect(normal("AB")).toBe(40);
    expect(styled("AB")).toBe(33);
    expect(values).toMatchObject({ fontKerning: "none", fontVariantCaps: "small-caps", letterSpacing: "1px" });
  });

  it("measures text with a fast canvas path and includes inline chrome", () => {
    stubCanvasMeasurement(8);
    const source = document.createElement("span");
    source.style.paddingLeft = "3px";
    source.style.paddingRight = "5px";
    document.body.append(source);

    const width = measureInlineTextWidthFast({
      sourceElement: source,
      text: "Asset",
    });

    expect(width).toBe(48);
    source.remove();
  });

  it("applies letter spacing exactly once when the canvas context supports it", () => {
    const context = {
      font: "",
      fontKerning: "normal",
      fontStretch: "normal",
      fontVariantCaps: "normal",
      letterSpacing: "0px",
      measureText(value: string) {
        const letterSpacing = Number.parseFloat(this.letterSpacing) || 0;
        return {
          width: value.length * 10 + letterSpacing * Math.max(0, Array.from(value).length - 1),
        };
      },
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => context,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const source = document.createElement("span");
    source.style.letterSpacing = "2px";
    document.body.append(source);

    const width = measureInlineTextWidthFast({
      sourceElement: source,
      text: "ABCD",
    });

    expect(width).toBe(46);
    source.remove();
  });

  it("falls back to manual letter spacing when the canvas context does not support it", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      font: "",
      measureText: (value: string) => ({ width: value.length * 10 }),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const measureText = createCanvasTextMeasurer({
      font: "16px Inter",
      fontKerning: "normal",
      fontStretch: "normal",
      fontVariantCaps: "normal",
      letterSpacing: "2px",
    } as CSSStyleDeclaration);

    expect(measureText("ABCD")).toBe(46);
  });

  it("resets canvas text properties between styled and normal measurements", () => {
    const context = {
      font: "",
      fontKerning: "normal",
      fontStretch: "normal",
      fontVariantCaps: "normal",
      letterSpacing: "0px",
      measureText(value: string) {
        const letterSpacing = Number.parseFloat(this.letterSpacing) || 0;
        return {
          width: value.length * 10 + letterSpacing * Math.max(0, Array.from(value).length - 1),
        };
      },
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => context,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const createMeasureText = (letterSpacing: string) => createCanvasTextMeasurer({
      font: "16px Inter",
      fontKerning: "normal",
      fontStretch: "normal",
      fontVariantCaps: "normal",
      letterSpacing,
    } as CSSStyleDeclaration);

    expect(createMeasureText("2px")("ABCD")).toBe(46);
    expect(createMeasureText("normal")("ABCD")).toBe(40);
  });

  it("builds exact DOM text nodes with numeric font features preserved", () => {
    const source = document.createElement("span");
    source.style.fontVariantNumeric = "tabular-nums";
    source.style.fontFeatureSettings = "\"tnum\" 1";
    document.body.append(source);

    const node = createInlineTextMeasurementNode({
      sourceElement: source,
      text: "271.3 KB",
    });

    expect(node.style.fontVariantNumeric).toBe("tabular-nums");
    expect(node.style.fontFeatureSettings).toContain("tnum");
    source.remove();
  });

  it("uses the exact DOM path when requested", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return (this.textContent?.length ?? 0) * 11;
      },
    });

    const source = document.createElement("span");
    document.body.append(source);

    const width = measureInlineTextWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "Folder",
    });

    expect(width).toBe(66);
    source.remove();
  });

  it("keeps exact measurement aligned when tabular numeric style empties the font shorthand", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        const hasExpectedFontLonghands = this.style.fontFamily.includes("Inter")
          && this.style.fontSize === "14px"
          && this.style.fontWeight === "400";
        const widthPerGlyph = hasExpectedFontLonghands ? 8 : 9;
        return (this.textContent?.length ?? 0) * widthPerGlyph;
      },
    });

    const source = document.createElement("span");
    source.className = "tabular-nums";
    source.style.fontFamily = "Inter, sans-serif";
    source.style.fontSize = "14px";
    source.style.fontVariantNumeric = "tabular-nums";
    source.style.fontWeight = "400";
    document.body.append(source);

    const width = measureInlineTextWidth({
      accuracy: "exact",
      sourceElement: source,
      text: "0000-00-00, 00:00:00",
    });

    expect(width).toBe(Array.from("0000-00-00, 00:00:00").length * 8);
    source.remove();
  });

  it("uses calibrated glyph widths for tabular auto measurement", () => {
    stubCanvasMeasurement(5);
    let widthReads = 0;
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        widthReads += 1;
        return (this.textContent?.length ?? 0) * 7;
      },
    });

    const source = document.createElement("span");
    source.className = "tabular-nums";
    document.body.append(source);

    const width = measureInlineTextWidth({
      accuracy: "auto",
      sourceElement: source,
      text: "A12",
    });

    expect(width).toBe(21);
    expect(widthReads).toBe(3);
    source.remove();
  });

  it("calibrates whitespace glyphs at their advance width for tabular auto measurement", () => {
    stubCanvasMeasurement(5);
    // A flex container drops a whitespace-only text run, so a space measured
    // on its own in an inline-flex node reads as 0px in browsers.
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        const text = this.textContent ?? "";
        if (this.style.display.includes("flex") && /^\s+$/.test(text)) return 0;
        return text.length * 7;
      },
    });

    const source = document.createElement("span");
    source.className = "tabular-nums";
    document.body.append(source);

    expect(measureInlineTextWidth({ accuracy: "auto", sourceElement: source, text: "78 × 79" })).toBe(49);
    expect(measureInlineTextWidth({ accuracy: "exact", sourceElement: source, text: " " })).toBe(7);
    source.remove();
  });

  it("reuses tabular glyph calibration for the same style", () => {
    stubCanvasMeasurement(5);
    let widthReads = 0;
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        widthReads += 1;
        return (this.textContent?.length ?? 0) * 7;
      },
    });

    const source = document.createElement("span");
    source.className = "tabular-nums";
    document.body.append(source);

    measureInlineTextWidth({ accuracy: "auto", sourceElement: source, text: "B34" });
    measureInlineTextWidth({ accuracy: "auto", sourceElement: source, text: "4B3" });

    expect(widthReads).toBe(3);
    source.remove();
  });

  it("keeps tabular glyph calibration separate across font loading states", () => {
    stubCanvasMeasurement(5);
    const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
    const fonts = { status: "loading" };
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fonts,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        const widthPerGlyph = fonts.status === "loaded" ? 9 : 7;
        return (this.textContent?.length ?? 0) * widthPerGlyph;
      },
    });

    const source = document.createElement("span");
    source.className = "tabular-nums";
    document.body.append(source);

    try {
      expect(measureInlineTextWidth({ accuracy: "auto", sourceElement: source, text: "12" })).toBe(14);

      fonts.status = "loaded";

      expect(measureInlineTextWidth({ accuracy: "auto", sourceElement: source, text: "12" })).toBe(18);
    } finally {
      source.remove();
      if (originalFonts) {
        Object.defineProperty(document, "fonts", originalFonts);
      } else {
        Reflect.deleteProperty(document, "fonts");
      }
    }
  });

  it("resets font stretch instead of assigning unsupported percentage values", () => {
    const fontStretchSetter = vi.fn();
    let stretch = "";
    const context = {
      font: "",
      fontKerning: "normal",
      fontVariantCaps: "normal",
      letterSpacing: "normal",
      measureText: (value: string) => ({ width: value.length * 8 }),
    };
    Object.defineProperty(context, "fontStretch", {
      configurable: true,
      get: () => stretch,
      set: (value: string) => { fontStretchSetter(value); stretch = value; },
    });
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => context,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const measureText = createCanvasTextMeasurer({
      font: "16px Inter",
      fontKerning: "normal",
      fontStretch: "100%",
      fontVariantCaps: "normal",
      letterSpacing: "normal",
    } as CSSStyleDeclaration);

    expect(measureText("Asset")).toBe(40);
    expect(fontStretchSetter).toHaveBeenCalledOnce();
    expect(fontStretchSetter).toHaveBeenCalledWith("normal");
    expect(fontStretchSetter).not.toHaveBeenCalledWith("100%");
  });

  it("builds a canvas font from computed parts when the shorthand is empty", () => {
    const context = {
      font: "",
      fontKerning: "normal",
      fontStretch: "normal",
      fontVariantCaps: "normal",
      letterSpacing: "normal",
      measureText: (value: string) => ({ width: value.length * 8 }),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => context,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const measureText = createCanvasTextMeasurer({
      font: "",
      fontFamily: "Inter, sans-serif",
      fontSize: "14px",
      fontStretch: "100%",
      fontStyle: "normal",
      fontVariant: "normal",
      fontKerning: "normal",
      fontVariantCaps: "normal",
      fontWeight: "500",
      letterSpacing: "normal",
    } as CSSStyleDeclaration);

    measureText("Folder");

    expect(context.font).toBe("500 14px Inter, sans-serif");
  });

  it("omits numeric variants that are invalid in a canvas font shorthand", () => {
    let font = "10px sans-serif";
    const context = {
      get font() { return font; },
      set font(value: string) { if (!value.includes("tabular-nums")) font = value; },
      measureText: (value: string) => ({ width: value.length * Number(font.match(/(\d+)px/)?.[1]) }),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const measure = createCanvasTextMeasurer({
      font: "", fontFamily: "Inter", fontSize: "14px", fontStyle: "normal",
      fontVariant: "tabular-nums", fontWeight: "400", fontStretch: "normal",
      fontKerning: "auto", fontVariantCaps: "normal", letterSpacing: "normal",
    } as CSSStyleDeclaration);
    expect(measure("AB")).toBe(28);
    expect(context.font).toBe("400 14px Inter");
  });

  it.each(["loadingdone", "loading"])("refreshes a cached canvas font after %s", async (event) => {
    const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
    const fonts = new EventTarget();
    const ready = Promise.resolve(fonts);
    Object.defineProperty(fonts, "ready", { value: ready });
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    let loadedWidth = 5;
    const contexts = new WeakMap<HTMLCanvasElement, { font: string; measureText: (value: string) => { width: number } }>();
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      let context = contexts.get(this);
      if (!context) {
        const resolvedWidth = loadedWidth;
        context = { font: "", measureText: (value: string) => ({ width: value.length * resolvedWidth }) };
        contexts.set(this, context);
      }
      return context;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const measure = createCanvasTextMeasurer("14px Late Font");
    try {
      expect(measure("AB")).toBe(10);
      loadedWidth = 9;
      fonts.dispatchEvent(new Event(event));
      await ready;
      expect(measure("AB")).toBe(18);
    } finally {
      if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
      else Reflect.deleteProperty(document, "fonts");
    }
  });

  it("preserves shorthand caps and stretch across string and computed-style measurers", () => {
    const values = { font: "10px sans-serif", fontStretch: "normal", fontVariantCaps: "normal" };
    const context = {
      get font() { return values.font; },
      set font(value: string) {
        values.font = value;
        values.fontVariantCaps = value.includes("small-caps") ? "small-caps" : "normal";
        values.fontStretch = value.includes("condensed") ? "condensed" : "normal";
      },
      get fontStretch() { return values.fontStretch; },
      set fontStretch(value: string) { values.fontStretch = value; },
      get fontVariantCaps() { return values.fontVariantCaps; },
      set fontVariantCaps(value: string) { values.fontVariantCaps = value; },
      measureText: (value: string) => ({ width: value.length * (values.fontVariantCaps === "small-caps" ? 9 : 8) * (values.fontStretch === "condensed" ? 0.8 : 1) }),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const small = createCanvasTextMeasurer("small-caps condensed 20px Georgia");
    const normal = createCanvasTextMeasurer({ font: "small-caps condensed 20px Georgia", fontVariantCaps: "normal", fontStretch: "normal" } as CSSStyleDeclaration);
    expect(small("ab")).toBe(14.4);
    expect(small("ab")).toBe(14.4);
    expect(normal("ab")).toBe(16);
    expect(small("ab")).toBe(14.4);
  });

  it("creates offscreen roots for batched exact measurement", () => {
    const root = createInlineMeasurementRoot();

    expect(root.style.position).toBe("absolute");
    expect(root.style.visibility).toBe("hidden");
    expect(root.style.pointerEvents).toBe("none");
  });
});

describe("inline-measure exports", () => {
  it("parses CSS pixel values and reads anything unparseable as 0", () => {
    expect(parseCssPixelValue("12.5px")).toBe(12.5);
    expect(parseCssPixelValue("-2px")).toBe(-2);
    expect(parseCssPixelValue("0")).toBe(0);
    expect(parseCssPixelValue("normal")).toBe(0);
    expect(parseCssPixelValue("")).toBe(0);
  });

  it("sums horizontal padding and border, ignoring the vertical ones", () => {
    const source = document.createElement("span");
    source.style.padding = "40px 5px 40px 3px";
    source.style.borderStyle = "solid";
    source.style.borderWidth = "40px 2px 40px 1px";
    document.body.append(source);

    expect(getHorizontalBoxWidth(source)).toBe(11);
    source.remove();
  });

  it("reads an element's rendered width, fractions included", () => {
    const element = document.createElement("span");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ width: 123.5 } as DOMRect);

    expect(measureInlineElementWidth(element)).toBe(123.5);
  });

  it("applies the defined styles and leaves undefined ones untouched", () => {
    const element = document.createElement("div");
    element.style.fontFamily = "Inter";

    // "undefined" would be a valid font family name, so skipping must be explicit.
    applyInlineMeasurementStyles(element, { position: "absolute", fontFamily: undefined });

    expect(element.style.position).toBe("absolute");
    expect(element.style.fontFamily).toBe("Inter");
  });

  it("styles measurement roots with the exported root styles", () => {
    const hostRoot = document.createElement("div");
    applyInlineMeasurementStyles(hostRoot, INLINE_MEASUREMENT_ROOT_STYLES);

    expect(createInlineMeasurementRoot().style.cssText).toBe(hostRoot.style.cssText);
  });

  it("copies the source's text and inline box styles onto an inline-block, unwrapped target", () => {
    const source = document.createElement("span");
    source.style.fontSize = "13px";
    source.style.letterSpacing = "1px";
    source.style.textTransform = "uppercase";
    source.style.paddingLeft = "4px";
    source.style.width = "300px";
    source.style.display = "flex";
    document.body.append(source);
    const target = document.createElement("span");

    copyInlineTextMeasurementStyles(target, source);

    // Not inline-flex: a flex container drops a whitespace-only text run (0.2.1).
    expect(target.style.display).toBe("inline-block");
    expect(target.style.whiteSpace).toBe("pre");
    expect(target.style.width).toBe("max-content");
    expect(target.style.maxWidth).toBe("none");
    expect(target.style.boxSizing).toBe("border-box");
    expect(target.style.fontSize).toBe("13px");
    expect(target.style.letterSpacing).toBe("1px");
    expect(target.style.textTransform).toBe("uppercase");
    expect(target.style.paddingLeft).toBe("4px");
    source.remove();
  });

  it("measures exact width from a styled DOM node and removes it afterwards", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return (this.textContent?.length ?? 0) * Number.parseFloat(this.style.fontSize || "0");
      },
    });
    const source = document.createElement("span");
    source.style.fontSize = "12px";
    document.body.append(source);
    const bodyChildren = document.body.childElementCount;

    expect(measureInlineTextWidthExact({ sourceElement: source, text: "Folder" })).toBe(72);
    expect(document.body.childElementCount).toBe(bodyChildren);
    source.remove();
  });

  it("measures non-tabular text with canvas only in auto accuracy", () => {
    stubCanvasMeasurement(8);
    const offsetWidth = vi.fn(() => 999);
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: offsetWidth });
    const source = document.createElement("span");
    source.style.paddingRight = "2px";
    document.body.append(source);

    expect(measureInlineTextWidthAuto({ sourceElement: source, text: "Asset" })).toBe(42);
    expect(offsetWidth).not.toHaveBeenCalled();
    source.remove();
  });

  it("calibrates tabular numerals set by computed style, not only by class, in auto accuracy", () => {
    stubCanvasMeasurement(5);
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return (this.textContent?.length ?? 0) * 7;
      },
    });
    const source = document.createElement("span");
    source.style.fontVariantNumeric = "tabular-nums";
    document.body.append(source);

    expect(measureInlineTextWidthAuto({ sourceElement: source, text: "123" })).toBe(21);
    source.remove();
  });
});
