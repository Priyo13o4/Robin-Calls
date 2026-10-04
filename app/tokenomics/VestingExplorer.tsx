"use client";

import { useMemo, useState } from "react";
import { TOTAL_SUPPLY } from "@/lib/sale/projection";
import {
  VESTING,
  VESTING_MONTHS as MONTHS,
  TOKENOMICS,
  allocationShades,
  circulatingPctAt,
  vestingBarGeometry,
  vestedFraction,
} from "@/lib/sale/tokenomics";
import { SectionHead } from "./SectionHead";
import { RangeSlider } from "@/app/components/ui/RangeSlider";
import { InfoTooltip } from "@/app/components/ui/InfoTooltip";

/**
 * Sections 03 (PROJECTED CIRCULATING SUPPLY) and 04 (VESTING & UNLOCK
 * SCHEDULE) — the curve first, the schedule that drives it second, because
 * that is the order a phone stacks them in and the curve is the headline
 * number. One component because they share ONE month cursor regardless of
 * DOM order: each section has its own slider, both write the same state, and
 * two copies of the month would be two answers to the same question.
 *
 * Every mark is derived from `vestedFraction`/`circulatingPctAt`, never from a
 * typed-in curve, so a schedule edit in lib/sale/tokenomics.ts moves the bars,
 * the stack, the total line and both readouts together.
 *
 * The schedules are final. The one thing still open is the LIQUIDITY row's LP
 * position lock DURATION — its bar shows the deployment, not the lock, and the
 * draft stamp in section 02 (LAUNCH PRINCIPLES) is what carries that caveat.
 * Do not let this panel imply the lock is on chain.
 */
// Derived from the schedule, not typed: a hardcoded axis outlives the
// horizon it was written for and labels months the slider cannot reach.
const MONTH_MARKS = Array.from({ length: 5 }, (_, i) => Math.round((i * MONTHS) / 4));
/** "TGE" / "MONTH 6" — spelled out now that Vesting has the full row width
 *  to itself rather than sharing it with Circulating Supply. */
const markLabel = (m: number) => (m === 0 ? "TGE" : `MONTH ${m}`);

// Stacked-curve plot box. Kept as constants so the axis, the layers and the
// cursor cannot disagree about where month 0 is.
const W = 720;
const H = 300;
const X0 = 56;
const X1 = 696;
const Y0 = 20;
const Y1 = 268;

const cx = (m: number) => X0 + (m / MONTHS) * (X1 - X0);
const cy = (pct: number) => Y1 - (pct / 100) * (Y1 - Y0);

