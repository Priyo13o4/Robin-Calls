"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMarketDataForToken } from "./dexscreener-api";
import { readRwaTerminalMarket } from "./rwa-terminal-market";
import type { TokenMarketData } from "./types";
import { hasFreshTerminalQuote, mergeLiveMarketData } from "./terminal-market";

export type TerminalMarketFreshness = "initial" | "live" | "stale";

/**
 * Shared 25-second, visibility-aware terminal quote refresh. Market caches
 * share refills within one runtime and do not accept caller AbortSignal;
 * generation guards cancel obsolete results, while the in-flight latch avoids
 * overlapping polls for this terminal.
 */
export function useTerminalMarket(
  tokenAddress: string,
  initial: TokenMarketData,
  options: { enabled?: boolean; refreshMs?: number; poolSelection?: "activity" | "liquidity"; initialUpdatedAt?: number | null } = {},
) {
  const { enabled = true, refreshMs = 25_000, poolSelection = "activity", initialUpdatedAt = null } = options;
  const initialObservationAt = initialUpdatedAt !== null && Number.isFinite(initialUpdatedAt) && initialUpdatedAt <= Date.now()
    ? initialUpdatedAt : null;
  const [token, setToken] = useState(initial);
  const [freshness, setFreshness] = useState<TerminalMarketFreshness>(() => initialObservationAt === null
    ? "initial" : hasFreshTerminalQuote(initialObservationAt, Date.now(), refreshMs) ? "live" : "stale");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(initialObservationAt);
  const lastUpdatedAtRef = useRef<number | null>(initialObservationAt);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const latest = useRef(initial);
  latest.current = token;

  useEffect(() => {
    // A scan refresh replaces server props for the same token. It must not roll
    // a newer client quote back to the launch snapshot or reset its freshness.
    if (latest.current.address.toLowerCase() === initial.address.toLowerCase() && lastUpdatedAtRef.current !== null) return;
    setToken(initial);
    latest.current = initial;
    setFreshness(initialObservationAt === null ? "initial" : hasFreshTerminalQuote(initialObservationAt, Date.now(), refreshMs) ? "live" : "stale");
    setLastUpdatedAt(initialObservationAt);
    lastUpdatedAtRef.current = initialObservationAt;
  }, [initial, initialObservationAt, refreshMs]);

  const refresh = useCallback(async () => {
    const quoteStillFresh = hasFreshTerminalQuote(lastUpdatedAtRef.current, Date.now(), refreshMs);
    if (!quoteStillFresh) setFreshness((value) => value === "live" ? "stale" : value);
    if (!enabled || !tokenAddress || inFlight.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    // The RWA page supplies a full pool observation. Reuse it for the first
    // polling window instead of immediately fetching the same list again.
    if (poolSelection === "liquidity" && lastUpdatedAtRef.current !== null && Date.now() - lastUpdatedAtRef.current < refreshMs) return;
    const requestGeneration = generation.current;
    inFlight.current = true;
    try {
      const observation = poolSelection === "liquidity" ? await readRwaTerminalMarket(tokenAddress) : null;
      const updated = poolSelection === "liquidity" ? observation?.token : await getMarketDataForToken(tokenAddress);
      if (requestGeneration !== generation.current) return;
      const merged = updated ? mergeLiveMarketData(latest.current, updated) : null;
      if (!merged) {
        setFreshness("stale");
        return;
      }
      if (poolSelection === "liquidity" && updated) {
        // Missing fields in this pool observation must not inherit another
        // pool's conversion or activity while the quote is marked live.
        merged.priceEth = updated.priceEth;
        merged.priceQuote = updated.priceQuote;
        merged.volume24h = updated.volume24h;
      }
      latest.current = merged;
      setToken(merged);
      const updatedAt = observation?.observedAt ?? Date.now();
      setFreshness(hasFreshTerminalQuote(updatedAt, Date.now(), refreshMs) ? "live" : "stale");
      lastUpdatedAtRef.current = updatedAt;
      setLastUpdatedAt(updatedAt);
    } catch {
      if (requestGeneration === generation.current) {
        setFreshness("stale");
      }
    } finally {
      if (requestGeneration === generation.current) inFlight.current = false;
    }
  }, [enabled, refreshMs, tokenAddress, poolSelection]);

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      generation.current += 1;
      inFlight.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, refresh, refreshMs]);

  return { token, freshness, lastUpdatedAt, refresh };
}
