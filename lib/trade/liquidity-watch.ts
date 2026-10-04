"use client";

import { useSyncExternalStore } from "react";

/**
 * What the trade page's live feed has seen happen to this token's MAIN pool's liquidity, shared
 * with the swap card and the right rail. Written only by trade-feed.ts. Main = the pair the page
 * shows (DexScreener's primary), so a decoy or dust pool can never raise the warning.
 */
export interface MainPoolRemoval {
  poolId: string;
  /** Null: the pool reads empty but the removal is older than the one lookback search can reach. */
  txHash: string | null;
  block: number | null;
  atMs: number | null;
  /** Share of the pool's liquidity this removal took, read against the pool now. Null: not read. */
  share: number | null;
  /** True when the pool reads empty now; the listed liquidity and FDV are then stale. */
  emptied: boolean;
  /** Newest swap on the main pool before the removal, if the feed saw one. */
  lastTradeBeforeMs: number | null;
}

export interface LiquidityWatch {
  mainPoolId: string | null;
  removal: MainPoolRemoval | null;
}

/** A removal below this share is an LP adjusting a position, not a pull. */
export const WARN_SHARE = 0.5;

const EMPTY: LiquidityWatch = { mainPoolId: null, removal: null };
const states = new Map<string, LiquidityWatch>();
const listeners = new Map<string, Set<() => void>>();

export function publishLiquidity(token: string, next: LiquidityWatch): void {
  const t = token.toLowerCase();
  states.set(t, next);
  for (const fn of listeners.get(t) ?? []) fn();
}

export function readLiquidity(token: string): LiquidityWatch {
  return states.get(token.toLowerCase()) ?? EMPTY;
}

/** The removal worth warning about, or null. Only the main pool, only a real share of it. */
export function warnableRemoval(w: LiquidityWatch): MainPoolRemoval | null {
  const r = w.removal;
  if (!r || r.poolId !== w.mainPoolId) return null;
  return r.emptied || (r.share !== null && r.share >= WARN_SHARE) ? r : null;
}

export function useLiquidityWatch(token: string | null | undefined): LiquidityWatch {
  const t = (token ?? "").toLowerCase();
  return useSyncExternalStore(
    (fn) => {
      const set = listeners.get(t) ?? new Set();
      set.add(fn);
      listeners.set(t, set);
      return () => { set.delete(fn); };
    },
    () => states.get(t) ?? EMPTY,
    () => EMPTY,
  );
}

/** "08:08 UTC" today, "Sep 22, 08:08 UTC" otherwise; "an unknown time" when the removal was never seen. */
export function utcClock(ms: number | null): string {
  if (ms === null) return "an unknown time";
  const iso = new Date(ms).toISOString();
  const sameDay = iso.slice(0, 10) === new Date().toISOString().slice(0, 10);
  if (sameDay) return `${iso.slice(11, 16)} UTC`;
  const day = new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${day}, ${iso.slice(11, 16)} UTC`;
}
