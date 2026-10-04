"use client";

import { useMemo, useRef, useState } from "react";
import { UnsetBar } from "@/app/components/site/Skeleton";
import { RangeSlider } from "@/app/components/ui/RangeSlider";
import {
  RAISE_LADDER_BASE,
  SALE_TOKENS,
  TOTAL_SUPPLY,
  fdvAt,
  fmtPrice,
  raiseCeiling,
} from "@/lib/sale/projection";

/**
 * "What does a stake in this sale do as the raise grows" — the projection that
 * used to live on /tokenomics. It belongs here: it is a statement about THIS
 * sale's live raise, and on a static fact sheet it had to invent raise levels.
 *
 * IT PLOTS THE ALLOCATION, NOT THE FDV. Fully diluted value is raise × supply ÷
 * pool — a straight line through the origin, so a chart of it says nothing the
 * slider does not already say. What actually bends in a pro-rata sale is what a
 * given stake receives: pool × stake ÷ raise, a hyperbola that decays as later
 * money arrives. That decay is the one mechanic a contributor has to
 * understand, so it is the one that gets drawn. FDV is still printed, as a
 * number, below.
 *
 * NO LISTING LINE. Both listing projections are gone by operator decision (see
 * lib/sale/projection.ts).
 *
 * THE AXIS GROWS, IT NEVER RESCALES. The ceiling is 5 ETH until the raise
 * passes 5, then 10, 20, 40 — `raiseCeiling`. A ceiling that tracked the raise
 * continuously would pin the bar at the same fraction forever.
 *
 * NO FLICKER, and it is not a cosmetic requirement. `raisedEth` is null while
 * the read is in flight and again whenever it faults, and a ceiling recomputed
 * from null would snap the axis back to 5 ETH — rescaling the chart, the bar
 * and the slider under a reader who is mid-drag. So the ceiling is held in a
 * ref and only ever RATCHETS UP: an unread raise keeps the last axis rather
 * than proposing a smaller one. The panel renders at full size from the first
 * paint with "—" in the number slots, so nothing reflows when the read lands.
 */

/** The stake the curve is drawn for when the reader has not contributed. Any
 *  stake gives the same SHAPE — only the y-axis scales — so this is a unit of
 *  illustration, and the panel names it rather than implying it is theirs. */
const REFERENCE_STAKE = 0.1;

