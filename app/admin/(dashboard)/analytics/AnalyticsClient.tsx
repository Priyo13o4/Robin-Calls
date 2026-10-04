"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import type {
  TimeRange,
  TimeseriesPoint,
  TopRankedItem,
  DeviceBreakdown,
  AnalyticsSummary,
  IngestHealth,
  BotTrend,
} from "@/lib/data/analytics";
import { getCountryInfo } from "@/lib/data/countries";
import { TONE } from "../../components/ui";

export type MetricType = "views" | "visitors" | "latency" | "errors" | "bytes";

// Every dataset the export route can serialize — see
// app/admin/(dashboard)/analytics/export/route.ts's DATASETS list.
export type ExportDataset =
  | "summary" | "timeseries" | "pages" | "referrers"
  | "countries" | "devices" | "browsers" | "os" | "bots";

function exportHref(dataset: ExportDataset, range: TimeRange): string {
  return `/admin/analytics/export?dataset=${dataset}&range=${range}`;
}

/** Small "⤓ CSV" link, styled to sit in a panel header without competing with its title. */
function ExportLink({ dataset, range }: { dataset: ExportDataset; range: TimeRange }) {
  return (
    <a
      href={exportHref(dataset, range)}
      className="font-mono text-[10px] text-[#666] transition-colors hover:text-[#ccff00]"
      title={`Export ${dataset} as CSV`}
    >
      ⤓ CSV
    </a>
  );
}

/** "Xs ago" / "Xm ago" / "Xh ago", recomputed by the caller's ticking clock. */
function formatRelativeTime(iso: string | null, now: number): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const deltaSec = Math.max(0, Math.round((now - then) / 1000));
  if (deltaSec < 5) return "just now";
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.round(deltaMin / 60);
  return `${deltaHr}h ago`;
}

// ── Formatting Utilities ────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTimestamp(iso: string): { time: string; date: string; full: string } {
  try {
    const d = new Date(iso);
    const time = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    const date = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return {
      time: `${time} UTC`,
      date,
      full: `${date}, ${time} UTC`,
    };
  } catch {
    return { time: iso, date: "", full: iso };
  }
}

// ── Delta Badge ─────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const isPositive = delta > 0;
  return (
    <span
      className={`inline-flex items-center font-mono text-[10px] font-bold ${
        isPositive ? "text-[#8fbf6a]" : "text-[#e0897a]"
      }`}
    >
      {isPositive ? `+${delta}%` : `${delta}%`}
    </span>
  );
}

// ── Time Range Picker ───────────────────────────────────────────────────────

interface TimeRangePickerProps {
  currentRange: TimeRange;
}

