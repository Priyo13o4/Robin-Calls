"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import type { DirectoryPlatform } from "@/lib/types";
import { PlatformBanner } from "./PlatformBanner";
import { categoryDef } from "@/lib/config/ecosystem";

interface EcosystemQuickViewModalProps {
  platform: DirectoryPlatform | null;
  onClose: () => void;
}

export function EcosystemQuickViewModal({
  platform,
  onClose,
}: EcosystemQuickViewModalProps) {
  useEffect(() => {
    if (!platform) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [platform, onClose]);

  if (!platform) return null;

  const details = platform.category_details ?? {};
  const detailEntries = Object.entries(details).filter(
    ([k, v]) => v !== null && v !== undefined && v !== "" && k !== "has_mcp" && k !== "has_agent"
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-[#0a0a0a]/85 backdrop-blur-md transition-opacity"
      />

      {/* Modal Dialog */}
      <div
        className="relative z-10 w-full max-w-2xl overflow-hidden border border-[#2a2a2a] bg-[#141414] shadow-2xl transition-all"
        style={{
          boxShadow: "0 25px 60px rgba(0,0,0,0.9)",
        }}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-3 top-3 z-30 flex h-8 w-8 items-center justify-center border border-[#2a2a2a] bg-[#0a0a0a]/80 text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] cursor-pointer"
        >
          ✕
        </button>

        {/* Hero Banner Header */}
        <div className="relative h-44 sm:h-52 w-full overflow-hidden bg-[#1c1c1c]">
          <PlatformBanner url={platform.url} className="h-full w-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/50 to-transparent" />

          {/* Title & Badges Overlay */}
          <div className="absolute bottom-4 left-6 right-6">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="border border-[#ccff00] bg-[#0a0a0a]/90 px-2 py-0.5 font-mono text-[10px] font-bold text-[#ccff00]">
                {categoryDef(platform.category)?.label ?? platform.category}
              </span>
              {platform.has_mcp && (
                <span className="border border-[#ccff00]/60 bg-[#0a0a0a]/90 px-2 py-0.5 font-mono text-[10px] text-[#ccff00]">
                  MCP SERVER
                </span>
              )}
              {platform.has_agent && (
                <span className="border border-[#2a2a2a] bg-[#0a0a0a]/90 px-2 py-0.5 font-mono text-[10px] text-[#8a8a8a]">
                  AGENT API
                </span>
              )}
            </div>
            <h3 className="font-cinzel text-2xl sm:text-3xl font-bold text-[#ededea]">
              {platform.name}
            </h3>
          </div>
        </div>

        {/* Modal Body */}
        <div className="max-h-[60vh] overflow-y-auto p-6 space-y-6">
          {/* Description */}
          <div>
            <h4 className="font-mono text-[10px] tracking-[0.18em] text-[#8a8a8a] uppercase mb-2">
              OVERVIEW
            </h4>
            <p className="text-sm leading-relaxed text-[#ededea]/90">
              {platform.description ?? "Reviewed and indexed platform on Robinhood Chain."}
            </p>
          </div>

          {/* Category Specs Details */}
          {detailEntries.length > 0 && (
            <div>
              <h4 className="font-mono text-[10px] tracking-[0.18em] text-[#8a8a8a] uppercase mb-3">
                PLATFORM SPECIFICATIONS
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {detailEntries.map(([key, val]) => (
                  <div
                    key={key}
                    className="border border-[#2a2a2a] bg-[#1c1c1c] p-3 text-xs"
                  >
                    <span className="font-mono text-[10px] text-[#8a8a8a] block uppercase tracking-wider mb-1">
                      {key.replace(/_/g, " ")}
                    </span>
                    <span className="text-[#ededea] font-medium break-words">
                      {Array.isArray(val) ? val.join(", ") : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Direct Actions */}
          <div className="flex flex-wrap items-center gap-3 border-t border-[#2a2a2a] pt-5">
            <a
              href={platform.url}
              target="_blank"
              rel="noopener noreferrer"
              className="brutalist-box brutalist-shadow-dark brutalist-pressable flex-1 text-center bg-[#ccff00] border-[#ccff00] py-3 font-inter text-xs font-bold uppercase tracking-[0.18em] text-[#0a0a0a] transition-transform hover:scale-[1.02] flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>VISIT PLATFORM</span>
              <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <Link
              href={`/ecosystem/${platform.slug}`}
              onClick={onClose}
              className="brutalist-box brutalist-shadow-light brutalist-pressable flex-1 text-center border-[#2a2a2a] bg-[#1c1c1c] py-3 font-inter text-xs font-bold uppercase tracking-[0.18em] text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>VIEW DETAILS</span>
              <svg className="w-3.5 h-3.5 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
