/**
 * Source text with comments removed, for WIRING tests that grep code. Prose mentioning a
 * pattern is a pointer, not a use: a comment explaining the `addresses.weth` trap once
 * failed the very test written to forbid it. Crude by design: it also strips `//` inside
 * string literals, so never use it on a pattern that lives in a URL.
 */
export const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

/**
 * A bounded slice between two markers, for WIRING tests that assert over one function.
 *
 * Six bugs on this branch came from hand-rolled slices, in three shapes, and all three are
 * silent: an end marker searched from index 0 that a block ABOVE also contains, an `indexOf`
 * that returns -1 so `slice(start, -1)` quietly spans the rest of the file, and a slice with
 * no end at all that is satisfied by a match far below the region under test. A `length > 100`
 * guard catches none of them, because the wrong slice is usually the LONG one.
 *
 * So this throws rather than returning something assertable. §8 #22: an extraction-based test
 * must fail loudly when the extraction misses, never assert over what it happened to grab.
 */
export function between(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`extraction failed: start marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`extraction failed: end marker not found after start: ${endMarker}`);
  return src.slice(start, end);
}
