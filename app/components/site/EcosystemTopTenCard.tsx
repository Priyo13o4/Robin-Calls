"use client";

import React from "react";
import Link from "next/link";
import type { DirectoryPlatform } from "@/lib/types";
import { PlatformBanner } from "./PlatformBanner";
import { categoryDef } from "@/lib/config/ecosystem";
import { cdnUrl } from "@/lib/config/cdn";
import { SmartImage } from "./SmartImage";

interface EcosystemTopTenCardProps {
  platform: DirectoryPlatform;
  rank: number;
  onQuickView: (platform: DirectoryPlatform) => void;
}

export function EcosystemTopTenCard({
  platform,
  rank,
  onQuickView,
}: EcosystemTopTenCardProps) {
  return (
    <div className="group relative flex flex-none items-end pl-2 sm:pl-4 transition-transform duration-300 hover:scale-[1.02] snap-start">
      {/* Netflix giant rank number */}
      <div
        className="pointer-events-none -mr-6 sm:-mr-8 select-none z-10 font-cinzel font-black text-[90px] sm:text-[130px] leading-none tracking-tighter text-[#141414] drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)] transition-colors group-hover:text-[#ccff00]/20"
        style={{
          WebkitTextStroke: "2.5px #3d3d3d",
        }}
      >
        {rank}
      </div>

      {/* Card Body */}
      <div className="lime-marble-glass relative z-20 flex w-[230px] sm:w-[270px] flex-col overflow-hidden border border-[#2a2a2a] bg-[#141414] transition-all duration-300 group-hover:border-[#ccff00] group-hover:shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
        {/* Background card texture */}
        <SmartImage
          src={cdnUrl("/backgrounds/card-bg-secondary.webp")}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20 mix-blend-screen"
        />

        {/* Banner with click action */}
        <div className="relative z-10 cursor-pointer" onClick={() => onQuickView(platform)}>
          <PlatformBanner url={platform.url} className="h-32 sm:h-36" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent opacity-80" />

          {/* Quick badge */}
          <div className="absolute top-2 left-2 flex gap-1">
            <span className="border border-[#ccff00] bg-[#0a0a0a]/90 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#ccff00]">
              #{rank}
            </span>
            {platform.has_mcp && (
              <span className="border border-[#ccff00]/60 bg-[#0a0a0a]/90 px-1.5 py-0.5 font-mono text-[9px] text-[#ccff00]">
                MCP
              </span>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="relative z-10 flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-2">
            <h3
              onClick={() => onQuickView(platform)}
              className="font-cinzel text-base font-bold text-[#ededea] transition-colors group-hover:text-[#ccff00] cursor-pointer truncate"
            >
              {platform.name}
            </h3>
            <a
              href={platform.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Visit ${platform.name}`}
              className="text-[#8a8a8a] transition-colors hover:text-[#ccff00] p-0.5"
            >
              <svg className="w-3.5 h-3.5 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>

          <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-[#8a8a8a]">
            {platform.description ?? "Ecosystem platform building on Robinhood Chain."}
          </p>

          <div className="mt-3 flex items-center justify-between border-t border-[#2a2a2a]/60 pt-2.5">
            <span className="font-mono text-[9px] tracking-[0.14em] text-[#8a8a8a] uppercase truncate max-w-[80px]">
              {categoryDef(platform.category)?.label ?? platform.category}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onQuickView(platform)}
                className="font-mono text-[10px] text-[#8a8a8a] hover:text-[#ccff00] transition-colors cursor-pointer"
              >
                QUICK VIEW
              </button>
              <Link
                href={`/ecosystem/${platform.slug}`}
                className="font-mono text-[10px] text-[#ccff00] hover:underline flex items-center gap-1"
              >
                <span>DETAILS</span>
                <svg className="w-2.5 h-2.5 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
