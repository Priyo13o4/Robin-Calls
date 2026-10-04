/**
 * The landing page's accent colours, in one file for the same reason Section.tsx
 * holds the type scale: nine hand-picked hues drift within a week.
 *
 * The rule these follow: **an accent identifies, it never judges.** A product, a
 * launchpad and an asset category are all facts we hold, so colour there is a
 * label. A verdict score is a claim, and the scanner publishes it as a binary
 * (`VerdictView` is `pass ? "#ccff00" : "#ededea"`), so a three-colour score
 * chip would tell the reader about a risk tier the engine never emits. Score
 * colour stays in `format.ts::scoreColor` and stays binary.
 *
 * Every value is picked to sit on #0a0a0a at small sizes: mid-luminance, low
 * enough saturation not to fight the lime, which is still the only colour on a
 * filled button.
 */

export const PRODUCT_ACCENT = {
  scan: "#ccff00",
  swap: "#ff9a3c",
  wanted: "#ff6f61",
  "night-market": "#6fb7ff",
  rwa: "#4fd6a4",
  ledger: "#ffc44d",
  ecosystem: "#b98bff",
} as const;

export type ProductAccentKey = keyof typeof PRODUCT_ACCENT;

/**
 * Launchpad identity, keyed by the `launchpads.slug` the feed row carries.
 * An unknown pad falls through to paper rather than to a guessed hue — a new
 * pad rendering in another pad's colour is a wrong label, not a missing one.
 */
const LAUNCHPAD_ACCENT: Record<string, string> = {
  ponsv2: "#6fb7ff",
  pons: "#5a8fd0",
  flapsh: "#ff9f4d",
  cashcat: "#ffc44d",
  robinfun: "#4fd6a4",
  party: "#ff7ac6",
  stoxes: "#b98bff",
  stonksafe: "#4fd6a4",
};

export function launchpadAccent(slug: string | null | undefined): string {
  return (slug && LAUNCHPAD_ACCENT[slug]) || "#8a8a8a";
}

// RWA category colour lives in lib/config/rwa-categories.ts, because /rwa
// renders the same chips and a second table here would drift from it.

/** A hex accent at low alpha, for tinted fills and borders. `a` is 0-1. */
export function tint(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
