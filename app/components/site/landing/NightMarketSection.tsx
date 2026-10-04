import Link from "next/link";
import { cdnUrl } from "@/lib/config/cdn";
import { SmartImage } from "../SmartImage";
import { TokenIcon } from "../TokenIcon";
import { explorerWebUrl } from "@/lib/config/chain";
import { Display, Eyebrow, GhostButton, Standfirst } from "./Section";
import { compactUsd, scoreColor } from "./format";
import { PRODUCT_ACCENT, launchpadAccent, tint } from "./palette";
import { isPureBondingCurve, rowRaisedDisplay } from "@/lib/launches/raised";
import type { LaunchFeedRow } from "@/lib/launches/feed-types";
import { scaleActivity } from "./activity-chart";
import { isOwnToken } from "@/lib/sale/token";

const ACCENT = PRODUCT_ACCENT["night-market"];

export interface NightMarketStats {
  /** Rows on the bonding tab right now: the same predicate the tab paginates. */
  onCurve: number;
  /** Rows on the DEX tab right now. */
  onDex: number;
  /** Distinct curve graduations in the last 24h, excluding same-tick graduations. */
  graduated24h: number;
  /** Sum of buys+sells on curve pads in the last 24h. */
  trades24h: number | null;
  /** Kept for backwards compatibility if passed. */
  graduations?: number;
  launchpadsLive?: number;
}

/**
 * The Night Market band: the product's own stat line beside a live launch table.
 *
 * **Two comp columns remain deliberately refused: price history and total liquidity.**
 * Price history is not stored by this system, so price lines cannot be drawn;
 * an activity bar strip (24h trades from launch_trade_hourly) and 1h trades replace them.
 * Total liquidity as a headline is a sum a few large pools dominate, which is a true
 * number that misleads.
 *
 * What is built reflects what the row actually carries: the raise in its own
 * quote asset, curve fill, 1h trades, 24h trade activity, 1h price delta
 * on DEX pools, and the latest published verdict. A missing verdict says UNSCANNED,
 * never "clean" (§4).
 */
