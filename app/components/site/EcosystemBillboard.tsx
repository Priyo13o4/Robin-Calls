"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { DirectoryPlatform } from "@/lib/types";
import { categoryDef } from "@/lib/config/ecosystem";
import { PlatformBanner } from "./PlatformBanner";
import { cdnUrl } from "@/lib/config/cdn";
import { SmartImage } from "./SmartImage";

export interface BillboardSlide {
  id: string;
  name: string;
  slug: string;
  url: string;
  category: string;
  headline: string;
  badge: string;
}

const DEFAULT_FEATURED_SLIDES: BillboardSlide[] = [
  {
    id: "robinhood",
    name: "Robinhood",
    slug: "robinhood",
    url: "https://robinhood.com",
    category: "TRADING",
    badge: "CORE GATEWAY",
    headline: "The gateway to tokenized equities and crypto on Robinhood Chain.",
  },
  {
    id: "letscash",
    name: "letscash.fun",
    slug: "letscash",
    url: "https://www.letscash.fun",
    category: "LAUNCHPAD",
    badge: "COMMUNITY CHOICE",
    headline: "Fair-launch bonding-curve launchpad powering real cashflow and liquidity.",
  },
  {
    id: "pons",
    name: "Pons",
    slug: "pons",
    url: "https://ponsfamily.com/launchpad",
    category: "LAUNCHPAD",
    badge: "CUSTOM QUOTE ASSETS",
    headline: "Configurable launchpad and DEX bonding protocols with multi-quote assets.",
  },
  {
    id: "flap",
    name: "Flap",
    slug: "flap",
    url: "https://flap.sh",
    category: "LAUNCHPAD",
    badge: "PROGRAMMABLE LAUNCHES",
    headline: "Programmable token launchpad where creators configure their own buy/sell taxes.",
  },
  {
    id: "robin-fun",
    name: "robin.fun",
    slug: "robin-fun",
    url: "https://robinfun.live",
    category: "LAUNCHPAD",
    badge: "BURNED LP ON GRADUATION",
    headline: "Fair-launch bonding-curve launchpad — $4K to $44K graduation with 100% LP burned.",
  },
  {
    id: "uniswap",
    name: "Uniswap",
    slug: "uniswap",
    url: "https://uniswap.org/",
    category: "TRADING",
    badge: "DECENTRALIZED DEX",
    headline: "Premier decentralized exchange protocol and automated concentrated liquidity.",
  },
  {
    id: "paxos-usdg",
    name: "Paxos (USDG)",
    slug: "paxos-usdg",
    url: "https://globaldollar.com/",
    category: "PAYMENTS",
    badge: "GLOBAL DOLLAR STABLECOIN",
    headline: "Institutional-grade USDG stablecoin powering ecosystem liquidity and settlement.",
  },
];

const SLIDE_DURATION_MS = 6000;
const TICK_INTERVAL_MS = 50;

interface EcosystemBillboardProps {
  platforms: DirectoryPlatform[];
  onQuickView: (platform: DirectoryPlatform) => void;
  onExploreClick: () => void;
}

