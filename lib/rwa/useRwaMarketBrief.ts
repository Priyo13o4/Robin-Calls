"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  getRwaMarketBrief,
  refreshRwaMarketBrief,
  type MarketBriefOptions,
  type RwaMarketBrief,
} from "@/lib/mcp/parallel-search-client";

export interface UseRwaMarketBriefResult {
  brief: RwaMarketBrief | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Load a keyless market brief; options scope the cache to the selected asset. */
export function useRwaMarketBrief(
  symbol: string,
  name: string,
  options: MarketBriefOptions = {}
): UseRwaMarketBriefResult {
  const [brief, setBrief] = useState<RwaMarketBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(0);

  const loadBrief = useCallback(async (force = false, signal?: AbortSignal) => {
    const sequence = ++active.current;
    if (!symbol.trim()) {
      setLoading(false);
      setBrief(null);
      return;
    }
    setLoading(true);
    setError(null);
    if (force) setBrief(null);
    try {
      const data = force
        ? await refreshRwaMarketBrief(symbol, name, options)
        : await getRwaMarketBrief(symbol, name, signal, options);
      if (active.current === sequence) setBrief(data);
    } catch (err: unknown) {
      if (active.current !== sequence || (err instanceof Error && err.name === "AbortError")) return;
      setError(err instanceof Error ? err.message : "Failed to load market brief");
    } finally {
      if (active.current === sequence) setLoading(false);
    }
  }, [symbol, name, options.kind, options.address, options.chainId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadBrief(false, controller.signal);
    return () => { controller.abort(); active.current += 1; };
  }, [loadBrief]);

  return { brief, loading, error, refresh: () => { void loadBrief(true); } };
}
