"use client";

import { useState } from "react";

/**
 * One clipboard implementation, shared by both chips in this file — and now by
 * the transcript's per-message copy button, which is why it is exported.
 *
 * Extracted rather than copied when the agent transcript needed an inline
 * variant: `navigator.clipboard` is unavailable on insecure origins and inside
 * some in-app browsers, so the `execCommand` fallback below is load-bearing —
 * and a second hand-rolled copy of it would be one more place to forget it
 * (CLAUDE.md §2).
 */
export function useCopy(value: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);

  const flash = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copy = () => {
    if (!value) return;
    navigator.clipboard
      .writeText(value)
      .then(flash)
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = value;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          flash();
        } catch {
          /* Clipboard genuinely unavailable — the address is still selectable. */
        }
        document.body.removeChild(ta);
      });
  };

  return { copied, copy };
}

/**
 * An address inside a sentence — the agent transcript's variant.
 *
 * Separate from the block chip below because it lives in running prose: it has
 * to sit on the text baseline, wrap with the paragraph, and carry no explorer
 * button, since a row of controls mid-sentence would read as a UI element
 * rather than as a word. Click the address itself to copy.
 *
 * Rendered from a REGEX over the model's text, so it is still the closed subset
 * this transcript allows: the model cannot emit a chip, it can only mention an
 * address, and we decide how an address looks.
 */
export function InlineAddressChip({ address }: { address: string }) {
  const { copied, copy } = useCopy(address);

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : `Copy ${address}`}
      aria-label={copied ? "Address copied" : `Copy address ${address}`}
      className="group relative mx-px inline-flex max-w-full items-center gap-1 break-all border border-[#2a2a2a] bg-[#111811] px-1 py-0.5 align-baseline font-mono text-[11px] text-[#c9f24a] transition-colors hover:border-[#ccff00] hover:bg-[#192211]"
    >
      <span className="break-all">{address}</span>
      {copied ? (
        <svg
          className="h-3 w-3 shrink-0 text-[#ccff00]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg
          className="h-3 w-3 shrink-0 text-[#6a6a6a] transition-colors group-hover:text-[#ccff00]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.75v-6.75a2.25 2.25 0 00-2.25-2.25H15"
          />
        </svg>
      )}
    </button>
  );
}

interface CopyAddressChipProps {
  address: string;
  label?: string;
  className?: string;
  /**
   * Truncated address and tighter controls, for cards too narrow to hold 42
   * mono characters (the landing RWA row). A separate component would have
   * been a second place to forget the `execCommand` fallback above and the
   * explorer host below, which is the fork §2 warns about.
   */
  compact?: boolean;
  /** A V4 pool id is not an address, so Blockscout has no page for it: pass where it does live. */
  explorerHref?: string;
  explorerTitle?: string;
}

export function CopyAddressChip({
  address,
  label,
  className = "",
  compact = false,
  explorerHref,
  explorerTitle,
}: CopyAddressChipProps) {
  const { copied, copy } = useCopy(address);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    copy();
  };

  const handleExplorer = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(
      explorerHref ?? `https://robinhoodchain.blockscout.com/address/${address}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`group relative flex items-center justify-between gap-2 rounded-sm border border-[#2a2a2a] bg-[#141414] font-mono text-[10px] text-[#ededea] transition-colors hover:border-[#3d3d3d] ${
        compact ? "px-2 py-1" : "px-3 py-2"
      } ${className}`}
    >
      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
        {label && (
          <span className="shrink-0 text-[#8a8a8a] uppercase font-bold tracking-wider">
            {label} ·
          </span>
        )}
        <span
          className={`font-mono text-[#ededea] select-all ${
            compact ? "truncate text-[10px]" : "break-all text-[10px]"
          }`}
          title={compact ? address : undefined}
        >
          {compact ? `${address.slice(0, 6)}…${address.slice(-4)}` : address}
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? "Copied!" : `Copy ${address}`}
          className={`relative shrink-0 flex items-center justify-center rounded-sm border border-[#2a2a2a] bg-[#1c1c1c] text-[#8a8a8a] transition-all hover:border-[#ccff00] hover:text-[#ccff00] hover:bg-[#192211] ${
            compact ? "w-5 h-5" : "w-6 h-6"
          }`}
        >
          {copied ? (
            <>
              <svg
                className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} text-[#ccff00]`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none rounded bg-[#ccff00] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#0a0a0a] shadow-md whitespace-nowrap z-20">
                COPIED!
              </span>
            </>
          ) : (
            <svg
              className={compact ? "w-3 h-3" : "w-3.5 h-3.5"}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.75v-6.75a2.25 2.25 0 00-2.25-2.25H15"
              />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={handleExplorer}
          title={explorerTitle ?? "View on Explorer"}
          className={`shrink-0 flex items-center justify-center rounded-sm border border-[#2a2a2a] bg-[#1c1c1c] text-[#8a8a8a] transition-all hover:border-[#ccff00] hover:text-[#ccff00] hover:bg-[#192211] ${
            compact ? "w-5 h-5" : "w-6 h-6"
          }`}
        >
          <svg
            className={compact ? "w-3 h-3" : "w-3.5 h-3.5"}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.75}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