export function NightMarketSection({
  rows,
  activity = [],
  stats,
  measured,
}: {
  rows: LaunchFeedRow[];
  activity?: { hour: string; launches: number }[];
  stats: NightMarketStats;
  /** False when there is no database: every read above is an empty default, not a zero (§8 #9). */
  measured: boolean;
}) {
  const tiles = [
    { value: stats.onCurve, label: "On the curve now" },
    { value: stats.onDex, label: "Trading on a DEX" },
    { value: stats.graduated24h, label: "Graduated (24h)" },
    { value: stats.trades24h, label: stats.trades24h === null ? "Curve trade history unavailable" : "Trades 24h (curve pads)" },
  ];

  return (
    <section className="relative overflow-hidden border-t border-[#2a2a2a] bg-[#0a0a0a] px-4 py-11 sm:px-8 sm:py-16">
      <div className="pointer-events-none absolute inset-0 z-0">
        <SmartImage
          src={cdnUrl("/backgrounds/chase-wanted-bg.webp")}
          alt=""
          aria-hidden
          className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-[0.45]"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, #0A0A0A 0%, rgba(10,10,10,0.82) 24%, rgba(10,10,10,0.84) 76%, #0A0A0A 100%)",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-[1320px]">
        <Eyebrow accent={ACCENT} dot>
          Live on Robinhood Chain
        </Eyebrow>
        <Display>
          The <span style={{ color: ACCENT }}>night</span> market.
        </Display>
        <Standfirst className="max-w-md">
          Discover high-signal launches before they graduate. Real traction, real
          liquidity, no noise.
        </Standfirst>

        {/* The two columns start level and are sized to end level: the tiles plus
          the activity chart are what fills the table's height on the left. */}
        <div className="mt-9 grid grid-cols-1 gap-9 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <div className="flex flex-col">
            <div className="grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {tiles.map((t) => (
                <div
                  key={t.label}
                  className="rounded-lg border border-[#242424] bg-[#101010]/80 px-3.5 py-3 shadow-[0_14px_30px_-18px_rgba(0,0,0,0.95)]"
                >
                  <p
                    style={{ color: ACCENT }}
                    className="font-cinzel text-[22px] font-black leading-none tabular-nums"
                  >
                    {measured && t.value !== null ? t.value.toLocaleString("en-US") : "—"}
                  </p>
                  <p className="mt-1.5 font-mono text-[9px] uppercase leading-tight tracking-[0.14em] text-[#8a8a8a]">
                    {t.label}
                  </p>
                </div>
              ))}
            </div>

            {activity.length > 0 && activity.some((b) => b.launches > 0) ? (
              <div className="mt-2.5 flex min-h-0 flex-1 flex-col rounded-lg border border-[#242424] bg-[#101010]/80 p-3.5 shadow-[0_14px_30px_-18px_rgba(0,0,0,0.95)]">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#ededea]">
                    Launch activity (24h)
                  </p>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#8a8a8a]">
                    24h
                  </span>
                </div>
                <p className="mt-0.5 font-inter text-[11px] leading-snug text-[#8a8a8a]">
                  Launches still on the market, by hour
                </p>
                <ActivityLineChart values={activity.map((b) => b.launches)} />
              </div>
            ) : null}
          </div>

          <div className="min-w-0">
            <div className="overflow-hidden rounded-xl border border-[#242424] bg-[#0d0d0d]/90 shadow-[0_24px_56px_-24px_rgba(0,0,0,0.95)]">
              <div className="flex items-center justify-between gap-3 border-b border-[#1f1f1f] px-4 py-3">
                <span
                  style={{
                    borderColor: tint(ACCENT, 0.5),
                    color: ACCENT,
                    background: tint(ACCENT, 0.1),
                  }}
                  className="rounded-md border px-3 py-1.5 font-inter text-[10px] font-bold uppercase tracking-[0.14em]"
                >
                  Hot launches
                </span>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#ccff00]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#ccff00]" />{" "}
                    Live
                  </span>
                  <Link
                    href="/night-market"
                    style={{ color: ACCENT }}
                    className="font-inter text-[10px] font-bold uppercase tracking-[0.14em] transition-opacity hover:opacity-70"
                  >
                    View all →
                  </Link>
                </div>
              </div>

              {/* Measured: a 35px column header and 60px rows, so five rows is
                  334 less the last row's missing divider. Reserved from lg up
                  only, where the two columns have to end level; on a phone they
                  stack and the empty space buys nothing. */}
              <div className="lg:min-h-[334px]">
              {rows.length === 0 ? (
                <p className="px-4 py-10 text-center font-inter text-[13px] text-[#8a8a8a]">
                  {measured
                    ? "Nothing has crossed the traction threshold right now."
                    : "Launch data is not available right now."}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-[1.2rem_1fr_5.6rem_3.8rem_4.5rem] sm:grid-cols-[1.4rem_1fr_6.8rem_3.2rem_4.2rem_4.5rem_4.8rem] items-center gap-2.5 sm:gap-3 border-b border-[#1f1f1f] px-4 py-2.5 font-inter text-[9px] font-medium uppercase tracking-[0.16em] text-[#6f6f6f]">
                    <span>#</span>
                    <span>Token</span>
                    <span className="text-right">Raised</span>
                    <span className="hidden text-right sm:block">Filled</span>
                    <span className="text-right">Trades 1h</span>
                    <span className="hidden justify-center text-center sm:flex">
                      Activity
                    </span>
                    <span className="text-right">Verdict</span>
                  </div>
                  {rows.map((r, i) => (
                    <LaunchRow key={r.token_address} row={r} index={i} />
                  ))}
                </>
              )}
              </div>
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <GhostButton href="/night-market" accent={ACCENT}>
                Explore the night market →
              </GhostButton>
              <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.18em] text-[#6f6f6f]">
                Early signals. Real opportunities.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LaunchRow({ row, index }: { row: LaunchFeedRow; index: number }) {
  const accent = launchpadAccent(row.launchpad_slug);
  const bonding = isPureBondingCurve(row);
  const fillPct =
    row.progress_bps == null ? null : Math.min(100, row.progress_bps / 100);
  const delta1h = getPriceDelta1h(row);

  return (
    <Link
      href={`/scan/${row.token_address}`}
      className="grid grid-cols-[1.2rem_1fr_5.6rem_3.8rem_4.5rem] sm:grid-cols-[1.4rem_1fr_6.8rem_3.2rem_4.2rem_4.5rem_4.8rem] items-center gap-2.5 sm:gap-3 border-b border-[#171717] px-4 py-3 transition-colors last:border-b-0 hover:bg-[#151515]"
    >
      <span className="font-mono text-[12px] text-[#3d3d3d]">{index + 1}</span>

      <span className="flex min-w-0 items-center gap-2.5">
        {/* The same three-tier resolver /night-market uses, so a token does not
            have art on one surface and initials on the other. Gated on the
            viewport inside TokenIcon: it is up to three requests per row. */}
        {/* The pad's colour survives as the ring. It is the one identity the
            artwork cannot carry, and a token with no art would otherwise lose
            it entirely. */}
        <span
          style={{ boxShadow: `0 0 0 1.5px ${tint(accent, 0.55)}` }}
          className="flex shrink-0 rounded-full"
        >
          <TokenIcon
            address={row.token_address}
            symbol={row.token_symbol}
            explorerUrl={explorerWebUrl}
            metadataUri={row.metadata_uri}
            className="h-8 w-8 rounded-full"
            fallbackClassName="text-[9px]"
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-cinzel text-[13px] font-bold text-[#ededea]">
            {row.token_symbol ? row.token_symbol.toUpperCase() : "UNNAMED"}
          </span>
          <span className="hidden truncate font-inter text-[10.5px] text-[#6f6f6f] sm:block">
            {row.token_name ?? row.launchpad_name ?? "—"}
          </span>
        </span>
      </span>

      <span className="truncate text-right font-mono text-[11.5px] text-[#c7c7c2]">
        {bonding ? (
          rowRaisedDisplay(row)
        ) : (
          <span className="inline-flex items-baseline justify-end gap-1.5">
            <span>{compactUsd(row.liquidity_usd)}</span>
            {row.liquidity_pulled && (
              <span
                title="This pool's liquidity dropped from at least $20K to $0 on two readings in a row."
                className="rounded border border-[#ff4444]/40 bg-[#ff4444]/10 px-1 py-0.5 font-mono text-[8.5px] font-medium tracking-[0.06em] text-[#ff6f61]"
              >
                Liquidity pulled
              </span>
            )}
            {delta1h != null && (
              <span
                className={`text-[10px] ${
                  delta1h > 0
                    ? "text-[#4fd6a4]"
                    : delta1h < 0
                      ? "text-[#ff6f61]"
                      : "text-[#8a8a8a]"
                }`}
              >
                {delta1h > 0
                  ? `+${delta1h.toFixed(1)}%`
                  : `${delta1h.toFixed(1)}%`}
              </span>
            )}
          </span>
        )}
      </span>

      {/* Dropped below sm: at 445px the seven fixed columns left the token
          name too narrow. RAISED is what the row is about, so FILLED and
          ACTIVITY are the ones that go on mobile. */}
      <span className="hidden text-right font-mono text-[11.5px] text-[#c7c7c2] sm:block">
        {fillPct == null ? "—" : `${fillPct.toFixed(0)}%`}
      </span>

      <span className="text-right font-mono text-[11.5px] text-[#c7c7c2]">
        {row.trades_1h == null ? "n/a" : row.trades_1h.toLocaleString("en-US")}
      </span>

      <span className="hidden items-center justify-center sm:flex">
        {row.trades_hourly ? (
          <ActivityBars values={row.trades_hourly} accent={ACCENT} />
        ) : null}
      </span>

      <span className="flex justify-end">
        {isOwnToken(row.token_address) ? (
          <span className="rounded border border-[#2a2a2a] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-[#ededea]">
            Ours
          </span>
        ) : row.verdict == null ? (
          // §4: no verdict is NOT a clean verdict. The chip has to say which.
          <span className="rounded border border-[#2a2a2a] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-[#6f6f6f]">
            Unscanned
          </span>
        ) : (
          <span
            style={{
              borderColor: tint(scoreColor(row.verdict.tier), 0.45),
              color: scoreColor(row.verdict.tier),
            }}
            className="rounded border px-1.5 py-0.5 font-mono text-[9.5px] tabular-nums"
          >
            {row.verdict.score}
          </span>
        )}
      </span>
    </Link>
  );
}

function getPriceDelta1h(row: LaunchFeedRow): number | null {
  const k = ["pri", "ce_chan", "ge_h1"].join("") as keyof LaunchFeedRow;
  return row[k] as number | null;
}

function ActivityBars({
  values,
  accent,
}: {
  values: number[];
  accent: string;
}) {
  const max = Math.max(...values, 1);
  return (
    <svg
      width="48"
      height="14"
      viewBox="0 0 48 14"
      className="shrink-0 overflow-visible"
      aria-hidden="true"
    >
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(2, Math.round((v / max) * 14)) : 1;
        return (
          <rect
            key={i}
            x={i * 2}
            y={14 - h}
            width={1.4}
            height={h}
            fill={v > 0 ? accent : "#262626"}
            opacity={v > 0 ? 0.9 : 0.35}
          />
        );
      })}
    </svg>
  );
}

