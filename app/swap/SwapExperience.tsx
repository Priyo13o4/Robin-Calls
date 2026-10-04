"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { ModernTradingCard } from "@/app/components/trade/ModernTradingCard";
import { SwapFrame } from "@/app/components/trade/SwapFrame";
import { BASE_SWAP_TOKENS, type SelectableToken } from "@/lib/trade/types";
import { SwapMarketPanel } from "./components/SwapMarketPanel";
import { PopularRwas, PopularTokens } from "./components/MarketLists";
import styles from "./SwapAtmosphere.module.css";

const floatingTokens = [
  { symbol: "NVDA", image: "https://s3-symbol-logo.tradingview.com/nvidia--big.svg", left: "7%", top: "100px", size: 80, glow: "#74b67325", duration: "18s", delay: "-6s" },
  { symbol: "GIGACAT", image: "https://dd.dexscreener.com/ds-data/tokens/robinhood/0xc3ba8a6f8d011881ceca8ad6e2b524232a40aa26.png", left: "86%", top: "180px", size: 86, glow: "#d8ae6a2b", duration: "23s", delay: "-14s" },
  { symbol: "AAPL", image: "https://s3-symbol-logo.tradingview.com/apple--big.svg", left: "15%", top: "420px", size: 56, glow: "#aebdcc24", duration: "27s", delay: "-9s", desktopOnly: true },
  { symbol: "NOSH", image: "https://dd.dexscreener.com/ds-data/tokens/robinhood/0xabe99cf268cdc8bd70a71a5283fdacbcb36714fd.png", left: "92%", top: "650px", size: 62, glow: "#8c95d02a", duration: "20s", delay: "-3s", desktopOnly: true },
  { symbol: "SPY", image: "https://s3-symbol-logo.tradingview.com/spdr-sandp500-etf-tr--big.svg", left: "5%", top: "850px", size: 68, glow: "#98acd027", duration: "25s", delay: "-17s" },
  { symbol: "USELESS", image: "https://dd.dexscreener.com/ds-data/tokens/robinhood/0x8b1cacf3bfa11e0d438c7756cd5167216cbb46fd.png", left: "87%", top: "1030px", size: 74, glow: "#d5a57d27", duration: "29s", delay: "-11s" },
  { symbol: "TSLA", image: "https://s3-symbol-logo.tradingview.com/tesla--big.svg", left: "10%", top: "1390px", size: 58, glow: "#c68a8a24", duration: "22s", delay: "-8s", desktopOnly: true },
  { symbol: "GIGACAT", image: "https://dd.dexscreener.com/ds-data/tokens/robinhood/0xc3ba8a6f8d011881ceca8ad6e2b524232a40aa26.png", left: "92%", top: "1630px", size: 52, glow: "#d8ae6a22", duration: "31s", delay: "-19s", desktopOnly: true },
] as const;

