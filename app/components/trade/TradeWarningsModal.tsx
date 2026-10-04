"use client";

import { useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import type { HookWarningItem } from "@/lib/swap/hook-runtime";
import { CopyAddressChip } from "@/app/components/site/CopyAddressChip";
import { HookDetails } from "./HookDetails";

/**
 * One place for pre-trade warnings (operator, L213 #20): shown once per token, in red, with a
 * per-token "don't show again". Critical findings cannot be remembered away.
 */
export function TradeWarningsModal({
  tokenSymbol,
  hooks,
  scannerLines,
  critical,
  onCancel,
  onConfirm,
}: {
  tokenSymbol: string;
  hooks: HookWarningItem[];
  scannerLines: string[];
  critical: boolean;
  onCancel: () => void;
  onConfirm: (remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Trade warnings">
      <div className="w-full max-w-[420px] space-y-3 rounded-2xl border border-[#ff5c5c]/50 bg-[#1a0b0b] p-4 text-sm leading-6 text-[#ffd6d6] shadow-[0_24px_80px_rgba(0,0,0,0.7)]">
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-2 font-semibold text-[#ff8a8a]">
            <ShieldAlert className="size-4 flex-none" />
            Before you trade {tokenSymbol}
          </p>
          <button type="button" onClick={onCancel} aria-label="Close" className="rounded p-1 text-[#ffb3b3] hover:bg-white/10">
            <X className="size-4" />
          </button>
        </div>
        {hooks.length > 0 && (
          <div className="space-y-1.5">
            <p>This pool runs a custom hook, a contract that executes on every swap. Our test run passed, but a hook can behave differently later.</p>
            {hooks.map((hook) => (
              <div key={hook.address} className="space-y-1.5 text-xs leading-5 text-[#ffc2c2]">
                <p>
                  It can act {hook.permissions.length ? hook.permissions.join(", ") : "with no decoded callbacks"}.
                  {hook.dynamicFee ? " Its fee can change per swap." : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <CopyAddressChip compact label="Hook" address={hook.address} />
                  {hook.pool && (
                    <CopyAddressChip compact label="Pool" address={hook.pool}
                      explorerHref={`https://www.geckoterminal.com/robinhood/pools/${hook.pool}`} explorerTitle="View pool on GeckoTerminal" />
                  )}
                </div>
                <HookDetails address={hook.address} />
              </div>
            ))}
          </div>
        )}
        {scannerLines.map((line) => <p key={line}>{line}</p>)}
        {critical ? (
          <p className="text-xs leading-5 text-[#ffb3b3]">A critical finding shows every time.</p>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[#ffc2c2]">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 cursor-pointer accent-[#ff5c5c]" />
            Don&apos;t show again for this token
          </label>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel} className="flex-1 rounded-full border border-white/15 py-2.5 text-sm font-semibold text-[#e5e5e5] hover:bg-white/5">
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(remember && !critical)} className="flex-1 rounded-full bg-[#ff5c5c] py-2.5 text-sm font-semibold text-[#0a0b0b] hover:bg-[#ff4040]">
            I understand, continue
          </button>
        </div>
      </div>
    </div>
  );
}