export function EcosystemBillboard({
  platforms,
  onQuickView,
  onExploreClick,
}: EcosystemBillboardProps) {
  // Map our 7 slides with live platform data from DB when available
  const slides = DEFAULT_FEATURED_SLIDES.map((def) => {
    const live = platforms.find(
      (p) =>
        p.slug === def.slug ||
        p.name.toLowerCase() === def.name.toLowerCase() ||
        p.url.replace(/\/$/, "") === def.url.replace(/\/$/, "")
    );
    return {
      ...def,
      livePlatform: live,
      name: live?.name ?? def.name,
      description: live?.description ?? def.headline,
      category: live?.category ?? def.category,
      has_mcp: live?.has_mcp ?? false,
      has_agent: live?.has_agent ?? false,
    };
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [progressMs, setProgressMs] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const activeSlide = slides[currentIndex];

  const nextSlide = () => {
    setProgressMs(0);
    setCurrentIndex((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setProgressMs(0);
    setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const selectSlide = (index: number) => {
    setProgressMs(0);
    setCurrentIndex(index);
  };

  // Smooth continuous progress timer
  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      setProgressMs((prev) => {
        const next = prev + TICK_INTERVAL_MS;
        if (next >= SLIDE_DURATION_MS) {
          setCurrentIndex((idx) => (idx + 1) % slides.length);
          return 0;
        }
        return next;
      });
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isPaused, slides.length]);

  const currentPercent = (progressMs / SLIDE_DURATION_MS) * 100;

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="relative mb-14 w-full overflow-hidden border border-[#2a2a2a] bg-[#141414] shadow-2xl transition-all"
      style={{
        boxShadow: "0 25px 60px rgba(0,0,0,0.85)",
      }}
    >
      {/* Background atmosphere */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <SmartImage
          src={cdnUrl("/backgrounds/card-bg.webp")}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-35 mix-blend-screen"
        />
        {/* Radial ambient glow */}
        <div
          className="absolute -right-10 -top-10 h-[500px] w-[500px] rounded-full opacity-25 blur-3xl transition-all duration-1000"
          style={{
            background:
              currentIndex % 2 === 0
                ? "radial-gradient(circle, #ccff00 0%, transparent 70%)"
                : "radial-gradient(circle, #00e5ff 0%, transparent 70%)",
          }}
        />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ededea 1px, transparent 1px), linear-gradient(to bottom, #ededea 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent opacity-95" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/80 to-transparent" />
      </div>

      {/* Main billboard 2-Column Grid */}
      <div className="relative z-10 grid grid-cols-1 gap-8 p-6 sm:p-10 lg:grid-cols-12 lg:items-center lg:p-14">
        {/* Left Column: Title, Synopsis, Badges, CTAs */}
        <div className="lg:col-span-7">
          {/* Top meta badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="border border-[#ccff00] bg-[#ccff00]/10 px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.16em] text-[#ccff00] flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#ccff00] animate-pulse" />
              SPOTLIGHT {currentIndex + 1}/7
            </span>
            <span className="border border-[#2a2a2a] bg-[#1c1c1c] px-2.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a]">
              {categoryDef(activeSlide.category)?.label ?? activeSlide.category}
            </span>
            <span className="border border-[#2a2a2a] bg-[#1c1c1c] px-2.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-[#ededea]/80">
              {activeSlide.badge}
            </span>
            {activeSlide.has_mcp && (
              <span className="border border-[#ccff00]/40 bg-[#ccff00]/5 px-2 py-0.5 font-mono text-[10px] text-[#ccff00]">
                MCP READY
              </span>
            )}
            {activeSlide.has_agent && (
              <span className="border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-0.5 font-mono text-[10px] text-[#8a8a8a]">
                AGENT API
              </span>
            )}
          </div>

          {/* Title and description with extended ease transition */}
          <div
            key={activeSlide.id}
            className="mt-6 max-w-2xl transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] animate-fadeIn"
            style={{
              animation: "billboardSlide 600ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
            }}
          >
            <h2 className="font-cinzel text-3xl font-black tracking-tight text-[#ededea] sm:text-5xl lg:text-6xl uppercase">
              {activeSlide.name}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[#8a8a8a] sm:text-base sm:leading-relaxed">
              {activeSlide.description}
            </p>
          </div>

          {/* Action Buttons: on Mobile, visit + quick view are side-by-side on the SAME LINE */}
          <div className="mt-8">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-4">
              <a
                href={activeSlide.url}
                target="_blank"
                rel="noopener noreferrer"
                className="brutalist-box brutalist-shadow-dark brutalist-pressable flex items-center justify-center gap-2 bg-[#ccff00] border-[#ccff00] px-4 py-3 sm:px-6 font-inter text-[11px] sm:text-xs font-bold uppercase tracking-[0.18em] text-[#0a0a0a] transition-transform hover:scale-[1.02] cursor-pointer"
              >
                <span>VISIT</span>
                <svg className="w-3 h-3 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>

              {activeSlide.livePlatform ? (
                <button
                  type="button"
                  onClick={() => activeSlide.livePlatform && onQuickView(activeSlide.livePlatform)}
                  className="brutalist-box brutalist-shadow-light brutalist-pressable flex items-center justify-center gap-2 border-[#2a2a2a] bg-[#1c1c1c] px-4 py-3 sm:px-6 font-inter text-[11px] sm:text-xs font-bold uppercase tracking-[0.18em] text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] cursor-pointer"
                >
                  <span>QUICK VIEW</span>
                </button>
              ) : (
                <Link
                  href={`/ecosystem/${activeSlide.slug}`}
                  className="brutalist-box brutalist-shadow-light brutalist-pressable flex items-center justify-center gap-2 border-[#2a2a2a] bg-[#1c1c1c] px-4 py-3 sm:px-6 font-inter text-[11px] sm:text-xs font-bold uppercase tracking-[0.18em] text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] cursor-pointer"
                >
                  <span>DETAILS</span>
                </Link>
              )}

              <button
                type="button"
                onClick={onExploreClick}
                className="hidden sm:inline-flex items-center gap-1.5 border border-transparent px-3 py-3 font-mono text-[11px] tracking-[0.16em] text-[#8a8a8a] hover:text-[#ededea] transition-colors cursor-pointer"
              >
                <span>EXPLORE ALL</span>
                <span>↓</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Visual Platform Banner Showcase */}
        <div className="lg:col-span-5 flex justify-center lg:justify-end">
          <div
            key={`banner-${activeSlide.id}`}
            onClick={() => activeSlide.livePlatform && onQuickView(activeSlide.livePlatform)}
            className="group/banner lime-marble-glass relative w-full max-w-md overflow-hidden border-2 border-[#2a2a2a] bg-[#1c1c1c] shadow-2xl transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[#ccff00] hover:scale-[1.02] cursor-pointer"
            style={{
              boxShadow: "0 15px 35px rgba(0,0,0,0.75)",
              animation: "billboardSlide 600ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
            }}
          >
            <div className="relative z-10 h-48 sm:h-56 w-full overflow-hidden bg-[#141414]">
              <PlatformBanner
                url={activeSlide.url}
                className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/banner:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent opacity-80" />
            </div>

            <div className="relative z-10 p-4 border-t border-[#2a2a2a] bg-[#141414] flex items-center justify-between">
              <div>
                <span className="font-mono text-[10px] uppercase text-[#8a8a8a] tracking-wider block">
                  {categoryDef(activeSlide.category)?.label ?? activeSlide.category}
                </span>
                <span className="font-cinzel text-sm font-bold text-[#ededea] group-hover/banner:text-[#ccff00] transition-colors">
                  {activeSlide.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 border border-[#2a2a2a] bg-[#1c1c1c] px-2.5 py-1 font-mono text-[10px] text-[#ccff00] group-hover/banner:border-[#ccff00] transition-colors">
                <span>PREVIEW</span>
                <svg className="w-3 h-3 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive 7-Slide Animated Progress Bars & Controls */}
      <div className="relative z-10 border-t border-[#2a2a2a]/60 bg-[#101010] px-6 py-4 sm:px-10 lg:px-14 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2 sm:max-w-xl">
          {slides.map((s, idx) => {
            const isCurrent = idx === currentIndex;
            const isCompleted = idx < currentIndex;
            const fillWidth = isCompleted ? 100 : isCurrent ? currentPercent : 0;

            return (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSlide(idx)}
                aria-label={`Jump to ${s.name}`}
                className="group relative h-7 flex-1 flex flex-col justify-center focus:outline-none cursor-pointer"
              >
                <div className="hidden group-hover:block absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-30 whitespace-nowrap border border-[#2a2a2a] bg-[#0a0a0a] px-2 py-1 font-mono text-[9px] text-[#ededea] shadow-lg pointer-events-none">
                  {s.name}
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#242424] transition-colors group-hover:bg-[#333]">
                  <div
                    className={`h-full transition-all ${
                      isCurrent
                        ? "bg-[#ccff00] shadow-[0_0_10px_#ccff00]"
                        : isCompleted
                        ? "bg-[#8a8a8a] group-hover:bg-[#ccff00]/70"
                        : "bg-transparent"
                    }`}
                    style={{
                      width: `${fillWidth}%`,
                      transition: isCurrent ? "width 50ms linear" : "none",
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          {isPaused && (
            <span className="font-mono text-[10px] tracking-widest text-[#ccff00] uppercase animate-pulse">
              PAUSED
            </span>
          )}
          <span className="font-mono text-xs text-[#8a8a8a]">
            <strong className="text-[#ededea]">0{currentIndex + 1}</strong> / 0{slides.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={prevSlide}
              aria-label="Previous slide"
              className="flex h-8 w-8 items-center justify-center border border-[#2a2a2a] bg-[#1c1c1c] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] cursor-pointer"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={nextSlide}
              aria-label="Next slide"
              className="flex h-8 w-8 items-center justify-center border border-[#2a2a2a] bg-[#1c1c1c] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] cursor-pointer"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
