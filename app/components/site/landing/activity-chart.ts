export interface ActivityChartPoint {
  /** 0 = oldest hour, 1 = the current hour. */
  x: number;
  /** 0 = bottom, 1 = the chart ceiling. */
  y: number;
  value: number;
  /** Above the ceiling: drawn pinned to the top, the real number kept for the label. */
  clipped: boolean;
}

export interface ActivityChartScale {
  points: ActivityChartPoint[];
  ceiling: number;
  median: number;
  peak: number;
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The ceiling is twice the median hour, so a typical hour sits mid-chart and one
 * burst cannot flatten the other 23. A quiet day (median 0) uses the median of the
 * hours that had launches instead, and the ceiling never exceeds the real peak.
 */
export function scaleActivity(values: readonly number[]): ActivityChartScale {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const peak = clean.reduce((m, v) => Math.max(m, v), 0);
  let median = medianOf(clean);
  if (median === 0) median = medianOf(clean.filter((v) => v > 0));
  const ceiling = Math.max(1, Math.min(peak, 2 * median));
  const last = Math.max(1, clean.length - 1);
  return {
    points: clean.map((value, i) => ({
      x: i / last,
      y: Math.min(1, value / ceiling),
      value,
      clipped: value > ceiling,
    })),
    ceiling,
    median,
    peak,
  };
}
