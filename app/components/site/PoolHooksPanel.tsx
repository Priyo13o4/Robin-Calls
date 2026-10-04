"use client";

import { useEffect, useState } from "react";
import { HookDetails } from "@/app/components/trade/HookDetails";
import { CopyAddressChip } from "@/app/components/site/CopyAddressChip";
import type { UniswapHookInfo } from "@/lib/hooks/types";

interface TokenHooksResponse {
  poolsLooked: boolean;
  looked: boolean;
  tokenHooks: { hook: string; pools: number }[];
  hooks: Record<string, UniswapHookInfo>;
}

/**
 * Hooks on this token's recorded V4 pools, with Uniswap's hook list entry for each. Reference
 * only: never a check, never scored. Renders nothing until there is something to say.
 */
export function PoolHooksPanel({ token }: { token: string }) {
  const [data, setData] = useState<TokenHooksResponse | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/hooks?token=${token.toLowerCase()}`, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<TokenHooksResponse>) : null))
      .then((j) => { if (live) setData(j); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [token]);

  if (!data || !data.poolsLooked || data.tokenHooks.length === 0) return null;

  return (
    <div className="mt-12 w-full">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="font-cinzel text-lg font-bold tracking-[0.2em] text-[#ededea]">POOL HOOKS</span>
        <span className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">
          CONTRACTS THAT RUN ON EVERY SWAP · FROM UNISWAP&apos;S HOOK LIST · NOT SCORED
        </span>
        <span className="h-px flex-1 bg-[#2a2a2a]" />
      </div>
      <div className="w-full space-y-3 border border-[#2a2a2a] bg-[#141414] p-4 text-sm text-[#d6d6d2]">
        <p className="text-[#8a8a8a]">
          This token trades in V4 pools that run a hook, a contract that executes on swaps. Here is what
          Uniswap&apos;s public hook list says about each one. It describes the hook, not this token.
        </p>
        {data.tokenHooks.map(({ hook, pools }) => (
          <div key={hook} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CopyAddressChip compact label="Hook" address={hook} />
              <span className="font-mono text-[11px] text-[#8a8a8a]">
                on {pools} recorded pool{pools === 1 ? "" : "s"}
              </span>
            </div>
            <HookDetails
              address={hook}
              preloaded={{ looked: data.looked, hook: data.hooks[hook] ?? null }}
              defaultOpen={data.tokenHooks.length === 1}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
