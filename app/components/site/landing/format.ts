/** Compact USD for dense preview rows ($420K, $1.2M) — full precision lives on the real product pages. */
export function compactUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Score colour follows the one binary the rest of the product uses (VerdictView): lime on CLEAR, paper otherwise. Never a traffic-light palette — see CLAUDE.md's lime discipline. */
export function scoreColor(tier: string): string {
  return tier === "CLEAR" ? "#ccff00" : "#ededea";
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Compact trade/transaction counts (24.1K, 1.2M). Same placeholder discipline as compactUsd. */
export function compactCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
