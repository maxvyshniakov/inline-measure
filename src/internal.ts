// Tabular glyph widths calibrated against the DOM, keyed by text style
// signature. It lives here, outside the public entrypoints, so that the root
// entrypoint and `./testing` share one cache.
export const tabularGlyphMeasurementCache = new Map<string, Map<string, number>>();

function parseCssPixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getHorizontalBoxWidthFromComputed(computed: CSSStyleDeclaration) {
  return parseCssPixelValue(computed.paddingLeft)
    + parseCssPixelValue(computed.paddingRight)
    + parseCssPixelValue(computed.borderLeftWidth)
    + parseCssPixelValue(computed.borderRightWidth);
}

export function applyTextTransform(text: string, textTransform: string) {
  switch (textTransform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/\b\p{L}/gu, (match) => match.toUpperCase());
    default:
      return text;
  }
}