/** Page composition for the existing trading card; trade state stays in its owner. */
export function SwapExperience() {
  const [chartOpen, setChartOpen] = useState(false);
  const [chartToken, setChartToken] = useState<SelectableToken>(BASE_SWAP_TOKENS[0]);
  const marketToken = chartToken.isNative
    ? { ...chartToken, address: BASE_SWAP_TOKENS.find((token) => token.symbol === "WETH")?.address ?? chartToken.address }
    : chartToken;
  const tradeHref = marketToken.address ? `/trade/${marketToken.address}` : "/trade";

  return (
    <div className="relative isolate min-h-[calc(100vh-4rem)] overflow-hidden bg-[#08090b]">
      <div aria-hidden="true" className={`${styles.field} -z-10`}>
        <div className="absolute inset-x-0 top-0 h-[680px] bg-[radial-gradient(ellipse_at_50%_12%,rgba(204,255,0,0.09),transparent_38%),radial-gradient(ellipse_at_13%_48%,rgba(67,91,172,0.12),transparent_30%),radial-gradient(ellipse_at_91%_36%,rgba(168,112,51,0.08),transparent_28%)]" />
        <div className="absolute -left-40 top-[19rem] size-[28rem] rounded-full bg-[#ccff00]/[0.045] blur-[130px]" />
        <div className="absolute -right-44 top-36 size-[34rem] rounded-full bg-[#4f6cff]/[0.075] blur-[150px]" />
        <div className="absolute bottom-0 left-1/2 h-[34rem] w-[72rem] -translate-x-1/2 rounded-[50%] border border-white/[0.025] bg-gradient-to-b from-white/[0.018] to-transparent" />
        <div className={styles.grain} />
        {floatingTokens.map((token, index) => (
          <div
            key={`${token.symbol}-${index}`}
            className={`${styles.blob} ${"desktopOnly" in token && token.desktopOnly ? styles.desktopOnly : ""}`}
            style={{
              left: token.left,
              top: token.top,
              "--size": `${token.size}px`,
              "--glow": token.glow,
              "--duration": token.duration,
              "--delay": token.delay,
            } as CSSProperties}
          >
            <span className={styles.avatar}>
              {token.symbol.slice(0, 2)}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={token.image}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-[13%] !h-[74%] !w-[74%] rounded-full"
                onError={(event) => { event.currentTarget.style.display = "none"; }}
              />
            </span>
          </div>
        ))}
      </div>

      <header className="mx-auto max-w-7xl px-5 pb-8 pt-14 text-center sm:px-8 sm:pt-20">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.035] px-3.5 py-1.5 text-xs font-semibold tracking-[0.2em] text-[#b4b8b2]">
          <span className="size-1.5 rounded-full bg-[#ccff00] shadow-[0_0_12px_#ccff00]" />
          ROBINHOOD CHAIN <span className="text-white/25">/</span> 4663
        </div>
        <h1 className="font-cinzel text-[34px] leading-[1.18] font-semibold tracking-[-0.04em] text-[#f0f1ed] sm:text-[55px]">
          Move at your own pace.<span className="sr-only"> — Robinhood Chain Native Token & RWA Swap</span>
        </h1>
        <p className="mx-auto mt-3 font-cinzel text-[19px] font-semibold tracking-[-0.02em] text-[#ccff00] sm:text-[24px]">
          With our added security.
        </p>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-[1.618] text-[#a2a6a0] sm:text-base">
          Swap into the assets shaping Robinhood Chain. Every trade is tested on chain from your wallet before you sign, and the token&apos;s security check sits right in the swap.{" "}
          <Link href="/methodology#swap-protections" className="whitespace-nowrap text-[#e8eae5] underline decoration-[#ccff00]/60 underline-offset-4 transition-colors hover:text-[#ccff00]">
            See what we check
          </Link>
        </p>
      </header>

      <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-8">
        <div className={`relative mx-auto ${chartOpen ? "max-w-[500px] lg:space-y-5 xl:grid xl:max-w-[1180px] xl:grid-cols-[minmax(0,500px)_minmax(0,1fr)] xl:items-start xl:gap-5 xl:space-y-0" : "max-w-[500px]"}`}>
          <div className="relative min-w-0">
          <div aria-hidden="true" className="pointer-events-none absolute -left-14 top-24 hidden h-16 w-16 items-center justify-center rounded-[22px] border border-white/10 bg-[#181b1c]/75 text-2xl font-semibold text-[#d5d9d3] shadow-[0_14px_50px_#0008] rotate-[-12deg] lg:flex">
            Ξ
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 top-52 hidden size-14 items-center justify-center rounded-full border border-white/10 bg-[#20221d]/75 text-lg font-bold text-[#ccff00] shadow-[0_14px_50px_#0008] rotate-[12deg] lg:flex">
            $R
          </div>
          <SwapFrame>
            <ModernTradingCard
              priceUsd={0}
              priceEth={0}
              livePrices
              onMarketTokenChange={setChartToken}
              chartAction={
                <>
                  <button
                    type="button"
                    onClick={() => setChartOpen((open) => !open)}
                    aria-label={chartOpen ? "Hide market chart" : "Show market chart"}
                    aria-expanded={chartOpen}
                    title={chartOpen ? "Hide market chart" : "Show market chart"}
                    className={`hidden lg:grid size-9 place-items-center rounded-full border transition-colors ${chartOpen ? "border-[#ccff00]/50 bg-[#ccff00]/10 text-[#ccff00]" : "border-white/[0.08] bg-[#171919] text-[#c5c9c3] hover:border-white/20 hover:text-[#ccff00]"}`}
                  >
                    <BarChart3 className="size-4" />
                  </button>
                  <Link
                    href={tradeHref}
                    aria-label={`Open ${chartToken.symbol || "token"} trade page`}
                    title="Open full trade page"
                    className="grid lg:hidden size-9 place-items-center rounded-full border border-white/[0.08] bg-[#171919] text-[#c5c9c3] hover:border-white/20 hover:text-[#ccff00]"
                  >
                    <BarChart3 className="size-4" />
                  </Link>
                </>
              }
            />
          </SwapFrame>
          <p className="mt-4 text-center text-xs leading-[1.618] text-[#8b918a]">
            Wallet-connected trading · Transactions settle on Robinhood Chain
          </p>
          </div>
          <SwapMarketPanel token={marketToken} open={chartOpen} onClose={() => setChartOpen(false)} />
        </div>

        <section className="mx-auto mt-24 max-w-6xl" aria-label="Popular assets">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.08] pb-5">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.22em] text-[#ccff00]">DISCOVER THE MARKET</p>
              <h2 className="font-cinzel text-[29px] leading-[1.25] font-semibold tracking-tight text-[#e8eae5]">Find your next move</h2>
            </div>
            <span className="text-[13px] text-[#8c938c]">Live market data</span>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
            <div id="popular-rwas" data-swap-list-slot="popular-rwas" className="min-w-0"><PopularRwas /></div>

            <div id="popular-chain-tokens" data-swap-list-slot="popular-chain-tokens" className="min-w-0"><PopularTokens /></div>
          </div>
        </section>
      </div>
    </div>
  );
}
