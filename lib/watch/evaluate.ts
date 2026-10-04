export interface TokenSeriesRow {
  liq: number | null;
  price: number | null;
  ts: number;
}

export interface WatchEvalConfig {
  minPeakUsd: number;
  drainThreshold: number;
  pumpDumpWindowHours: number;
  pumpDumpCollapsePct: number;
}

export interface TokenDrainResult {
  pct: number;
  peak: number;
  current: number;
}

export interface CollapseCandidateResult {
  peakPrice: number | null;
  fastLiqPeak: number;
  trigger: "price-collapse" | "liquidity-collapse";
}

export interface TokenEvaluationResult {
  drain: TokenDrainResult | null;
  clearDrain: boolean;
  collapseCandidate: CollapseCandidateResult | null;
  skipped: string | null;
}

/**
 * Evaluates a single token's newest-first snapshot series against drain and collapse criteria.
 * Reproduces slow-rug monitor math (§4.3, PRD §15.5) as a pure function.
 */
export function evaluateTokenSeries(
  rows: TokenSeriesRow[],
  nowMs: number,
  cfg: WatchEvalConfig
): TokenEvaluationResult {
  if (rows.length < 2) {
    return {
      drain: null,
      clearDrain: false,
      collapseCandidate: null,
      skipped: "insufficient_history",
    };
  }

  const latest = rows[0]; // newest-first
  const liqPeak = Math.max(...rows.map((r) => r.liq ?? 0));

  let drain: TokenDrainResult | null = null;
  let clearDrain = false;

  if (liqPeak >= cfg.minPeakUsd && latest.liq != null) {
    const drainPct = 1 - latest.liq / liqPeak;
    if (drainPct >= cfg.drainThreshold) {
      drain = {
        pct: Number(drainPct.toFixed(4)),
        peak: liqPeak,
        current: latest.liq,
      };
    } else {
      clearDrain = true;
    }
  }

  const fastWindowStart = nowMs - cfg.pumpDumpWindowHours * 36e5;
  const fast = rows.filter((r) => r.ts >= fastWindowStart);
  let collapseCandidate: CollapseCandidateResult | null = null;

  if (fast.length >= 2) {
    const peakPrice = Math.max(...fast.map((r) => r.price ?? 0)) || null;
    const fastLiqPeak = Math.max(...fast.map((r) => r.liq ?? 0));
    if (fastLiqPeak >= cfg.minPeakUsd) {
      const priceCollapsed =
        peakPrice != null &&
        latest.price != null &&
        latest.price <= peakPrice * (1 - cfg.pumpDumpCollapsePct);
      const liqCollapsed =
        latest.liq != null &&
        latest.liq <= fastLiqPeak * (1 - cfg.pumpDumpCollapsePct);

      if (priceCollapsed || liqCollapsed) {
        collapseCandidate = {
          peakPrice,
          fastLiqPeak,
          trigger: priceCollapsed ? "price-collapse" : "liquidity-collapse",
        };
      }
    }
  }

  return {
    drain,
    clearDrain,
    collapseCandidate,
    skipped: null,
  };
}
