"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useCopy } from "../CopyAddressChip";

export function TokenAddressBox({ address, explorerHref }: { address: string; explorerHref: string }) {
  const { copied, copy } = useCopy(address);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#ccff00]/30 bg-[linear-gradient(135deg,rgba(204,255,0,0.10),rgba(204,255,0,0.02)_60%)] p-3 shadow-[inset_0_1px_0_rgba(204,255,0,0.15),0_0_40px_-18px_rgba(204,255,0,0.6)] sm:p-4">
      <p className="mb-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.24em] text-[#ccff00]/70">Contract address</p>
      <div className="flex items-center gap-2.5 sm:gap-3">
        <button
          type="button"
          onClick={copy}
          title={copied ? "Copied" : "Copy address"}
          className="min-w-0 flex-1 select-all break-all text-left font-mono text-[12.5px] font-bold leading-snug text-[#ccff00] min-[400px]:text-[13px] sm:text-[15px] lg:text-[13px] xl:text-[19px]"
        >
          {address}
        </button>
        <div className="flex flex-none gap-1.5">
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Address copied" : "Copy address"}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ccff00] text-[#0a0a0a] transition-transform hover:-translate-y-0.5"
          >
            {copied ? <Check className="size-4" strokeWidth={3} /> : <Copy className="size-4" />}
          </button>
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View on Blockscout"
            title="View on Blockscout"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#ccff00]/35 text-[#ccff00] transition-colors hover:bg-[#ccff00]/10"
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