export function TimeRangePicker({ currentRange }: TimeRangePickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setRange = (range: TimeRange) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);
    router.push(`/admin/analytics?${params.toString()}`, { scroll: false });
  };

  const ranges: { id: TimeRange; label: string }[] = [
    { id: "24h", label: "24 HOURS" },
    { id: "7d", label: "7 DAYS" },
    { id: "30d", label: "30 DAYS" },
  ];

  return (
    <div className="inline-flex rounded-none border border-[#2a2a2a] bg-[#141414] p-0.5 font-mono text-[11px]">
      {ranges.map((r) => {
        const active = currentRange === r.id;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            className={`px-3 py-1.5 transition-all ${
              active
                ? "border border-[#ccff00]/40 bg-[#1c220a] font-bold text-[#ccff00] shadow-[inset_0_1px_0_rgba(204,255,0,0.2)]"
                : "text-[#8a8a8a] hover:text-[#ededea]"
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

// ── KPI Scorecards with Interactive Metric Selectors (Vercel Style) ─────────

interface InteractiveKpiCardsProps {
  summary: AnalyticsSummary;
  activeMetric: MetricType;
  onSelectMetric: (m: MetricType) => void;
}

export function InteractiveKpiCards({
  summary,
  activeMetric,
  onSelectMetric,
}: InteractiveKpiCardsProps) {
  const errorTone =
    summary.errorRatePercent >= 5
      ? "danger"
      : summary.errorRatePercent > 0
        ? "warning"
        : "success";

  const cards: Array<{
    id: MetricType;
    label: string;
    value: string;
    sub: string;
    delta?: number;
    tone?: "accent" | "success" | "warning" | "danger" | "neutral";
    hint: string;
  }> = [
    {
      id: "views",
      label: "TOTAL PAGEVIEWS",
      value: summary.totalViews.toLocaleString('en-US'),
      sub: "Edge requests",
      delta: summary.previousPeriodDelta.viewsDeltaPercent,
      tone: "accent",
      hint: "Raw requests served by Nginx edge",
    },
    {
      id: "visitors",
      label: "UNIQUE VISITORS",
      value: summary.totalUniqueVisitors.toLocaleString('en-US'),
      sub: "Daily salted hash",
      delta: summary.previousPeriodDelta.visitorsDeltaPercent,
      tone: "success",
      hint: "HMAC-SHA256 daily unique IPs",
    },
    {
      id: "latency",
      label: "AVG LATENCY",
      value: `${summary.avgLatencyMs} ms`,
      sub: `P95: ${summary.p95LatencyMs} ms`,
      tone: "neutral",
      hint: "Upstream response execution time",
    },
    {
      id: "errors",
      label: "ERROR RATE",
      value: `${summary.errorRatePercent}%`,
      sub: `4xx: ${summary.status4xx} · 5xx: ${summary.status5xx}`,
      tone: errorTone,
      hint: "Ratio of 4xx client and 5xx server errors",
    },
    {
      id: "bytes",
      label: "DATA TRANSFERRED",
      value: formatBytes(summary.totalBytes),
      sub: "Egress payload",
      tone: "neutral",
      hint: "Total outbound HTTP payload volume",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => {
        const isActive = activeMetric === card.id;
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelectMetric(card.id)}
            className={`group relative flex flex-col justify-between border p-4 text-left transition-all duration-150 ${
              isActive
                ? "border-[#ccff00] bg-[#1a1e12] shadow-[0_0_12px_rgba(204,255,0,0.08)]"
                : "border-[#2a2a2a] bg-[#141414] hover:border-[#444] hover:bg-[#181818]"
            }`}
          >
            {/* Active highlight top bar */}
            {isActive && (
              <div className="absolute inset-x-0 -top-[1px] h-[2px] bg-[#ccff00]" />
            )}

            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a] group-hover:text-[#c4c4c4]">
                  {card.label}
                </span>
                {isActive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#ccff00] shadow-[0_0_6px_#ccff00]" />
                )}
              </div>

              <div className="mt-2 flex items-baseline justify-between">
                <span
                  className={`text-2xl font-bold tabular-nums tracking-tight ${
                    isActive ? "text-[#ededea]" : "text-[#ededea]"
                  }`}
                >
                  {card.value}
                </span>
                {card.delta !== undefined && <DeltaBadge delta={card.delta} />}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[#2a2a2a]/60 pt-2 font-mono text-[10px] text-[#8a8a8a]">
              <span className="truncate">{card.sub}</span>
              <span
                className={`text-[9px] uppercase tracking-wider ${
                  isActive ? "text-[#ccff00]" : "text-[#555] group-hover:text-[#888]"
                }`}
              >
                {isActive ? "ACTIVE" : "VIEW"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Smooth horizontal-tangent cubic bezier through a series of {x,y} pairs. */
function smoothPathFromPoints(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;

  let d = `M ${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const dx = p2.x - p1.x;
    const cp1x = p1.x + dx * 0.45;
    const cp2x = p2.x - dx * 0.45;
    d += ` C ${cp1x.toFixed(1)},${p1.y.toFixed(1)} ${cp2x.toFixed(1)},${p2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// ── Interactive Timeseries Chart (Tremor & Vercel Style with Tooltip) ───────

interface InteractiveChartProps {
  points: TimeseriesPoint[];
  previousPoints?: TimeseriesPoint[];
  activeMetric: MetricType;
  onSelectMetric: (m: MetricType) => void;
  range: TimeRange;
}

export function InteractiveTimeseriesChart({
  points,
  previousPoints,
  activeMetric,
  onSelectMetric,
  range: rangeForExport,
}: InteractiveChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartMode, setChartMode] = useState<"spline" | "bars">("spline");
  const [showComparison, setShowComparison] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // The data layer aligns previousPoints to points by index (both are
  // dense-filled to the same length — lib/data/analytics.ts's
  // readPreviousPeriodTimeseries), so a length mismatch means stale props
  // mid-navigation, not a real comparison. Comparing timestamps would be
  // wrong on purpose: the whole point is overlaying two different calendar
  // windows onto one "hours into the period" axis.
  const canCompare = !!previousPoints && previousPoints.length === points.length && points.length > 0;

  const metricConfig: Record<
    MetricType,
    {
      label: string;
      unit: string;
      getValue: (p: TimeseriesPoint) => number;
      format: (v: number) => string;
      color: string;
      areaGradient: string;
    }
  > = {
    views: {
      label: "Pageviews",
      unit: "views",
      getValue: (p) => p.views,
      format: (v) => v.toLocaleString('en-US'),
      color: "#ccff00",
      areaGradient: "viewsGrad",
    },
    visitors: {
      label: "Unique Visitors",
      unit: "uv",
      getValue: (p) => p.visitors,
      format: (v) => v.toLocaleString('en-US'),
      color: "#8fbf6a",
      areaGradient: "visitorsGrad",
    },
    latency: {
      label: "Avg Latency",
      unit: "ms",
      getValue: (p) => p.latencyMs,
      format: (v) => `${v.toFixed(1)} ms`,
      color: "#d9c96a",
      areaGradient: "latencyGrad",
    },
    errors: {
      label: "HTTP Errors",
      unit: "errors",
      getValue: (p) => p.errors,
      format: (v) => v.toLocaleString('en-US'),
      color: "#e0897a",
      areaGradient: "errorsGrad",
    },
    bytes: {
      label: "Bandwidth",
      unit: "bytes",
      getValue: (p) => p.bytes,
      format: (v) => formatBytes(v),
      color: "#6ab0ff",
      areaGradient: "bytesGrad",
    },
  };

  const currentCfg = metricConfig[activeMetric];

  // SVG Dimension Constants
  const width = 1000;
  const height = 240;
  const padX = 50;
  const padY = 30;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  // Compute values
  const values = useMemo(
    () => points.map((p) => currentCfg.getValue(p)),
    [points, currentCfg],
  );

  const previousValues = useMemo(
    () => (canCompare ? previousPoints!.map((p) => currentCfg.getValue(p)) : []),
    [canCompare, previousPoints, currentCfg],
  );

  // The overlay must fit inside the same axis as the primary series, or a
  // previous period with a higher peak would clip off the top silently.
  const rawMax = Math.max(...values, ...(showComparison ? previousValues : []), 0);
  const maxValue = rawMax === 0 ? 10 : rawMax * 1.15; // 15% headroom

  const getX = useCallback(
    (i: number) => {
      if (points.length <= 1) return padX + chartW / 2;
      return padX + (i / (points.length - 1)) * chartW;
    },
    [points.length, chartW, padX],
  );

  const getY = useCallback(
    (val: number) => height - padY - (val / maxValue) * chartH,
    [maxValue, height, padY, chartH],
  );

  // Generate cubic bezier smooth curve path (Vercel / Plausible aesthetic)
  const { linePath, areaPath } = useMemo(() => {
    if (points.length === 0) return { linePath: "", areaPath: "" };
    if (points.length === 1) {
      const x = getX(0);
      const y = getY(values[0] || 0);
      return {
        linePath: `M ${x - 20},${y} L ${x + 20},${y}`,
        areaPath: `M ${x - 20},${height - padY} L ${x - 20},${y} L ${x + 20},${y} L ${x + 20},${height - padY} Z`,
      };
    }

    const pts = points.map((_, i) => ({ x: getX(i), y: getY(values[i] || 0) }));
    const d = smoothPathFromPoints(pts);
    const area = `${d} L ${pts[pts.length - 1]!.x.toFixed(1)},${height - padY} L ${pts[0]!.x.toFixed(1)},${height - padY} Z`;
    return { linePath: d, areaPath: area };
  }, [points, values, getX, getY, height, padY]);

  // Previous-period overlay: same X positions as the current series (index
  // aligned, not by timestamp — the two windows are different calendar
  // days), current series' Y scale (computed above via maxValue).
  const previousLinePath = useMemo(() => {
    if (!showComparison || !canCompare) return "";
    const pts = previousValues.map((v, i) => ({ x: getX(i), y: getY(v || 0) }));
    return smoothPathFromPoints(pts);
  }, [showComparison, canCompare, previousValues, getX, getY]);

  // Handle Mouse movement for scrubber
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const svgRect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - svgRect.left;
    const relX = (clientX / svgRect.width) * width;

    // Find nearest point
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(getX(i) - relX);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    setHoverIndex(closestIdx);
  };

  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="border border-[#2a2a2a] bg-[#141414] p-5">
      {/* Chart Control Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#2a2a2a]/60 pb-3">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="flex items-center gap-1.5 font-bold tracking-wider text-[#ededea]">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: currentCfg.color }}
            />
            {currentCfg.label.toUpperCase()}
          </span>
          <span className="text-[#555]">·</span>
          <span className="text-[#8a8a8a]">{points.length} edge buckets</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Metric switcher chips */}
          <div className="hidden items-center gap-1 rounded-none border border-[#2a2a2a] bg-[#0d0d0d] p-0.5 md:flex font-mono text-[10px]">
            {(["views", "visitors", "latency", "errors", "bytes"] as MetricType[]).map(
              (m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onSelectMetric(m)}
                  className={`px-2 py-1 transition-colors ${
                    activeMetric === m
                      ? "bg-[#222] font-bold text-[#ccff00]"
                      : "text-[#777] hover:text-[#bbb]"
                  }`}
                >
                  {m.toUpperCase()}
                </button>
              ),
            )}
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center border border-[#2a2a2a] bg-[#0d0d0d] p-0.5 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => setChartMode("spline")}
              className={`px-2 py-1 ${
                chartMode === "spline" ? "bg-[#222] text-[#ccff00]" : "text-[#777]"
              }`}
              title="Smooth Spline Area"
            >
              AREA
            </button>
            <button
              type="button"
              onClick={() => setChartMode("bars")}
              className={`px-2 py-1 ${
                chartMode === "bars" ? "bg-[#222] text-[#ccff00]" : "text-[#777]"
              }`}
              title="Column Bars"
            >
              BARS
            </button>
          </div>

          {/* Previous-period overlay toggle */}
          <button
            type="button"
            disabled={!canCompare}
            onClick={() => setShowComparison((v) => !v)}
            className={`flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] transition-colors ${
              !canCompare
                ? "cursor-not-allowed border-[#2a2a2a] text-[#444]"
                : showComparison
                  ? "border-[#ccff00]/40 bg-[#1c220a] text-[#ccff00]"
                  : "border-[#2a2a2a] bg-[#0d0d0d] text-[#777] hover:text-[#bbb]"
            }`}
            title={canCompare ? "Overlay the previous period" : "Not enough data for a previous-period comparison"}
          >
            <span className="h-1.5 w-3 border-b border-dashed border-current" />
            COMPARE
          </button>

          <ExportLink dataset="timeseries" range={rangeForExport} />
        </div>
      </div>

      {/* Main SVG Visualization */}
      <div ref={containerRef} className="relative w-full overflow-hidden select-none">
        {points.length === 0 ? (
          <div className="flex h-56 items-center justify-center font-mono text-xs text-[#555]">
            No timeseries telemetry logged for this period yet.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-56 w-full overflow-visible"
            preserveAspectRatio="none"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ccff00" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#ccff00" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="visitorsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8fbf6a" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#8fbf6a" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d9c96a" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#d9c96a" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="errorsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e0897a" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#e0897a" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="bytesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6ab0ff" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#6ab0ff" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines & Y labels */}
            {[0, 0.33, 0.66, 1].map((ratio, idx) => {
              const y = height - padY - ratio * chartH;
              const labelVal = Math.round(ratio * maxValue);
              return (
                <g key={idx}>
                  <line
                    x1={padX}
                    y1={y}
                    x2={width - padX}
                    y2={y}
                    stroke="#222"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padX - 8}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-[#4a4a4a] font-mono text-[9px]"
                  >
                    {activeMetric === "bytes" ? formatBytes(labelVal) : labelVal}
                  </text>
                </g>
              );
            })}

            {/* Render Bars mode */}
            {chartMode === "bars" &&
              points.map((p, i) => {
                const val = currentCfg.getValue(p);
                const barH = Math.max(2, (val / maxValue) * chartH);
                const barW = Math.max(3, (chartW / points.length) * 0.65);
                const x = getX(i) - barW / 2;
                const y = height - padY - barH;
                const isHovered = hoverIndex === i;

                return (
                  <rect
                    key={i}
                    x={x}
                    y={y}
                    width={barW}
                    height={barH}
                    fill={currentCfg.color}
                    opacity={isHovered ? 1 : 0.75}
                    className="transition-all duration-150"
                  />
                );
              })}

            {/* Render Spline Area mode */}
            {chartMode === "spline" && (
              <>
                <path d={areaPath} fill={`url(#${currentCfg.areaGradient})`} />
                <path
                  d={linePath}
                  fill="none"
                  stroke={currentCfg.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {points.map((p, i) => {
                  const val = currentCfg.getValue(p);
                  const isHovered = hoverIndex === i;
                  return (
                    <circle
                      key={i}
                      cx={getX(i)}
                      cy={getY(val)}
                      r={isHovered ? 5 : 2.5}
                      fill="#0a0a0a"
                      stroke={currentCfg.color}
                      strokeWidth={isHovered ? 2.5 : 1.5}
                      className="transition-all duration-150"
                    />
                  );
                })}
              </>
            )}

            {/* Previous-period overlay — dashed, muted, no area fill so it
                never competes visually with the current period's own area. */}
            {showComparison && canCompare && (
              <path
                d={previousLinePath}
                fill="none"
                stroke="#8a8a8a"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.8}
              />
            )}

            {/* Scrubber vertical line */}
            {hoverIndex !== null && (
              <line
                x1={getX(hoverIndex)}
                y1={padY}
                x2={getX(hoverIndex)}
                y2={height - padY}
                stroke="#fff"
                strokeOpacity="0.3"
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
            )}
          </svg>
        )}

        {/* Floating Tooltip Box */}
        {hoveredPoint && hoverIndex !== null && (
          <div
            className="pointer-events-none absolute top-3 z-30 min-w-[200px] border border-[#333] bg-[#141414]/95 p-3.5 shadow-2xl backdrop-blur-md transition-transform duration-75"
            style={{
              left: `${Math.min(
                Math.max(10, (getX(hoverIndex) / width) * 100),
                75,
              )}%`,
            }}
          >
            <div className="border-b border-[#2a2a2a] pb-1.5 font-mono text-[11px] font-bold text-[#ededea]">
              {formatTimestamp(hoveredPoint.timestamp).full}
            </div>

            <div className="mt-2 space-y-1.5 font-mono text-xs">
              <div className="flex items-center justify-between text-[#ededea]">
                <span className="text-[#8a8a8a]">{currentCfg.label}:</span>
                <span className="font-bold text-[#ccff00]">
                  {currentCfg.format(currentCfg.getValue(hoveredPoint))}
                </span>
              </div>

              {showComparison && canCompare && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 text-[#8a8a8a]">
                    <span className="h-1 w-2.5 border-b border-dashed border-[#8a8a8a]" />
                    Previous period, same hour:
                  </span>
                  <span className="tabular-nums text-[#c4c4c4]">
                    {currentCfg.format(previousValues[hoverIndex] ?? 0)}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] text-[#8a8a8a]">
                <span>Pageviews:</span>
                <span className="tabular-nums text-[#ededea]">
                  {hoveredPoint.views.toLocaleString('en-US')}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#8a8a8a]">
                <span>Unique Visitors:</span>
                <span className="tabular-nums text-[#ededea]">
                  {hoveredPoint.visitors.toLocaleString('en-US')}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#8a8a8a]">
                <span>Avg Latency:</span>
                <span className="tabular-nums text-[#ededea]">
                  {hoveredPoint.latencyMs.toFixed(1)} ms
                </span>
              </div>

              {hoveredPoint.errors > 0 && (
                <div className="flex items-center justify-between text-[11px] text-[#e0897a]">
                  <span>HTTP Errors:</span>
                  <span className="font-bold tabular-nums">
                    {hoveredPoint.errors}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* X-Axis Timestamps */}
      {points.length > 0 && (
        <div className="mt-2 flex justify-between border-t border-[#2a2a2a]/40 pt-2 font-mono text-[10px] text-[#555]">
          <span>{formatTimestamp(points[0]!.timestamp).time}</span>
          {points.length > 2 && (
            <span>
              {formatTimestamp(points[Math.floor(points.length / 2)]!.timestamp).time}
            </span>
          )}
          <span>{formatTimestamp(points[points.length - 1]!.timestamp).time}</span>
        </div>
      )}
    </div>
  );
}

// ── Cloudflare HTTP Status Code Distribution Bar ────────────────────────────

interface HttpStatusDistributionProps {
  summary: AnalyticsSummary;
}

export function HttpStatusDistribution({ summary }: HttpStatusDistributionProps) {
  const total = summary.totalViews || 1;
  const p2xx = Math.round((summary.status2xx / total) * 1000) / 10;
  const p3xx = Math.round((summary.status3xx / total) * 1000) / 10;
  const p4xx = Math.round((summary.status4xx / total) * 1000) / 10;
  const p5xx = Math.round((summary.status5xx / total) * 1000) / 10;

  return (
    <div className="border border-[#2a2a2a] bg-[#141414] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
          HTTP STATUS CODE DISTRIBUTION
        </h3>
        <span className="font-mono text-[10px] text-[#555]">
          EDGE RESPONSE CODES
        </span>
      </div>

      {/* Segmented Progress Bar */}
      <div className="flex h-3 w-full overflow-hidden bg-[#0d0d0d]">
        {summary.status2xx > 0 && (
          <div
            style={{ width: `${p2xx}%` }}
            className="h-full bg-[#8fbf6a] transition-all duration-300"
            title={`2xx Success: ${summary.status2xx} (${p2xx}%)`}
          />
        )}
        {summary.status3xx > 0 && (
          <div
            style={{ width: `${p3xx}%` }}
            className="h-full bg-[#8a8a8a] transition-all duration-300"
            title={`3xx Redirect: ${summary.status3xx} (${p3xx}%)`}
          />
        )}
        {summary.status4xx > 0 && (
          <div
            style={{ width: `${p4xx}%` }}
            className="h-full bg-[#d9c96a] transition-all duration-300"
            title={`4xx Client Error: ${summary.status4xx} (${p4xx}%)`}
          />
        )}
        {summary.status5xx > 0 && (
          <div
            style={{ width: `${p5xx}%` }}
            className="h-full bg-[#e0897a] transition-all duration-300"
            title={`5xx Server Error: ${summary.status5xx} (${p5xx}%)`}
          />
        )}
      </div>

      {/* Legend Grid */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs">
        <div className="flex items-center gap-2 border border-[#2a2a2a]/60 bg-[#0d0d0d] p-2.5">
          <span className="h-2 w-2 rounded-full bg-[#8fbf6a]" />
          <div className="truncate">
            <div className="text-[10px] text-[#8a8a8a]">2XX SUCCESS</div>
            <div className="font-bold tabular-nums text-[#ededea]">
              {summary.status2xx.toLocaleString('en-US')}{" "}
              <span className="text-[10px] font-normal text-[#555]">({p2xx}%)</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border border-[#2a2a2a]/60 bg-[#0d0d0d] p-2.5">
          <span className="h-2 w-2 rounded-full bg-[#8a8a8a]" />
          <div className="truncate">
            <div className="text-[10px] text-[#8a8a8a]">3XX REDIRECT</div>
            <div className="font-bold tabular-nums text-[#ededea]">
              {summary.status3xx.toLocaleString('en-US')}{" "}
              <span className="text-[10px] font-normal text-[#555]">({p3xx}%)</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border border-[#2a2a2a]/60 bg-[#0d0d0d] p-2.5">
          <span className="h-2 w-2 rounded-full bg-[#d9c96a]" />
          <div className="truncate">
            <div className="text-[10px] text-[#8a8a8a]">4XX CLIENT ERR</div>
            <div className="font-bold tabular-nums text-[#d9c96a]">
              {summary.status4xx.toLocaleString('en-US')}{" "}
              <span className="text-[10px] font-normal text-[#555]">({p4xx}%)</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border border-[#2a2a2a]/60 bg-[#0d0d0d] p-2.5">
          <span className="h-2 w-2 rounded-full bg-[#e0897a]" />
          <div className="truncate">
            <div className="text-[10px] text-[#8a8a8a]">5XX SERVER ERR</div>
            <div className="font-bold tabular-nums text-[#e0897a]">
              {summary.status5xx.toLocaleString('en-US')}{" "}
              <span className="text-[10px] font-normal text-[#555]">({p5xx}%)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Plausible / Dub.co Embedded Bar List ─────────────────────────────────────

interface EmbeddedBarListProps {
  items: TopRankedItem[];
  emptyMessage: string;
  showUnique?: boolean;
  isCountry?: boolean;
  isPath?: boolean;
}

export function EmbeddedBarList({
  items,
  emptyMessage,
  showUnique = false,
  isCountry = false,
  isPath = false,
}: EmbeddedBarListProps) {
  const [search, setSearch] = useState("");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item) => {
      if (isCountry) {
        const info = getCountryInfo(item.code || item.name);
        return (
          info.name.toLowerCase().includes(q) ||
          info.code.toLowerCase().includes(q)
        );
      }
      return item.name.toLowerCase().includes(q);
    });
  }, [items, search, isCountry]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPath(text);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  return (
    <div>
      {/* Quick Search */}
      {items.length > 5 && (
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-1.5 font-mono text-[11px] text-[#ededea] placeholder-[#555] focus:border-[#ccff00] focus:outline-none"
          />
        </div>
      )}

      {filteredItems.length === 0 ? (
        <p className="py-6 text-center font-mono text-xs text-[#555]">{emptyMessage}</p>
      ) : (
        <div className="space-y-1.5">
          {filteredItems.map((item, idx) => {
            const countryInfo = isCountry
              ? getCountryInfo(item.code || item.name)
              : null;

            return (
              <div
                key={idx}
                className="group relative overflow-hidden border border-[#222] bg-[#101010] transition-colors hover:border-[#3d3d3d]"
              >
                {/* Embedded background progress fill (Plausible style) */}
                <div
                  className="absolute inset-y-0 left-0 bg-[#ccff00]/[0.08] transition-all duration-300 ease-out group-hover:bg-[#ccff00]/[0.15]"
                  style={{ width: `${Math.max(item.percentage, 1)}%` }}
                />

                <div className="relative z-10 flex items-center justify-between px-3 py-2 text-xs">
                  {/* Left Label */}
                  <div className="flex min-w-0 items-center gap-2 pr-2">
                    <span className="font-mono text-[10px] text-[#555]">
                      #{idx + 1}
                    </span>

                    {isCountry && countryInfo && (
                      <span className="text-sm select-none" title={countryInfo.name}>
                        {countryInfo.flag}
                      </span>
                    )}

                    <span
                      className="truncate font-mono text-[#ededea]"
                      title={isCountry && countryInfo ? countryInfo.name : item.name}
                    >
                      {isCountry && countryInfo ? countryInfo.name : item.name}
                    </span>

                    {isPath && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(item.name)}
                        className="opacity-0 transition-opacity group-hover:opacity-100 font-mono text-[9px] text-[#8a8a8a] hover:text-[#ccff00]"
                        title="Copy route path"
                      >
                        {copiedPath === item.name ? "[COPIED]" : "[COPY]"}
                      </button>
                    )}
                  </div>

                  {/* Right Metrics */}
                  <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums text-[#8a8a8a]">
                    <span className="font-bold text-[#ededea]">
                      {item.count.toLocaleString('en-US')}
                    </span>
                    {showUnique && item.uniqueCount !== undefined && (
                      <span className="text-[#666]">
                        {item.uniqueCount.toLocaleString('en-US')} uv
                      </span>
                    )}
                    {/* A path with no measured request is not a fast path.
                        `latencySamples === 0` renders the placeholder the rest
                        of this app uses for "the box did not answer", never a
                        0ms that reads like a measurement (§8 #3). */}
                    {item.avgLatencyMs !== undefined && (
                      <span
                        className="w-24 text-right text-[#666]"
                        title={
                          item.latencySamples
                            ? `${item.latencySamples.toLocaleString("en-US")} requests measured, bots included`
                            : "no request timed for this path yet"
                        }
                      >
                        {item.latencySamples
                          ? `${Math.round(item.avgLatencyMs)} / ${Math.round(item.p95LatencyMs ?? 0)} ms`
                          : "—"}
                      </span>
                    )}
                    <span className="w-12 text-right text-[#888]">
                      {item.percentage}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Client Platform Tabs (Devices / Browsers / OS) ──────────────────────────

// ── Bot Trend Sparkline ──────────────────────────────────────────────────────

const BOT_TREND_PALETTE = ["#ccff00", "#8fbf6a", "#d9c96a", "#e0897a", "#6ab0ff", "#c58fe0"];

function BotTrendChart({ trend }: { trend: BotTrend }) {
  const width = 600;
  const height = 90;
  const padX = 8;
  const padY = 10;

  if (trend.dates.length < 2 || trend.series.length === 0) {
    return (
      <p className="py-4 text-center font-mono text-[10px] text-[#555]">
        Not enough days in this range for a trend line yet.
      </p>
    );
  }

  const maxHits = Math.max(1, ...trend.series.flatMap((s) => s.hits));
  const getX = (i: number) =>
    padX + (i / (trend.dates.length - 1)) * (width - padX * 2);
  const getY = (v: number) => height - padY - (v / maxHits) * (height - padY * 2);

  return (
    <div className="border border-[#222] bg-[#101010] p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full overflow-visible" preserveAspectRatio="none">
        {trend.series.map((s, si) => {
          const pts = s.hits.map((v, i) => ({ x: getX(i), y: getY(v) }));
          const color = BOT_TREND_PALETTE[si % BOT_TREND_PALETTE.length]!;
          return (
            <polyline
              key={s.name}
              points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
            />
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#2a2a2a]/60 pt-2 font-mono text-[9px] text-[#8a8a8a]">
        {trend.series.map((s, si) => (
          <span key={s.name} className="flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: BOT_TREND_PALETTE[si % BOT_TREND_PALETTE.length] }}
            />
            {s.name}
          </span>
        ))}
        <span className="ml-auto text-[#555]">
          {trend.dates[0]} → {trend.dates[trend.dates.length - 1]} · daily hits
        </span>
      </div>
    </div>
  );
}

interface ClientPlatformsPanelProps {
  breakdown: DeviceBreakdown;
  botTrend: BotTrend;
  range: TimeRange;
}

export function ClientPlatformsPanel({ breakdown, botTrend, range }: ClientPlatformsPanelProps) {
  const [tab, setTab] = useState<"devices" | "browsers" | "os" | "bots">("devices");

  const items: TopRankedItem[] =
    tab === "devices"
      ? breakdown.devices
      : tab === "browsers"
        ? breakdown.browsers
        : tab === "os"
          ? breakdown.os
          : breakdown.bots;

  return (
    <div>
      {/* Tab Switcher & Bot/Human Ratio */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2a2a] pb-2">
        <div className="flex flex-wrap gap-1 font-mono text-[10px] tracking-[0.14em]">
          <button
            type="button"
            onClick={() => setTab("devices")}
            className={`px-2.5 py-1 transition-colors ${
              tab === "devices"
                ? "bg-[#1c1c1c] font-bold text-[#ccff00] border-b-2 border-[#ccff00]"
                : "text-[#8a8a8a] hover:text-[#ededea]"
            }`}
          >
            DEVICES
          </button>
          <button
            type="button"
            onClick={() => setTab("browsers")}
            className={`px-2.5 py-1 transition-colors ${
              tab === "browsers"
                ? "bg-[#1c1c1c] font-bold text-[#ccff00] border-b-2 border-[#ccff00]"
                : "text-[#8a8a8a] hover:text-[#ededea]"
            }`}
          >
            BROWSERS
          </button>
          <button
            type="button"
            onClick={() => setTab("os")}
            className={`px-2.5 py-1 transition-colors ${
              tab === "os"
                ? "bg-[#1c1c1c] font-bold text-[#ccff00] border-b-2 border-[#ccff00]"
                : "text-[#8a8a8a] hover:text-[#ededea]"
            }`}
          >
            OS
          </button>
          <button
            type="button"
            onClick={() => setTab("bots")}
            className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
              tab === "bots"
                ? "bg-[#1c1c1c] font-bold text-[#ccff00] border-b-2 border-[#ccff00]"
                : "text-[#8a8a8a] hover:text-[#ededea]"
            }`}
          >
            <span>BOTS &amp; CRAWLERS</span>
            {breakdown.bots.length > 0 && (
              <span className="rounded-none bg-[#2a2a2a] px-1 text-[9px] text-[#ccff00]">
                {breakdown.bots.length}
              </span>
            )}
          </button>
        </div>

        {/* Traffic Ratio Pill */}
        <div className="flex items-center gap-3 font-mono text-[9px] text-[#8a8a8a]">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#8fbf6a]" />
            HUMAN: <span className="text-[#ededea] font-bold">{breakdown.humanPercentage}%</span>
          </span>
          <span className="text-[#444]">·</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#d9c96a]" />
            BOT: <span className="text-[#d9c96a] font-bold">{breakdown.botPercentage}%</span>
          </span>
          <span className="text-[#444]">·</span>
          <ExportLink dataset={tab} range={range} />
        </div>
      </div>

      {tab === "bots" && (
        <div className="mb-3">
          <BotTrendChart trend={botTrend} />
        </div>
      )}

      <EmbeddedBarList
        items={items}
        emptyMessage={
          tab === "bots"
            ? "No automated bot or crawler activity detected in this period."
            : "No client platform telemetry logged yet."
        }
      />
    </div>
  );
}

// ── Comprehensive Analytics Interactive Client Assembly ─────────────────────

// ── Country Full Table (sortable "view all") ────────────────────────────────

type CountrySortKey = "name" | "count" | "uniqueCount" | "percentage";

function CountryFullTable({ items }: { items: TopRankedItem[] }) {
  const [sortKey, setSortKey] = useState<CountrySortKey>("count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter((it) => {
          const info = getCountryInfo(it.code || it.name);
          return info.name.toLowerCase().includes(q) || info.code.toLowerCase().includes(q);
        })
      : items;

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "name") {
        const an = getCountryInfo(a.code || a.name).name;
        const bn = getCountryInfo(b.code || b.name).name;
        return an.localeCompare(bn) * dir;
      }
      return ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * dir;
    });
  }, [items, search, sortKey, sortDir]);

  function toggleSort(key: CountrySortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortHeader({ label, k }: { label: string; k: CountrySortKey }) {
    const active = sortKey === k;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`flex items-center gap-1 font-mono text-[10px] tracking-[0.12em] transition-colors ${
          active ? "text-[#ccff00]" : "text-[#8a8a8a] hover:text-[#ededea]"
        }`}
      >
        {label}
        {active && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <input
          type="text"
          placeholder="Search country or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-1.5 font-mono text-[11px] text-[#ededea] placeholder-[#555] focus:border-[#ccff00] focus:outline-none"
        />
      </div>

      <div className="overflow-x-auto border border-[#222]">
        <table className="w-full min-w-[480px] border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-[#2a2a2a] bg-[#0d0d0d]">
              <th className="px-3 py-2 text-left"><SortHeader label="COUNTRY" k="name" /></th>
              <th className="px-3 py-2 text-right"><SortHeader label="VIEWS" k="count" /></th>
              <th className="px-3 py-2 text-right"><SortHeader label="UNIQUE" k="uniqueCount" /></th>
              <th className="px-3 py-2 text-right"><SortHeader label="SHARE" k="percentage" /></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-[#555]">
                  No countries match "{search}".
                </td>
              </tr>
            ) : (
              sorted.map((item, i) => {
                const info = getCountryInfo(item.code || item.name);
                return (
                  <tr
                    key={item.code || item.name}
                    className={`border-b border-[#1c1c1c] transition-colors hover:bg-[#161616] ${
                      i % 2 === 1 ? "bg-[#0d0d0d]/40" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5 text-[#ededea]">
                      <span className="mr-1.5">{info.flag}</span>
                      {info.name}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#ededea]">
                      {item.count.toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#8a8a8a]">
                      {(item.uniqueCount ?? 0).toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#888]">
                      {item.percentage}%
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-[10px] text-[#555]">
        {sorted.length} of {items.length} countries shown.
      </p>
    </div>
  );
}

interface AnalyticsDashboardClientProps {
  summary: AnalyticsSummary;
  timeseries: TimeseriesPoint[];
  previousTimeseries: TimeseriesPoint[];
  pages: TopRankedItem[];
  referrers: TopRankedItem[];
  countries: TopRankedItem[];
  countriesView: "top" | "all";
  devices: DeviceBreakdown;
  botTrend: BotTrend;
  ingestHealth: IngestHealth;
  range: TimeRange;
}

/** Header freshness readout — ticks every second so "Xs ago" stays accurate, and pulls a fresh page render on an interval so the dashboard never needs a manual reload. */
function IngestFreshness({ ingestHealth }: { ingestHealth: IngestHealth }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const clockId = setInterval(() => setNow(Date.now()), 1000);
    const refreshId = setInterval(() => router.refresh(), 30_000);
    return () => {
      clearInterval(clockId);
      clearInterval(refreshId);
    };
  }, [router]);

  const ageSec =
    now !== null && ingestHealth.lastIngestedAt
      ? (now - new Date(ingestHealth.lastIngestedAt).getTime()) / 1000
      : null;
  // Cron runs every 1 minute (PRD Q3) — anything past 3 missed runs reads as stalled.
  const isStale = ageSec === null || ageSec > 180;
  const dotClass = !ingestHealth.available
    ? "bg-[#555]"
    : isStale
      ? "bg-[#e0897a]"
      : "bg-[#ccff00] animate-pulse";

  return (
    <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a]">
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span>
        {!ingestHealth.available
          ? "INGEST UNAVAILABLE"
          : isStale
            ? "INGEST STALLED"
            : "LIVE"}
      </span>
      <span className="text-[#444]">·</span>
      <span className="normal-case tracking-normal text-[#666]">
        last ingested {now === null ? "…" : formatRelativeTime(ingestHealth.lastIngestedAt, now)}
        {" · auto-refreshes every 30s"}
      </span>
    </div>
  );
}

export function AnalyticsDashboardClient({
  summary,
  timeseries,
  previousTimeseries,
  pages,
  referrers,
  countries,
  countriesView,
  devices,
  botTrend,
  ingestHealth,
  range,
}: AnalyticsDashboardClientProps) {
  const [activeMetric, setActiveMetric] = useState<MetricType>("views");
  const router = useRouter();
  const searchParams = useSearchParams();

  function toggleCountriesView() {
    const params = new URLSearchParams(searchParams.toString());
    if (countriesView === "all") params.delete("countriesView");
    else params.set("countriesView", "all");
    router.push(`/admin/analytics?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-8">
      {/* Top Header Controls */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <IngestFreshness ingestHealth={ingestHealth} />
          <p className="mt-1 font-mono text-xs text-[#8a8a8a]">
            Aggregated request volume, latency profiles, and regional distribution.
          </p>
        </div>
        <TimeRangePicker currentRange={range} />
      </div>

      {/* KPI Cards acting as Metric Selectors */}
      <InteractiveKpiCards
        summary={summary}
        activeMetric={activeMetric}
        onSelectMetric={setActiveMetric}
      />

      {/* Interactive Main Chart */}
      <InteractiveTimeseriesChart
        points={timeseries}
        previousPoints={previousTimeseries}
        activeMetric={activeMetric}
        onSelectMetric={setActiveMetric}
        range={range}
      />

      {/* HTTP Status Code Distribution */}
      <HttpStatusDistribution summary={summary} />

      {/* Bento Grid: 4 Breakdown Lists with Embedded Progress Bars */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Pages */}
        <div className="border border-[#2a2a2a] bg-[#141414] p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
              TOP PAGES &amp; ENDPOINTS
            </h2>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-[#555]">
                BY PAGEVIEWS · AVG/P95
              </span>
              <ExportLink dataset="pages" range={range} />
            </div>
          </div>
          <EmbeddedBarList
            items={pages}
            emptyMessage="No page activity logged yet."
            showUnique
            isPath
          />
        </div>

        {/* Geographic Distribution */}
        {countriesView !== "all" && (
          <div className="border border-[#2a2a2a] bg-[#141414] p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
                GEOGRAPHIC DISTRIBUTION
              </h2>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-[#555]">BY COUNTRY</span>
                <button
                  type="button"
                  onClick={toggleCountriesView}
                  className="font-mono text-[10px] text-[#666] transition-colors hover:text-[#ccff00]"
                >
                  VIEW ALL →
                </button>
                <ExportLink dataset="countries" range={range} />
              </div>
            </div>
            <EmbeddedBarList
              items={countries}
              emptyMessage="No country headers observed yet."
              showUnique
              isCountry
            />
          </div>
        )}

        {/* Traffic Sources */}
        <div className="border border-[#2a2a2a] bg-[#141414] p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
              TRAFFIC SOURCES &amp; REFERRERS
            </h2>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-[#555]">BY DOMAIN</span>
              <ExportLink dataset="referrers" range={range} />
            </div>
          </div>
          <EmbeddedBarList
            items={referrers}
            emptyMessage="No external referrers observed yet."
          />
        </div>

        {/* Client Platforms */}
        <div className="border border-[#2a2a2a] bg-[#141414] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
              CLIENT PLATFORMS &amp; AGENTS
            </h2>
            <span className="font-mono text-[10px] text-[#555]">BY ENVIRONMENT</span>
          </div>
          <ClientPlatformsPanel breakdown={devices} botTrend={botTrend} range={range} />
        </div>
      </div>

      {/* Geographic Distribution — full sortable table, replaces the bento tile above when active */}
      {countriesView === "all" && (
        <div className="border border-[#2a2a2a] bg-[#141414] p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
              GEOGRAPHIC DISTRIBUTION — ALL COUNTRIES
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleCountriesView}
                className="font-mono text-[10px] text-[#666] transition-colors hover:text-[#ccff00]"
              >
                ← COLLAPSE
              </button>
              <ExportLink dataset="countries" range={range} />
            </div>
          </div>
          <CountryFullTable items={countries} />
        </div>
      )}
    </div>
  );
}