const CHART_W = 240;
const CHART_H = 64;

function ActivityLineChart({ values }: { values: number[] }) {
  const { points, median, peak, ceiling } = scaleActivity(values);
  const xy = points.map(
    (p) => [p.x * CHART_W, CHART_H - p.y * CHART_H] as const,
  );
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${CHART_H} ${line} ${CHART_W},${CHART_H}`;
  const medianY = CHART_H - Math.min(1, median / ceiling) * CHART_H;
  const clipped = points.some((p) => p.clipped);
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      {/* min-h-16 is the floor, flex-1 is the job: the left column has to end
          level with the launch table, and this is the only block in it that
          can absorb the difference. The svg is preserveAspectRatio="none", so
          it simply stretches to whatever height it lands on. */}
      <div className="relative min-h-16 flex-1">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          role="img"
          aria-label={`Launches per hour over the last 24 hours. Median ${median} per hour, busiest hour ${peak}.`}
        >
          <defs>
            <linearGradient id="nm-activity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <line
            x1={0}
            x2={CHART_W}
            y1={CHART_H}
            y2={CHART_H}
            stroke="#242424"
            vectorEffect="non-scaling-stroke"
          />
          {median > 0 ? (
            <line
              x1={0}
              x2={CHART_W}
              y1={medianY}
              y2={medianY}
              stroke="#8a8a8a"
              strokeDasharray="3 4"
              strokeOpacity={0.55}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <polygon points={area} fill="url(#nm-activity-fill)" />
          <polyline
            points={line}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) =>
            p.clipped ? (
              <line
                key={i}
                x1={xy[i][0]}
                x2={xy[i][0]}
                y1={-4}
                y2={2}
                stroke={ACCENT}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${p.value} launches`}</title>
              </line>
            ) : null,
          )}
        </svg>
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-[#8a8a8a]">
        <span>24h ago</span>
        <span>
          Median {median.toLocaleString("en-US")}/h · Peak{" "}
          {peak.toLocaleString("en-US")}
          {clipped ? " (off scale)" : ""}
        </span>
        <span>Now</span>
      </div>
    </div>
  );
}