export function RaiseProjection({
  raisedEth,
  poolTokens = SALE_TOKENS,
  yourEth = null,
  unset = false,
}: {
  /** No sale contract is configured, so every readout below is unsourced. The
   *  CURVE still draws: it is arithmetic over the published tokenomics and
   *  says so, which is a different claim from a live figure. */
  unset?: boolean;
  /** Live total raised, ETH. `null` = we could not read it — never "zero". */
  raisedEth: number | null;
  /** The CHAIN's sale pool. Pricing must divide what the contract holds, not
   *  the published split, or this panel and the TOKEN POOL cell disagree. */
  poolTokens?: number;
  /** This wallet's own contribution, ETH. Null or zero falls back to the
   *  reference stake, and the panel says which one it drew. */
  yourEth?: number | null;
}) {
  // Ratchet: max of every ceiling this session, so a faulted read (null) or a
  // refund-shrunk raise cannot pull the axis in under the reader.
  const held = useRef(RAISE_LADDER_BASE);
  const ceiling = useMemo(() => {
    if (raisedEth !== null) held.current = Math.max(held.current, raiseCeiling(raisedEth));
    return held.current;
  }, [raisedEth]);

  // `null` = the cursor has not been moved, so it TRACKS the live raise. Once
  // dragged it stops following: a live update that yanks the handle out from
  // under the pointer is the same flicker in a different costume.
  const [cursor, setCursor] = useState<number | null>(null);
  const at = cursor ?? raisedEth ?? 0;

  const isMine = yourEth !== null && yourEth > 0;
  const stake = isMine ? yourEth : REFERENCE_STAKE;

  // Left edge of the curve. A raise can never be smaller than the stake inside
  // it, and the ceiling/10 floor stops a tiny stake plotting an asymptote that
  // is all cliff and no curve.
  const floor = Math.max(stake, raisedEth ?? 0, ceiling / 10);
  const tokensAt = (r: number) => (r > 0 ? (poolTokens * stake) / r : 0);

  const price = poolTokens > 0 ? at / poolTokens : 0;
  const fdv = fdvAt(price);
  // Same rule as yourTokens: a raise smaller than the stake cannot contain it (printed 1000% at 0.01 ETH).
  const sharePct = at > 0 && at >= stake ? (stake / at) * 100 : null;
  const yourTokens = at >= stake ? tokensAt(at) : null;
  const step = ceiling / 200;

  const rungs = useMemo(() => {
    const out: number[] = [];
    for (let r = RAISE_LADDER_BASE; r <= ceiling; r *= 2) out.push(r);
    return out;
  }, [ceiling]);

  return (
    <div>
      <AllocationCurve
        ceiling={ceiling}
        floor={floor}
        tokensAt={tokensAt}
        cursor={at}
        live={raisedEth}
        stake={stake}
        isMine={isMine}
      />

      <div className="border-t border-[#2a2a2a] px-5 py-5">
        <div className="flex items-baseline justify-between gap-3 font-mono text-[12px] font-bold tracking-[0.18em] text-white">
          <span>
            AT A RAISE OF{" "}
            <span className="text-[15px] font-bold tabular-nums tracking-normal text-[#ededea]">
              {fmtEth(at)}
            </span>{" "}
            ETH
          </span>
          <span className="tabular-nums text-[#6f6f6f]">0 – {fmtEth(ceiling)} ETH</span>
        </div>

        {/* The raise bar and the slider share one axis, so the fill IS the
            position: two separately-scaled tracks reading the same quantity is
            how a bar and its control drift apart.
            An UNREAD raise gets a hatch, not an empty track: a bar at zero is
            an affirmative claim that nothing has been raised, and "we could not
            read it" is not that claim (§4). */}
        <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#0a0a0a]">
          {raisedEth === null ? (
            <div
              className="h-full w-full opacity-60"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(115deg,#1a1a1a 0 4px,#0f0f0f 4px 9px)",
              }}
              title="The raise could not be read. This is not zero."
            />
          ) : (
            <div
              className="h-full rounded-full bg-[#3d5c1f] transition-[width] duration-500 ease-out"
              style={{ width: `${pctOf(raisedEth, ceiling)}%` }}
            />
          )}
        </div>

        <RangeSlider
          className="mt-1"
          label="Projected raise, in ETH"
          value={at}
          min={0}
          max={ceiling}
          step={step}
          onChange={setCursor}
          valueText={`${fmtEth(at)} ETH raised`}
        />

        <div className="flex justify-between font-mono text-[9px] tabular-nums text-[#4a4a4a]">
          <span>0</span>
          {rungs.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setCursor(r)}
              className={`transition-colors ${at === r ? "text-[#ccff00]" : "hover:text-[#a0a09a]"}`}
            >
              {fmtEth(r)}
            </button>
          ))}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label={isMine ? "YOUR TOKENS" : `TOKENS FOR ${fmtEth(stake)} ETH`}
            value={yourTokens === null ? "—" : fmtCount(yourTokens)}
            accent
            unset={unset}
          />
          <Stat
            label="SHARE OF POOL"
            value={sharePct === null ? "—" : `${sharePct < 0.01 ? "<0.01" : sharePct.toFixed(2)}%`}
            unset={unset}
          />
          <Stat
            label="PRICE PER TOKEN"
            value={at > 0 ? fmtPrice(price) : "—"}
            unit={at > 0 ? "ETH" : undefined}
            unset={unset}
          />
          <Stat
            label="FULLY DILUTED"
            value={at > 0 ? fmtPrice(fdv) : "—"}
            unit={at > 0 ? "ETH" : undefined}
            muted
            unset={unset}
          />
        </dl>

        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] tracking-[0.14em] text-[#6f6f6f]">
          <span>
            RAISED SO FAR{" "}
            <span className="tabular-nums text-[#a0a09a]">
              {unset ? (
                <UnsetBar className="h-3 w-14" />
              ) : raisedEth === null ? (
                "—"
              ) : (
                `${fmtEth(raisedEth)} ETH`
              )}
            </span>
          </span>
          <span>
            TO LIQUIDITY <span className="tabular-nums text-[#a0a09a]">{fmtEth(at * 0.8)} ETH</span>
          </span>
        </p>

        <p className="mt-3 text-[11px] leading-relaxed text-[#8a8a8a]">
          {isMine
            ? "The curve is your own contribution, priced at raises that have not happened."
            : `The curve is a ${fmtEth(stake)} ETH stake, an illustration rather than your position. Any stake bends the same way.`}{" "}
          It is arithmetic, not a forecast: nothing here says the sale will reach any of these
          levels. Fully-diluted value prices all {TOTAL_SUPPLY.toLocaleString("en-US")}{" "}
          tokens, most of which are not circulating at launch.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const W = 720;
const H = 260;
const PAD = { top: 18, right: 20, bottom: 34, left: 74 };

/**
 * Tokens a stake receives against the raise it lands in: pool × stake ÷ raise.
 *
 * Drawn as a curve because it IS one — unlike FDV, which this panel used to
 * plot as a line through the origin. The y-axis starts at zero so the decay
 * reads at its true depth; a truncated axis would flatten the whole point.
 */
function AllocationCurve({
  ceiling,
  floor,
  tokensAt,
  cursor,
  live,
  stake,
  isMine,
}: {
  ceiling: number;
  floor: number;
  tokensAt: (r: number) => number;
  cursor: number;
  live: number | null;
  stake: number;
  isMine: boolean;
}) {
  const span = Math.max(ceiling - floor, 1e-9);
  const top = tokensAt(floor);
  const px = (r: number) =>
    PAD.left + ((r - floor) / span) * (W - PAD.left - PAD.right);
  const py = (v: number) =>
    H - PAD.bottom - (top > 0 ? v / top : 0) * (H - PAD.top - PAD.bottom);

  // 64 samples: enough that the hyperbola's knee is smooth at this width, and
  // few enough to stay one small path. Not memoised — the inputs include the
  // chain-read pool, and a dep list that missed it would freeze the curve at
  // the fallback pool size.
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const r = floor + (span * i) / 64;
    pts.push([px(r), py(tokensAt(r))]);
  }

  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${px(ceiling)},${py(0)} L${px(floor)},${py(0)} Z`;
  const onCurve = (r: number) => r >= floor && r <= ceiling;

  return (
    <figure className="m-0 px-5 pt-5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`Tokens a ${fmtEth(stake)} ETH stake receives, against a raise from ${fmtEth(floor)} to ${fmtEth(ceiling)} ETH.`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={py(g * top)}
              y2={py(g * top)}
              stroke="#202020"
              strokeDasharray="3 3"
            />
            <text
              x={PAD.left - 10}
              y={py(g * top) + 3}
              textAnchor="end"
              className="fill-[#6f6f6f] font-mono text-[10px]"
            >
              {fmtAxis(g * top, top)}
            </text>
          </g>
        ))}

        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <text
            key={g}
            x={px(floor + g * span)}
            y={H - PAD.bottom + 17}
            textAnchor="middle"
            className="fill-[#6f6f6f] font-mono text-[10px]"
          >
            {fmtEth(floor + g * span)}
          </text>
        ))}
        <text
          x={(PAD.left + W - PAD.right) / 2}
          y={H - 4}
          textAnchor="middle"
          className="fill-[#6f6f6f] font-mono text-[10px]"
        >
          RAISED (ETH)
        </text>
        <text
          x={13}
          y={(H - PAD.bottom + PAD.top) / 2}
          textAnchor="middle"
          transform={`rotate(-90 13 ${(H - PAD.bottom + PAD.top) / 2})`}
          className="fill-[#6f6f6f] font-mono text-[10px]"
        >
          {isMine ? "YOUR TOKENS" : "TOKENS"}
        </text>

        <defs>
          <linearGradient id="allocFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6da325" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#6da325" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#allocFill)" />
        <path d={line} fill="none" stroke="#6da325" strokeWidth="2" strokeLinecap="round" />

        {/* Where the sale actually IS, distinct from where the cursor is: one
            is a measurement and the other is a hypothesis, and a single marker
            for both would let a dragged number read as a live one. */}
        {live !== null && onCurve(live) && (
          <g>
            <line
              x1={px(live)}
              y1={py(0)}
              x2={px(live)}
              y2={py(tokensAt(live))}
              stroke="#ccff00"
              strokeWidth="1"
              opacity={0.55}
            />
            <circle
              cx={px(live)}
              cy={py(tokensAt(live))}
              r="4"
              fill="#ccff00"
              stroke="#0a0a0a"
              strokeWidth="1.5"
            />
          </g>
        )}

        {onCurve(cursor) && (
          <g>
            <line
              x1={px(cursor)}
              y1={py(0)}
              x2={px(cursor)}
              y2={py(tokensAt(cursor))}
              stroke="#8a8a8a"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <circle
              cx={px(cursor)}
              cy={py(tokensAt(cursor))}
              r="4.5"
              fill="#0a0a0a"
              stroke="#ededea"
              strokeWidth="1.75"
            />
          </g>
        )}
      </svg>
    </figure>
  );
}

function Stat({
  label,
  value,
  unit,
  accent = false,
  muted = false,
  unset = false,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  muted?: boolean;
  unset?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] p-3.5 transition-colors hover:border-[#3a3a3a]">
      <dt className="font-mono text-[11px] font-semibold tracking-[0.18em] text-white truncate">{label}</dt>
      <dd
        className={`mt-1.5 font-mono text-base sm:text-lg font-bold leading-none tabular-nums truncate ${accent ? "text-[#ccff00]" : muted ? "text-[#a0a09a]" : "text-[#ededea]"}`}
      >
        {unset ? <UnsetBar className="h-4 w-16" /> : value}
        {!unset && unit && <span className="ml-1 text-[10px] font-normal text-[#6f6f6f]">{unit}</span>}
      </dd>
    </div>
  );
}

function pctOf(n: number, of: number): number {
  if (!(of > 0)) return 0;
  return Math.min(100, Math.max(0, (n / of) * 100));
}

/** Raises print at the precision the rung needs — 0.25 and 40 in one axis. */
function fmtEth(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 3 : n < 10 ? 2 : 0 });
}

/** Whole tokens, abbreviated once they stop fitting. */
function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString("en-US")}k`;
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Axis ticks, at ONE precision for the whole axis — chosen from the axis top,
 * never per tick. Deciding per value printed "4.17" and "13" as neighbours on
 * the same scale, which reads as two different quantities rather than four
 * points on one.
 */
function fmtAxis(n: number, top: number): string {
  if (top >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (top >= 1000) return `${(n / 1000).toFixed(1)}k`;
  const dp = top >= 100 ? 0 : top >= 10 ? 1 : 2;
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
