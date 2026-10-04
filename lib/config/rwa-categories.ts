/**
 * RWA registry categories: how they are named and coloured, in one table.
 *
 * `registry.category` stores `stock-token` and `etf` (plus `stablecoin` and
 * `infra`, which the RWA reads filter out). Two surfaces render them — the
 * landing showcase and /rwa — and they had two copies of the mapping until the
 * filter row landed on both. An unmapped value falls through to itself rather
 * than to a guess, so a category added to the DB shows its raw name instead of
 * silently wearing another category's label.
 */
const LABELS: Record<string, string> = {
  "stock-token": "Equity",
  etf: "ETF",
};

/** Identity, never judgement — same rule as landing/palette.ts. */
const ACCENTS: Record<string, string> = {
  "stock-token": "#6fb7ff",
  etf: "#4fd6a4",
};

export function rwaCategoryLabel(category: string): string {
  return LABELS[category] ?? category.replace(/-/g, " ");
}

export function rwaCategoryAccent(category: string | null | undefined): string {
  return (category && ACCENTS[category]) || "#8a8a8a";
}
