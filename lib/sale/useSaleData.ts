"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAddress, type Address, type Chain } from "viem";
import {
  fetchSaleViewLive,
  makeSaleClient,
  type SaleSnapshot,
  type SaleView,
} from "./reads";

/**
 * The client read loop for every TokenSale surface. The reads themselves, the
 * per-field `faults` semantics, and the fault-vs-unknown rule live in
 * `lib/sale/reads.ts` (shared with the server snapshot path) — this file owns
 * only the polling.
 *
 * `snapshot` is the server's one multicall, already rendered: the hook starts
 * showing it (`live: false`) and its own first multicall takes over on landing.
 * Whenever the displayed data is not from a client read that just succeeded,
 * `live` is false and `asOf` says when it was — a stale number must never wear
 * a live number's clothes (§4).
 */
export function useSaleData(opts: {
  chain: Chain;
  contract: string;
  walletAddress: string | null;
  snapshot?: SaleSnapshot | null;
  pollMs?: number;
}) {
  const { chain, contract, walletAddress, snapshot, pollMs } = opts;

  /**
   * THREE states, not two. `live: false` used to mean both "no client read has
   * finished yet" and "a client read failed", so the page published "couldn't
   * reach the chain" on its own first paint — before it had tried once. That is
   * §4 at the presentation layer: not-yet is not a failure, and only a read that
   * actually ran and threw earns that sentence.
   */
  const [status, setStatus] = useState<"loading" | "live" | "stale">("loading");
  const [data, setData] = useState<{
    view: SaleView;
    live: boolean;
    takenAt: number;
    blockNumber: bigint | null;
  } | null>(snapshot ? { view: snapshot.view, live: false, takenAt: snapshot.takenAt, blockNumber: snapshot.blockNumber } : null);
  const [refreshing, setRefreshing] = useState(false);
  const client = useMemo(() => makeSaleClient(chain), [chain]);
  const addr: Address | null = isAddress(contract) ? (contract.toLowerCase() as Address) : null;

  /**
   * In-flight guard: one multicall is one network event, but a slow RPC would
   * otherwise stack ticks into a read storm (§5 single-flight). A skipped tick
   * loses nothing — the next one reads fresher state anyway.
   *
   * A count, not a boolean, because a FORCED read is allowed to run alongside a
   * background tick (below) and the two must not clear each other's flag.
   */
  const inFlight = useRef(0);

  /** Only the most recently STARTED read may write. Concurrency is possible now
   *  that force bypasses the guard, and without this an older read finishing
   *  later would overwrite fresher data with staler data. */
  const seq = useRef(0);

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (!addr) {
      setData(null);
      // No address to read is a configuration fact, not a failed read.
      setStatus("loading");
      return;
    }
    // §5: a background tick SKIPS when one is already running, but a forced
    // read never joins it. The user pressing Retry during a slow read was
    // dropped silently, so the button did nothing at exactly the moment the
    // RPC was slowest, which is the moment it gets pressed.
    if (inFlight.current > 0 && !opts?.force) return;

    const mine = ++seq.current;
    inFlight.current += 1;
    setRefreshing(true);
    try {
      const view = await fetchSaleViewLive(client, addr, walletAddress ? (walletAddress as Address) : null);
      if (seq.current !== mine) return;
      setData({ view, live: true, takenAt: Date.now(), blockNumber: null });
      setStatus("live");
    } catch {
      // Never reached the chain: keep showing whatever we have, flagged
      // non-live so the caller labels it, and retry next tick. `stale` is set
      // HERE and only here — it is the one place we know a read really ran.
      if (seq.current !== mine) return;
      setData((prev) => (prev ? { ...prev, live: false } : prev));
      setStatus("stale");
    } finally {
      inFlight.current = Math.max(0, inFlight.current - 1);
      if (inFlight.current === 0) setRefreshing(false);
    }
  }, [addr, client, walletAddress]);

  const st = data?.view?.state;
  const effectivePollMs = useMemo(() => {
    if (pollMs !== undefined) return pollMs;
    if (st === 1) return 15_000; // Active
    if (st === 3 || st === 4) return 60_000; // Closed / Abandoned
    if (st === 0 || st === 2) return 30_000; // Pending / Paused
    return 15_000;
  }, [pollMs, st]);

  // A wallet change must never show the previous wallet's position, and its
  // read must not be swallowed by a poll already in flight for the old one.
  const lastWallet = useRef(walletAddress);
  useEffect(() => {
    if (lastWallet.current === walletAddress) return;
    lastWallet.current = walletAddress;
    setData((prev) => (prev ? { ...prev, view: { ...prev.view, mine: undefined } } : prev));
    void refresh({ force: true });
  }, [walletAddress, refresh]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      // A hidden tab has nobody reading the numbers; polling it forever burns
      // the public RPC's rate limit for nobody.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh();
    }, effectivePollMs);
    return () => clearInterval(t);
  }, [refresh, effectivePollMs]);

  return {
    sale: data?.view ?? null,
    live: data?.live ?? false,
    /**
     * "loading" until the first client read settles. Gate any "we couldn't
     * reach the chain" copy on `stale`, never on `!live` — the latter is true
     * during the ordinary first paint.
     */
    status,
    /** No read has settled yet, so nothing on screen is confirmed. */
    loading: status === "loading",
    /** When the displayed data was read, for the stale label. */
    asOf: data ? { takenAt: data.takenAt, blockNumber: data.blockNumber } : null,
    refresh,
    refreshing,
    client,
  };
}
