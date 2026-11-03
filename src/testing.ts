import { tabularGlyphMeasurementCache } from "./internal.js";

/**
 * Forgets every tabular glyph width that `auto` accuracy calibrated against the
 * DOM, so a test that fakes layout starts from an empty cache. Test-only.
 */
export function clearInlineMeasurementCacheForTests() {
  tabularGlyphMeasurementCache.clear();
}
