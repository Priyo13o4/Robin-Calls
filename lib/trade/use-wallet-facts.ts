"use client";

import { useEffect, useRef, useState } from "react";
import type { WalletFacts } from "./wallet-tags";

export const TAG_POLL_MS = 5_000;
/** Holdings move with every trade; tx counts and launch roles barely move. */
export const FACTS_STALE_MS = 60_000;
export const MAX_PER_CALL = 40;
/** An unread tx count is asked again this many times, then left untagged. */
export const MAX_TRIES = 3;

export interface FactsEntry { facts: WalletFacts; at: number; tries: number }

/** Never-asked wallets first, then unread counts, then the stalest holdings. Input is newest first. */
export function pickWalletsToAsk(wallets: readonly string[], known: ReadonlyMap<string, FactsEntry>, now: number): string[] {
  const fresh = wallets.filter((w) => !known.has(w));
  const retry = wallets.filter((w) => {
    const e = known.get(w);
    return e && e.facts.txCount === null && e.tries < MAX_TRIES && now - e.at >= TAG_POLL_MS;
  });
  const stale = wallets
    .filter((w) => { const e = known.get(w); return e && now - e.at >= FACTS_STALE_MS; })
    .sort((a, b) => known.get(a)!.at - known.get(b)!.at);
  return [...new Set([...fresh, ...retry, ...stale])].slice(0, MAX_PER_CALL);
}

/** A later null never erases an earlier reading: a failed poll is "not read", not "changed". */
export function mergeFacts(old: FactsEntry | undefined, next: WalletFacts, now: number): FactsEntry {
  const facts: WalletFacts = {
    txCount: next.txCount ?? old?.facts.txCount ?? null,
    heldShare: next.heldShare ?? old?.facts.heldShare ?? null,
    launch: next.launch ?? old?.facts.launch ?? null,
  };
  return { facts, at: now, tries: facts.txCount === null ? (old?.tries ?? 0) + 1 : 0 };
}

export function useWalletFacts(token: string, wallets: readonly string[], poolIds: readonly string[]): ReadonlyMap<string, FactsEntry> {
  const [known, setKnown] = useState<ReadonlyMap<string, FactsEntry>>(() => new Map());
  const walletsRef = useRef(wallets);
  const poolsRef = useRef(poolIds);
  const knownRef = useRef(known);
  useEffect(() => { walletsRef.current = wallets; poolsRef.current = poolIds; knownRef.current = known; });

  useEffect(() => {
    const ctrl = new AbortController();
    let busy = false;
    const poll = async () => {
      if (busy || document.hidden) return;
      const ask = pickWalletsToAsk(walletsRef.current, knownRef.current, Date.now());
      if (!ask.length) return;
      busy = true;
      try {
        const q = new URLSearchParams({ w: ask.join(","), pools: poolsRef.current.slice(0, 6).join(",") });
        const r = await fetch(`/api/trades/${token.toLowerCase()}/wallets?${q}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
        if (!r.ok) return; // rate limited or down: tags simply wait for the next poll
        const j = (await r.json()) as { wallets?: Record<string, WalletFacts> };
        const now = Date.now();
        setKnown((prev) => {
          const next = new Map(prev);
          for (const w of ask) {
            const f = j.wallets?.[w];
            next.set(w, mergeFacts(prev.get(w), f ?? { txCount: null, heldShare: null, launch: null }, now));
          }
          return next;
        });
      } catch {
        // Network fault or abort: nothing is recorded, so the same wallets are asked next time.
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), TAG_POLL_MS);
    return () => { ctrl.abort(); clearInterval(timer); };
  }, [token]);

  return known;
}
