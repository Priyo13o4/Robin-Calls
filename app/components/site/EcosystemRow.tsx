"use client";

import React, { useRef, useState, useEffect } from "react";
import type { DirectoryPlatform } from "@/lib/types";
import { EcosystemCard } from "./EcosystemCard";
import { EcosystemTopTenCard } from "./EcosystemTopTenCard";

interface EcosystemRowProps {
  title: string;
  emoji?: string;
  platforms: DirectoryPlatform[];
  isTopTen?: boolean;
  onQuickView: (platform: DirectoryPlatform) => void;
}

export function EcosystemRow({
  title,
  emoji,
  platforms,
  isTopTen = false,
  onQuickView,
}: EcosystemRowProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [platforms]);

  const scroll = (direction: "left" | "right") => {
    if (!scrollContainerRef.current) return;
    const offset = direction === "left" ? -400 : 400;
    scrollContainerRef.current.scrollBy({ left: offset, behavior: "smooth" });
  };

  if (platforms.length === 0) return null;

  return (
    <div className="relative mb-12">
      {/* Row Header */}
      <div className="mb-4 flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <h2 className="font-cinzel text-xl sm:text-2xl font-bold tracking-tight text-[#ededea] flex items-center gap-2">
            {emoji && <span className="text-base sm:text-lg">{emoji}</span>}
            <span>{title}</span>
          </h2>
          <span className="border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-0.5 font-mono text-[10px] text-[#8a8a8a]">
            {platforms.length}
          </span>
        </div>

        {/* Scroll Navigation Chevrons */}
        <div className="hidden sm:flex items-center gap-2">
          <button
            type="button"
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            aria-label={`Scroll ${title} left`}
            className="flex h-8 w-8 items-center justify-center border border-[#2a2a2a] bg-[#1c1c1c] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] disabled:opacity-30 disabled:hover:border-[#2a2a2a] disabled:hover:text-[#8a8a8a] cursor-pointer"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scroll("right")}
            disabled={!canScrollRight}
            aria-label={`Scroll ${title} right`}
            className="flex h-8 w-8 items-center justify-center border border-[#2a2a2a] bg-[#1c1c1c] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] disabled:opacity-30 disabled:hover:border-[#2a2a2a] disabled:hover:text-[#8a8a8a] cursor-pointer"
          >
            ›
          </button>
        </div>
      </div>

      {/* Horizontal Carousel */}
      <div className="relative group/row overflow-hidden">
        {/* Left Shadow Mask */}
        {canScrollLeft && (
          <div
            onClick={() => scroll("left")}
            className="absolute left-0 top-0 bottom-4 z-10 w-12 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent cursor-pointer flex items-center justify-start pl-2 transition-opacity hover:opacity-100"
          >
            <span className="hidden sm:block text-2xl text-[#ccff00]">‹</span>
          </div>
        )}

        {/* Scroll Track */}
        <div
          ref={scrollContainerRef}
          onScroll={checkScroll}
          className="flex gap-4 sm:gap-6 overflow-x-auto pb-4 pt-1 px-1 scrollbar-none scroll-smooth snap-x snap-mandatory"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {platforms.map((platform, idx) =>
            isTopTen ? (
              <EcosystemTopTenCard
                key={platform.id}
                platform={platform}
                rank={idx + 1}
                onQuickView={onQuickView}
              />
            ) : (
              <EcosystemCard
                key={platform.id}
                platform={platform}
                onQuickView={onQuickView}
              />
            )
          )}
        </div>

        {/* Right Shadow Mask */}
        {canScrollRight && (
          <div
            onClick={() => scroll("right")}
            className="absolute right-0 top-0 bottom-4 z-10 w-12 bg-gradient-to-l from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent cursor-pointer flex items-center justify-end pr-2 transition-opacity hover:opacity-100"
          >
            <span className="hidden sm:block text-2xl text-[#ccff00]">›</span>
          </div>
        )}
      </div>
    </div>
  );
}
