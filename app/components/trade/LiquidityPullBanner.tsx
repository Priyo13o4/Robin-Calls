"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useLiquidityWatch, utcClock, warnableRemoval } from "@/lib/trade/liquidity-watch";
import { prePullWalletWarning } from "@/lib/launches/liquidity-pulled";
import { LP_CUSTODY_POLL_MS, type LpCustodyLiveResult } from "@/lib/trade/lp-custody-shared";
import { explorerWebUrl } from "@/lib/config/chain";

/** Main pool only. The pull warning is historical feed evidence; the custody warning needs a complete live read. */
export function LiquidityPullBanner({ token, symbol }: { token: string; symbol: string }) {
  const watch = useLiquidityWatch(token);
  const r = warnableRemoval(watch);
  const [custody, setCustody] = useState<LpCustodyLiveResult | null>(null);
  useEffect(() => {
    if (!watch.mainPoolId || !token) {
      setCustody(null);
      return;
    }
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let polls = 0;
    setCustody(null);
    const query = new URLSearchParams({ pool: watch.mainPoolId });
    const load = async () => {
      try {
        const response = await fetch(`/api/trades/${encodeURIComponent(token)}/lp-custody?${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("LP custody read failed");
        const result = await response.json() as LpCustodyLiveResult;
        if (controller.signal.aborted) return;
        setCustody(result);
        if (result.status === "checking" && polls++ < 12) pollTimer = setTimeout(() => void load(), LP_CUSTODY_POLL_MS);
      } catch {
        if (!controller.signal.aborted) setCustody(null);
      }
    };
    void load();
    return () => { controller.abort(); if (pollTimer) clearTimeout(pollTimer); };
  }, [token, watch.mainPoolId]);

  const prePullWarning = prePullWalletWarning(custody);
  if (!r && !prePullWarning) return null;
  const pct = r?.share !== null && r?.share !== undefined ? Math.round(r.share * 100) : null;
  return (
    <div role="alert" className="shrink-0 flex items-start gap-2.5 rounded-xl border border-[#5a2019] bg-[#1c0c0a] px-3 py-2.5 text-phi-xs text-[#f5c2b8]">
      <AlertTriangle className="mt-0.5 size-4 flex-none text-[#ff6b57]" />
      <div className="min-w-0 flex-1 leading-5">
        {prePullWarning && (
          <p><span className="font-bold text-[#ff8a78]">One wallet holds most of {symbol}&apos;s active pool liquidity.</span>{" "}{prePullWarning}</p>
        )}
        {r && (
          <p className={prePullWarning ? "mt-1" : undefined}>
            <span className="font-bold text-[#ff8a78]">Liquidity may have been removed from {symbol}&apos;s main pool.</span>{" "}
            {r.atMs === null
              ? "The pool reads empty now. The removal happened more than 11 days ago."
              : r.emptied
                ? `The pool reads empty now, after a removal at ${utcClock(r.atMs)}.`
                : `A removal at ${utcClock(r.atMs)} took about ${pct}% of it.`}{" "}
            Prices and liquidity listed elsewhere may be out of date. Selling may no longer be possible through this pool.
          </p>
        )}
      </div>
      {r?.txHash && <a
        href={`${explorerWebUrl}/tx/${r.txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-none inline-flex items-center gap-1 text-phi-2xs underline underline-offset-2 hover:text-white"
      >
        Transaction <ExternalLink className="size-3" />
      </a>}
    </div>
  );
}