export function VestingExplorer() {
  const [month, setMonth] = useState(12);
  // Untouched: every month mark reads as live, matching the "full green"
  // reference look. The first drag narrows it to just the mark under the
  // cursor — nothing here means the schedule changed, only that the reader
  // is now pointing at one month instead of the whole timeline.
  const [touched, setTouched] = useState(false);

  const shadeOf = useMemo(() => allocationShades(TOKENOMICS), []);

  const rows = useMemo(
    () =>
      TOKENOMICS.map((r) => {
        const v = VESTING[r.label];
        const f = v ? vestedFraction(v, month) : 0;
        return {
          label: r.label,
          decided: !!r.unlock,
          rule: v?.rule ?? "NOT MODELLED",
          color: shadeOf.get(r.label),
          // Drawn by vestingBarGeometry (lib/sale/tokenomics.ts), not inline:
          // the drawn shape is pinned against the schedule by test, and the
          // inline version once drew the airdrop's M1 step as a 24-month ramp.
          ...vestingBarGeometry(v ?? { tge: 0, cliff: 0, end: 0, rule: "" }, MONTHS),
          // One decimal: Platform Reward's 12.5% step would round to a 13% that no lock releases.
          unlocked: `${+(f * 100).toFixed(1)}%`,
          readColor: f >= 1 ? "#ffffff" : f > 0 ? "#8a8a8a" : "#3d3d3d",
        };
      }),
    [month, shadeOf],
  );

  // One stacked band per allocation, bottom-up, plus the total outline.
  const { layers, totalPath } = useMemo(() => {
    const lower = new Array(MONTHS + 1).fill(0) as number[];
    const out: { points: string; color?: string }[] = [];
    for (const r of TOKENOMICS) {
      const v = VESTING[r.label];
      const upper = lower.map((lo, m) => lo + (v ? r.pct * vestedFraction(v, m) : 0));
      const top = upper.map((u, m) => `${cx(m).toFixed(1)},${cy(u).toFixed(1)}`);
      const bot = lower
        .map((lo, m) => `${cx(m).toFixed(1)},${cy(lo).toFixed(1)}`)
        .reverse();
      out.push({ points: `${top.join(" ")} ${bot.join(" ")}`, color: shadeOf.get(r.label) });
      for (let m = 0; m <= MONTHS; m++) lower[m] = upper[m];
    }
    return {
      layers: out,
      totalPath: "M" + lower.map((u, m) => `${cx(m).toFixed(1)},${cy(u).toFixed(1)}`).join(" L"),
    };
  }, [shadeOf]);

  const circNow = circulatingPctAt(month);
  const circPct = `${circNow.toFixed(1).replace(/\.0$/, "")}%`;
  const circTokens = Math.round((circNow / 100) * TOTAL_SUPPLY).toLocaleString('en-US');
  const lockedPct = `${(100 - circNow).toFixed(1).replace(/\.0$/, "")}%`;
  const monthLabel = String(month).padStart(2, "0");

  return (
    // Stacked, always — not side by side. Each section now claims the FULL
    // row width (Vesting used to share it 50/50 and read cramped once its
    // rows went single-column), and Circulating Supply renders FIRST in the
    // DOM so it is also first on a phone, ahead of the schedule that derives
    // it. The two still share one month cursor regardless of order: the
    // slider lives in Vesting, both react to it.
    <div className="flex flex-col gap-16">
      {/* 03 · PROJECTED CIRCULATING SUPPLY */}
      <section>
        <SectionHead
          n="03"
          title="PROJECTED CIRCULATING SUPPLY"
          sub="MODELLED FROM THE SCHEDULE BELOW, EACH BAND IS ONE ALLOCATION"
        />
        {/* Numbers on the left, the curve on the right — the reverse of the
            old layout, where the readout was squeezed into a 260px sidebar
            beside the chart. Stacks below `lg`: the chart's own x-axis needs
            real width before it reads at all. */}
        <div className="grid border border-[#2a2a2a] bg-[#141414] lg:grid-cols-[1fr_1.618fr]">
          <div className="flex flex-col justify-center gap-[16px] px-[26px] py-[26px]">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="mb-[10px] font-mono text-[12px] tracking-[0.18em] text-[#ccff00]/80">
                  CIRCULATING · MONTH {monthLabel}
                </p>
                {/* keyed on the month so the number re-enters on every step */}
                <p
                  key={month}
                  className="tk-tick font-cinzel text-[42px] font-black leading-none tabular-nums text-white xl:text-[68px]"
                >
                  {circPct}
                </p>
              </div>
              <div className="text-right">
                <p className="mb-[10px] font-mono text-[12px] tracking-[0.18em] text-[#ccff00]/80">
                  LOCKED
                </p>
                <p className="font-cinzel text-[26px] font-bold leading-none tabular-nums text-[#a8a8a2]">
                  {lockedPct}
                </p>
              </div>
            </div>
            <p className="font-mono text-[14.5px] tabular-nums text-[#8a8a8a]">
              {circTokens} ROBINCALLS
            </p>

            {/* This section's own slider. It writes the SAME month cursor as
                the one in 04 — a second piece of state would be a second
                answer to one question — but the reader should not have to
                scroll into the schedule to move the curve they are looking
                at. */}
            <div className="border-t border-[#2a2a2a] pt-4">
              <RangeSlider
                label="Month after TGE"
                value={month}
                min={0}
                max={MONTHS}
                step={1}
                onChange={(v) => {
                  setTouched(true);
                  setMonth(v);
                }}
                valueText={`month ${month} after TGE`}
              />
              <div className="mt-2 flex justify-between font-mono text-[12px] tracking-[0.12em] text-[#4a4a4a]">
                <span>TGE</span>
                <span>MONTH {MONTHS}</span>
              </div>
            </div>

            <p className="text-[14.5px] leading-relaxed text-[#7a7a7a]">
              Everything is fully unlocked by month {MONTHS}. Read the liquidity
              row carefully: its 20% goes into the pool at launch, and how long
              that pool position stays locked is not yet fixed.
            </p>
          </div>

          <figure className="m-0 border-t border-[#2a2a2a] py-5 pl-3 pr-2 lg:border-l lg:border-t-0">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="block w-full"
              role="img"
              aria-label={`Stacked circulating supply over ${MONTHS} months, one layer per allocation.`}
            >
              {[0, 25, 50, 75, 100].map((p) => (
                <g key={p}>
                  <line x1={X0} x2={X1} y1={cy(p)} y2={cy(p)} stroke="#222" strokeDasharray="3 3" />
                  <text
                    x={X0 - 10}
                    y={cy(p) + 6}
                    textAnchor="end"
                    className="fill-[#8a8a8a] font-mono text-[18px]"
                  >
                    {p}%
                  </text>
                </g>
              ))}
              {/* The svg scales to ~0.45 on a phone, so anything under ~18
                  viewBox units is unreadable there. End marks anchor inward:
                  "MONTH 24" centred on X1 runs past the viewBox edge. */}
              {MONTH_MARKS.map((m, i) => (
                <text
                  key={m}
                  x={cx(m)}
                  y={H - 8}
                  textAnchor={i === 0 ? "start" : i === MONTH_MARKS.length - 1 ? "end" : "middle"}
                  className="fill-[#8a8a8a] font-mono text-[18px]"
                >
                  {markLabel(m)}
                </text>
              ))}
              {layers.map((l, i) => (
                <polygon
                  key={i}
                  points={l.points}
                  fill={l.color}
                  opacity={0.75}
                  stroke="#0a0a0a"
                  strokeWidth="0.6"
                />
              ))}
              <path
                d={totalPath}
                className="tk-draw"
                pathLength={1}
                fill="none"
                stroke="#ededea"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <line
                x1={cx(month)}
                x2={cx(month)}
                y1={Y0}
                y2={Y1}
                stroke="#ccff00"
                strokeWidth="1"
              />
              <circle
                cx={cx(month)}
                cy={cy(circNow)}
                r="5"
                fill="#ccff00"
                stroke="#0a0a0a"
                strokeWidth="2"
              />
            </svg>
          </figure>
        </div>
      </section>

      {/* 04 · VESTING & UNLOCK SCHEDULE — claims the full row width the pair
          used to split, and lays its rows out two-up from `sm` so the whole
          box plus its slider stays inside one screen. */}
      <section>
        <SectionHead
          n="04"
          title="VESTING & UNLOCK SCHEDULE"
          sub="LOCKED ON PINKLOCK. DRAG THE MONTH TO SEE ANY POINT"
        />
        <div className="overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#111111]">
          {/* Two columns from `sm`: seven full-width rows made this box taller
              than a desktop screen on its own. The month axis moved down to
              sit with the slider — one full-width axis over a two-column grid
              would be claiming an alignment that isn't there.

              Card layout otherwise: the name and
              the unlocked percentage are the two numbers a reader actually
              wants at a glance, so both are big and bright here. The rule
              (the cliff/linear/tiered shape in words) moves into a tooltip —
              it was small grey mono printed beside a track barely wide enough
              for it, and half the rules ran longer than that track. */}
          <div className="grid gap-[16px] p-[16px] sm:grid-cols-2 sm:p-[26px]">
            {rows.map((r) => (
              <div key={r.label} className="tk-card min-w-0 px-[16px] py-[16px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className="h-2.5 w-2.5 flex-none" style={{ background: r.color }} />
                    <span className="truncate font-mono text-[15.5px] font-bold tracking-[0.1em] text-white lg:text-[19px]">
                      {r.label}
                    </span>
                    <InfoTooltip text={r.rule} label={`${r.label} unlock rule`} align="auto" />
                  </span>
                  <span
                    className="flex-none font-mono text-[20px] font-bold tabular-nums"
                    style={{ color: r.readColor }}
                  >
                    {r.unlocked}
                  </span>
                </div>

                <div className="relative mt-[10px] h-4 overflow-hidden rounded-full border border-[#2a2a2a] bg-[#0a0a0a]">
                  {/* Grammar (see vestingBarGeometry): hatch = the ramp's cliff,
                      colour = the release window, dark past it = settled. The
                      TGE span is a fixed-width marker at the track's start: it
                      fills the track when the whole release is at TGE, and on
                      ramp rows it marks the TGE drop inside the hatch — that
                      drop did happen, so the hatch must not cover it. */}
                  <span
                    className="absolute inset-y-0 left-0"
                    style={{
                      width: r.cliffW,
                      backgroundImage:
                        "repeating-linear-gradient(135deg,#161616 0 5px,#0e0e0e 5px 10px)",
                    }}
                  />
                  <span
                    className="absolute inset-y-0 opacity-90"
                    style={{ left: r.linLeft, width: r.linW, background: r.color }}
                  />
                  <span
                    className="absolute inset-y-0 left-0"
                    style={{ width: r.tgeW, background: r.color }}
                  />
                  {/* month cursor, per row: a single overlaid line has to guess
                      the track's left edge in a grid that reflows */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 w-px bg-[#ccff00]"
                    style={{ left: `${(month / MONTHS) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-[#2a2a2a] px-[26px] pb-[16px] pt-[16px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[13px] tracking-[0.18em] text-[#8a8a8a]">
              <span>
                MONTH <span className="text-white">{monthLabel}</span> AFTER TGE
              </span>
              <span className="text-white">
                {circPct}{" "}
                <span className="text-[#8a8a8a]">CIRCULATING · {circTokens}</span>
              </span>
            </div>
            <RangeSlider
              className="mt-2"
              label="Month after TGE"
              value={month}
              min={0}
              max={MONTHS}
              step={1}
              onChange={(v) => {
                setTouched(true);
                setMonth(v);
              }}
              valueText={`month ${month} after TGE`}
            />
            <div className="mt-2 flex justify-between font-mono text-[12px] tracking-[0.14em] text-[#4a4a4a]">
              {MONTH_MARKS.map((m) => (
                <span key={m} className={!touched || m === month ? "text-[#ccff00]" : undefined}>
                  {markLabel(m)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
