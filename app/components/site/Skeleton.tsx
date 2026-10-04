"use client";

import React from "react";

/**
 * Shared Shimmer Primitive for Night Market & RobinCalls Noir theme.
 * Reuses the canonical `@keyframes shimmer` from `app/globals.css`.
 */
export function ShimmerBlock({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`animate-shimmer bg-[length:200%_100%] bg-[linear-gradient(90deg,#1c1c1c_25%,#262626_37%,#1c1c1c_63%)] ${className}`}
    />
  );
}

/**
 * Billboard hero skeleton for /ecosystem loading state.
 */
export function SkeletonBillboard() {
  return (
    <div className="relative mb-14 w-full overflow-hidden border border-[#2a2a2a] bg-[#141414] p-6 sm:p-10 lg:p-14 shadow-2xl">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
        {/* Left column */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex gap-2">
            <ShimmerBlock className="h-6 w-32" />
            <ShimmerBlock className="h-6 w-24" />
          </div>
          <ShimmerBlock className="h-12 sm:h-16 w-3/4" />
          <ShimmerBlock className="h-4 w-full" />
          <ShimmerBlock className="h-4 w-5/6" />
          <div className="flex gap-4 pt-4">
            <ShimmerBlock className="h-12 w-44" />
            <ShimmerBlock className="h-12 w-36" />
          </div>
        </div>
        {/* Right column preview */}
        <div className="lg:col-span-5 hidden lg:block">
          <ShimmerBlock className="h-56 w-full border border-[#2a2a2a]" />
        </div>
      </div>
      {/* Progress bar track */}
      <div className="mt-10 border-t border-[#2a2a2a]/60 pt-4 flex justify-between items-center">
        <ShimmerBlock className="h-2 w-72 rounded-full" />
        <ShimmerBlock className="h-8 w-20" />
      </div>
    </div>
  );
}

/**
 * Ecosystem Card Skeleton.
 */
export function SkeletonEcosystemCard() {
  return (
    <div className="flex w-[260px] sm:w-[290px] flex-none flex-col border border-[#2a2a2a] bg-[#141414] p-0 overflow-hidden">
      <ShimmerBlock className="h-32 sm:h-36 w-full" />
      <div className="p-4 space-y-3">
        <div className="flex justify-between items-center">
          <ShimmerBlock className="h-5 w-32" />
          <ShimmerBlock className="h-4 w-4" />
        </div>
        <ShimmerBlock className="h-3 w-full" />
        <ShimmerBlock className="h-3 w-4/5" />
        <div className="pt-3 border-t border-[#2a2a2a]/60 flex justify-between">
          <ShimmerBlock className="h-6 w-20" />
          <ShimmerBlock className="h-6 w-16" />
        </div>
      </div>
    </div>
  );
}

/**
 * Horizontal Carousel Row Skeleton for /ecosystem.
 */
export function SkeletonCarouselRow() {
  return (
    <div className="mb-12 space-y-4">
      <div className="flex justify-between items-center px-1">
        <div className="flex items-center gap-3">
          <ShimmerBlock className="h-7 w-48" />
          <ShimmerBlock className="h-5 w-8" />
        </div>
        <ShimmerBlock className="h-8 w-18" />
      </div>
      <div className="flex gap-4 sm:gap-6 overflow-hidden py-1">
        <SkeletonEcosystemCard />
        <SkeletonEcosystemCard />
        <SkeletonEcosystemCard />
        <SkeletonEcosystemCard />
      </div>
    </div>
  );
}

/**
 * /rwa skeleton: mirrors RwaTerminalClient (telemetry + filter card, then the token table).
 */
export function SkeletonRwaPage() {
  return (
    <section className="mx-auto max-w-7xl px-3 pb-20 sm:px-6 font-mono">
      <div className="mb-4 rounded-xl border border-[#262626] bg-[#0c0c0c] p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f1f1f] pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <ShimmerBlock className="h-3 w-28" />
            {Array.from({ length: 5 }).map((_, i) => (
              <ShimmerBlock key={i} className="h-6 w-24 rounded-full" />
            ))}
          </div>
          <ShimmerBlock className="h-4 w-36" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {[28, 24, 20, 24].map((w, i) => (
              <ShimmerBlock key={i} className="h-7 rounded-lg" style={{ width: `${w * 4}px` }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <ShimmerBlock className="h-8 w-[220px] rounded-lg sm:w-[260px]" />
            <ShimmerBlock className="size-8 rounded-lg" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-[#1a1a1a] pt-3">
          <ShimmerBlock className="h-6 w-28 rounded" />
          <ShimmerBlock className="h-5 w-56" />
          <ShimmerBlock className="h-5 w-56" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#242827] bg-[#0b0e0d] shadow-2xl">
        <div className="flex items-center gap-6 border-b border-[#1c1c1c] bg-[#0d0d0d] px-5 py-3.5">
          <ShimmerBlock className="h-3 w-6" />
          <ShimmerBlock className="h-3 w-40" />
          <div className="ml-auto hidden items-center gap-10 md:flex">
            {Array.from({ length: 6 }).map((_, i) => (
              <ShimmerBlock key={i} className="h-3 w-14" />
            ))}
          </div>
        </div>
        <div className="space-y-1 p-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 rounded-lg border border-[#202424] bg-[#0e1110] px-5 py-4">
              <ShimmerBlock className="h-3 w-5" />
              <div className="flex items-center gap-3">
                <ShimmerBlock className="size-9 rounded-full" />
                <div className="space-y-1.5">
                  <ShimmerBlock className="h-4 w-20" />
                  <ShimmerBlock className="h-3 w-32" />
                </div>
              </div>
              <div className="ml-auto hidden items-center gap-10 md:flex">
                {Array.from({ length: 6 }).map((_, j) => (
                  <ShimmerBlock key={j} className="h-4 w-14" />
                ))}
              </div>
              <ShimmerBlock className="ml-auto h-8 w-24 rounded-lg md:ml-0" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SKEL_CARD = "rounded-xl border border-[#242827] bg-[#0e100f]";

/**
 * The right rail of both terminals (TradingRightRail / RwaRightRail). Carries the same
 * phone `order` classes as the real rails, so the placeholder does not jump on load.
 */
function SkeletonTerminalRail({ banner }: { banner: boolean }) {
  return (
    <>
      <div className="max-lg:contents lg:rounded-xl lg:border lg:border-[#242827] lg:bg-[#0e100f] lg:p-3">
        <div className={`max-lg:order-first max-lg:p-3 max-lg:rounded-xl max-lg:border max-lg:border-[#242827] max-lg:bg-[#0e100f]`}>
          <div className="flex items-center gap-2.5">
            <ShimmerBlock className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <ShimmerBlock className="h-4 w-32" />
              <ShimmerBlock className="h-3 w-24" />
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-[#1a1a1a] pt-2">
            <div className="flex gap-1.5">
              <ShimmerBlock className="h-5 w-24 rounded" />
              <ShimmerBlock className="h-5 w-20 rounded" />
            </div>
            <ShimmerBlock className="h-3 w-14" />
          </div>
        </div>
        <div className={`max-lg:order-2 max-lg:p-3 max-lg:rounded-xl max-lg:border max-lg:border-[#242827] max-lg:bg-[#0e100f]`}>
          {banner && <ShimmerBlock className="mb-2 h-24 w-full rounded-lg lg:mt-2.5" />}
          <div className="grid grid-cols-2 gap-1.5 lg:mt-2">
            <ShimmerBlock className="h-7 w-full rounded-md" />
            <ShimmerBlock className="h-7 w-full rounded-md" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 max-lg:order-2">
        {[24, 20].map((w, i) => (
          <div key={i} className={`${SKEL_CARD} space-y-1.5 p-2.5`}>
            <ShimmerBlock className="h-2.5 w-16" />
            <ShimmerBlock className="h-5" style={{ width: `${w * 4}px` }} />
          </div>
        ))}
      </div>

      <div className={`${SKEL_CARD} grid grid-cols-3 gap-1.5 p-2.5 max-lg:order-2`}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <ShimmerBlock className="mx-auto h-2.5 w-12" />
            <ShimmerBlock className="mx-auto h-4 w-14" />
          </div>
        ))}
      </div>

      {/* Timeframes, activity and Buy / Sell: sits right under the chart on phones. */}
      <div className={`${SKEL_CARD} space-y-3 p-2.5 max-lg:order-1`}>
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerBlock key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
        <div className="space-y-2.5 border-t border-[#1a1a1a] pt-2">
          <ShimmerBlock className="h-8 w-full rounded" />
          <ShimmerBlock className="h-8 w-full rounded" />
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-[#1a1a1a] pt-2">
          <ShimmerBlock className="h-8 w-full rounded-lg" />
          <ShimmerBlock className="h-8 w-full rounded-lg" />
          <ShimmerBlock className="h-8 w-full rounded-lg" />
        </div>
      </div>

      <div className={`${SKEL_CARD} space-y-2 p-3 max-lg:order-2`}>
        <ShimmerBlock className="h-3 w-24" />
        <ShimmerBlock className="h-7 w-full rounded" />
        <ShimmerBlock className="h-7 w-full rounded" />
        <ShimmerBlock className="h-7 w-full rounded" />
      </div>

      <div className={`${SKEL_CARD} space-y-2 p-3 max-lg:order-2`}>
        <div className="flex items-center justify-between">
          <ShimmerBlock className="h-4 w-28" />
          <ShimmerBlock className="h-5 w-20 rounded" />
        </div>
        <ShimmerBlock className="h-24 w-full rounded-lg" />
      </div>

      <div className={`${SKEL_CARD} space-y-2 p-3 max-lg:order-2`}>
        <ShimmerBlock className="h-4 w-28" />
        <ShimmerBlock className="h-20 w-full rounded-lg" />
      </div>
    </>
  );
}

function SkeletonTickerBar() {
  return (
    <div className="flex items-center justify-between gap-4 overflow-x-auto border-b border-[#1c1c1c] bg-[#0c0c0c] px-4 py-2">
      <div className="flex shrink-0 items-center gap-3">
        <ShimmerBlock className="h-3.5 w-24" />
        <ShimmerBlock className="h-3.5 w-20" />
        {Array.from({ length: 5 }).map((_, i) => (
          <ShimmerBlock key={i} className="h-6 w-24 rounded-lg" />
        ))}
      </div>
      <div className="hidden shrink-0 items-center gap-4 lg:flex">
        <ShimmerBlock className="h-3 w-28" />
        <ShimmerBlock className="h-3 w-32" />
      </div>
    </div>
  );
}

function SkeletonTxTable({ className = "" }: { className?: string }) {
  return (
    <div className={`${SKEL_CARD} flex min-h-[220px] flex-col gap-3 overflow-hidden p-3 max-lg:order-2 ${className}`}>
      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-2">
        <div className="flex gap-2">
          <ShimmerBlock className="h-6 w-28 rounded" />
          <ShimmerBlock className="h-6 w-20 rounded" />
          <ShimmerBlock className="hidden h-6 w-20 rounded sm:block" />
        </div>
        <ShimmerBlock className="h-6 w-40 rounded" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <ShimmerBlock key={i} className="h-7 w-full rounded" />
        ))}
      </div>
    </div>
  );
}

/**
 * /rwa/[address] skeleton: mirrors RwaDetailClient (dual charts + trades, RwaRightRail).
 */
export function SkeletonRwaDetailPage() {
  return (
    <div className="min-h-screen bg-[#070707] font-mono text-white">
      <SkeletonTickerBar />
      <div className="mx-auto max-w-[1700px] p-3 sm:p-4 lg:p-5">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-3 max-lg:contents">
            <div className="grid shrink-0 grid-cols-1 gap-3 xl:grid-cols-2">
              {[36, 44].map((w, i) => (
                <div key={i} className={`${SKEL_CARD} p-3`}>
                  <div className="mb-2 flex items-center justify-between border-b border-[#1a1a1a] pb-2">
                    <ShimmerBlock className="h-3.5" style={{ width: `${w * 4}px` }} />
                    <ShimmerBlock className="h-3 w-20" />
                  </div>
                  <ShimmerBlock className="h-[400px] w-full rounded-lg sm:h-[420px]" />
                </div>
              ))}
            </div>
            <SkeletonTxTable className="max-h-[360px] flex-1" />
          </div>
          <div className="w-full shrink-0 max-lg:contents lg:flex lg:w-[360px] lg:flex-col lg:gap-3 xl:w-[380px]">
            <SkeletonTerminalRail banner={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * /trade/[token] skeleton: mirrors TradePageClient (chart + trades, TradingRightRail).
 */
export function SkeletonTradePage() {
  return (
    <div className="min-h-screen bg-[#070707] font-mono text-[#ededea]">
      <SkeletonTickerBar />
      <div className="mx-auto max-w-[1600px] p-3 sm:p-4 lg:p-5">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden max-lg:contents lg:h-[calc(100dvh-104px)]">
            <div className={`${SKEL_CARD} shrink-0 overflow-hidden lg:flex lg:min-h-[300px] lg:flex-[3] lg:shrink lg:flex-col`}>
              <div className="flex items-center justify-between border-b border-[#1c1c1c] px-4 py-2.5">
                <ShimmerBlock className="h-3.5 w-32" />
                <ShimmerBlock className="h-3.5 w-20" />
              </div>
              <div className="flex gap-2 border-b border-[#1c1c1c] px-4 py-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <ShimmerBlock key={i} className="h-5 w-8 rounded" />
                ))}
              </div>
              <ShimmerBlock className="h-[380px] w-full lg:h-auto lg:flex-1" />
            </div>
            <SkeletonTxTable className="max-h-[380px] flex-1 lg:max-h-none lg:flex-[2] lg:min-h-[200px]" />
          </div>
          <div className="w-full shrink-0 max-lg:contents lg:w-[350px] lg:space-y-3 xl:w-[365px]">
            <SkeletonTerminalRail banner />
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * Sale-page placeholders.
 *
 * A skeleton is a claim about SHAPE, never about value. The sale page hid
 * "Your position" until its read landed and let the referral panel render its
 * bind prompt from an unloaded state, so "we have not asked yet" looked exactly
 * like "the answer is nothing". §4 at the presentation layer, and here the
 * invented fact was "you have not contributed" shown to somebody who had.
 */

/** One label/value row, matching the sale page's `Row` so nothing jumps. */
export function SkeletonRow({
  labelW = "w-24",
  valueW = "w-20",
}: {
  labelW?: string;
  valueW?: string;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <ShimmerBlock className={`h-3 rounded ${labelW}`} />
      <ShimmerBlock className={`h-3 rounded ${valueW}`} />
    </div>
  );
}

/** Marks a loading region busy, so it is announced rather than read out as bars. */
export function SkeletonRegion({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** The referral panel while its first fetch is in flight. */
export function SkeletonReferralPanel() {
  return (
    <SkeletonRegion
      label="Loading your referral details"
      className="rounded-3xl border-2 border-[#2a2a2a] bg-[#141414] p-5"
    >
      <p className="font-mono text-[10px] tracking-[0.22em] text-[#8a8a8a]">REFERRALS</p>
      <div className="mt-4 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-[#2a2a2a] p-4">
            <ShimmerBlock className="h-2.5 w-28 rounded" />
            <ShimmerBlock className="mt-3 h-4 w-40 rounded" />
            <ShimmerBlock className="mt-2 h-2.5 w-full rounded" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * The placeholder for a figure whose SOURCE is not configured, as opposed to a
 * figure still loading.
 *
 * Deliberately a blurred bar and not blurred digits: frosting a plausible
 * number still puts a number on screen that nothing produced (§8 #3), and a
 * screenshot of it carries our name. And deliberately static, never
 * `animate-shimmer` — a skeleton promises that data is arriving, which is
 * false when no read was ever started. /token-sale had exactly that bug: two
 * tiles guarded on `status === "loading"`, which never resolves with no sale
 * address, shimmered forever.
 */
export function UnsetBar({ className = "h-5 w-24" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block select-none rounded bg-[#2a2a2a] align-middle blur-[3px] ${className}`}
    />
  );
}
