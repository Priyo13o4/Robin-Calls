"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Check, ChevronDown } from "lucide-react";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_TESTNET_CHAIN_ID,
  activeSaleChainId,
  subscribeSaleChainId,
} from "@/lib/config/chain";

export interface ChainSelectorProps {
  collapsed?: boolean;
  className?: string;
}

interface ChainOption {
  id: string;
  name: string;
  disabled: boolean;
  chainId?: number;
}

const CHAIN_SELECTOR_ENABLED = process.env.NEXT_PUBLIC_ENABLE_CHAIN_SELECTOR === "true";

export function ChainSelector({ collapsed = false, className = "" }: ChainSelectorProps) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeChainId = useSyncExternalStore(subscribeSaleChainId, activeSaleChainId, () => ROBINHOOD_CHAIN_ID);
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const isTestnet = activeChainId === ROBINHOOD_TESTNET_CHAIN_ID;
  const currentNetworkLabel = isTestnet ? "Robinhood Testnet" : "Robinhood";

  const chainOptions: ChainOption[] = [
    {
      id: "robinhood",
      name: currentNetworkLabel,
      chainId: activeChainId,
      disabled: false,
    },
    {
      id: "coming-soon",
      name: "Coming Soon",
      disabled: true,
    },
  ];

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const isRobinhood = !mounted || !isConnected || chainId === activeChainId;
  const isWrongChain = mounted && isConnected && chainId !== activeChainId;

  async function handleSelectChain(chain: ChainOption) {
    if (chain.disabled || !chain.chainId) return;

    if (isConnected && chainId !== chain.chainId) {
      try {
        setIsSwitching(true);
        await switchChainAsync({ chainId: chain.chainId });
      } catch {
        // User rejected or wallet error
      } finally {
        setIsSwitching(false);
      }
    }
    setIsOpen(false);
  }

  // When chain switcher is latent/deactivated (default), render classic brutalist status button
  if (!CHAIN_SELECTOR_ENABLED) {
    if (collapsed) {
      return (
        <div className={`relative flex justify-center ${className}`}>
          <button
            type="button"
            onClick={
              isWrongChain
                ? () => void switchChainAsync({ chainId: activeChainId }).catch(() => {})
                : undefined
            }
            title={
              isWrongChain
                ? "Wrong Network — Click to Switch to Robinhood"
                : `Network: ${currentNetworkLabel} (4663)`
            }
            className={`brutalist-box brutalist-shadow-dark halftone-dark group relative flex h-[42px] w-full items-center justify-center border transition-colors ${
              isWrongChain
                ? "cursor-pointer bg-[#261414] border-[#e0897a] text-[#e0897a] hover:bg-[#331818]"
                : "cursor-default bg-[#0a0a0a] border-[#ededea] text-[#ededea]"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-sm.webp"
              alt="Robinhood"
              className="size-4 object-contain rounded-[2px]"
            />
            <span
              className={`absolute bottom-1 right-1.5 size-1.5 rounded-full ${
                isWrongChain ? "bg-[#e0897a]" : "bg-[#ccff00] animate-pulse"
              }`}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 -translate-x-1 whitespace-nowrap border border-[#2a2a2a] bg-[#1c1c1c] px-2.5 py-1.5 font-inter text-[10px] font-bold uppercase tracking-[0.16em] text-[#ededea] opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
            >
              {isWrongChain ? "Switch to Robinhood" : `${currentNetworkLabel} (4663)`}
            </span>
          </button>
        </div>
      );
    }

    return (
      <div className={`relative inline-block w-full text-left ${className}`}>
        <button
          type="button"
          onClick={
            isWrongChain
              ? () => void switchChainAsync({ chainId: activeChainId }).catch(() => {})
              : undefined
          }
          title={
            isWrongChain
              ? "Wrong Network — Click to Switch to Robinhood"
              : `Network: ${currentNetworkLabel} (4663)`
          }
          className={`brutalist-box brutalist-shadow-dark halftone-dark group relative flex w-full items-center justify-between border font-inter text-[10px] font-bold uppercase tracking-[0.18em] transition-colors gap-2 px-3 py-2.5 ${
            isWrongChain
              ? "cursor-pointer bg-[#261414] border-[#e0897a] text-[#e0897a] hover:bg-[#331818]"
              : "cursor-default bg-[#0a0a0a] border-[#ededea] text-[#ededea]"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-sm.webp"
              alt="Robinhood"
              className="size-4 object-contain rounded-[2px] flex-none"
            />
            <span className="truncate">
              {isWrongChain ? "Switch to Robinhood" : currentNetworkLabel}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-none">
            <span
              className={`size-2 rounded-full ${
                isWrongChain ? "bg-[#e0897a]" : "bg-[#ccff00] animate-pulse"
              }`}
            />
            <span className="font-mono text-[9px] text-[#888] font-normal lowercase tracking-normal">
              4663
            </span>
          </div>
        </button>
      </div>
    );
  }

  // Collapsed View (64px Rail in AppSidebar) with dropdown enabled
  if (collapsed) {
    return (
      <div ref={containerRef} className={`relative flex justify-center ${className}`}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          title={isWrongChain ? "Wrong Network — Click to Switch" : `Network: ${currentNetworkLabel}`}
          className={`brutalist-box brutalist-shadow-dark brutalist-pressable halftone-dark group relative flex h-[42px] w-full cursor-pointer items-center justify-center border transition-colors ${
            isWrongChain
              ? "bg-[#261414] border-[#e0897a] text-[#e0897a] hover:bg-[#331818]"
              : "bg-[#0a0a0a] border-[#ededea] text-[#ededea] hover:border-[#ccff00] hover:text-[#ccff00]"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-sm.webp"
            alt="Robinhood"
            className="size-4 object-contain rounded-[2px]"
          />
          <span
            className={`absolute bottom-1 right-1.5 size-1.5 rounded-full ${
              isWrongChain ? "bg-[#e0897a]" : "bg-[#ccff00] animate-pulse"
            }`}
          />

          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 -translate-x-1 whitespace-nowrap border border-[#2a2a2a] bg-[#1c1c1c] px-2.5 py-1.5 font-inter text-[10px] font-bold uppercase tracking-[0.16em] text-[#ededea] opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
          >
            {isWrongChain ? "Switch to Robinhood" : currentNetworkLabel}
          </span>
        </button>

        {/* Collapsed Popover Menu */}
        {isOpen && (
          <div
            className="brutalist-box brutalist-shadow-dark absolute left-[calc(100%+8px)] top-0 z-50 min-w-[190px] border-2 border-[#ededea] bg-[#0a0a0a] p-1 font-inter text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ filter: "drop-shadow(0 12px 28px rgba(0,0,0,0.85))" }}
          >
            <div className="flex flex-col gap-1">
              {chainOptions.map((chain) => {
                const active = chain.id === "robinhood" && isRobinhood;
                return (
                  <button
                    key={chain.id}
                    type="button"
                    disabled={chain.disabled || isSwitching}
                    onClick={() => handleSelectChain(chain)}
                    className={`flex items-center justify-between w-full px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "bg-[#1a1a1a] text-[#ccff00]"
                        : chain.disabled
                          ? "cursor-not-allowed opacity-40 text-[#666]"
                          : "text-[#ededea] hover:bg-[#161616] hover:text-[#ccff00]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {chain.id === "robinhood" ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src="/brand/logo-sm.webp"
                          alt=""
                          className="size-3.5 object-contain rounded-[2px]"
                        />
                      ) : (
                        <span
                          className={`size-2 rounded-full ${
                            active ? "bg-[#ccff00]" : chain.disabled ? "bg-[#444]" : "bg-[#666]"
                          }`}
                        />
                      )}
                      <span>{chain.name}</span>
                    </div>

                    {active && <Check className="size-3.5 text-[#ccff00] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Expanded Standard View (matches ASK ROBIN KNIGHT / CONNECT WALLET brutalist styling)
  return (
    <div ref={containerRef} className={`relative inline-block w-full text-left ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={isSwitching}
        className={`brutalist-box brutalist-shadow-dark brutalist-pressable halftone-dark group relative flex w-full cursor-pointer items-center justify-between border font-inter text-[10px] font-bold uppercase tracking-[0.18em] transition-colors gap-2 px-3 py-2.5 ${
          isWrongChain
            ? "bg-[#261414] border-[#e0897a] text-[#e0897a] hover:bg-[#331818]"
            : "bg-[#0a0a0a] border-[#ededea] text-[#ededea] hover:border-[#ccff00] hover:text-[#ccff00]"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-sm.webp"
            alt="Robinhood"
            className="size-4 object-contain rounded-[2px] flex-none"
          />
          <span className="truncate">
            {isWrongChain ? "Wrong Network" : currentNetworkLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-none">
          <span
            className={`size-2 rounded-full ${
              isWrongChain ? "bg-[#e0897a]" : "bg-[#ccff00] animate-pulse"
            }`}
          />
          <ChevronDown
            className={`size-3.5 transition-transform duration-200 ${
              isOpen ? "rotate-180 text-[#ccff00]" : "text-[#8a8a8a] group-hover:text-[#ccff00]"
            }`}
          />
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="brutalist-box brutalist-shadow-dark absolute left-0 top-[calc(100%+6px)] z-50 w-full min-w-[180px] border-2 border-[#ededea] bg-[#0a0a0a] p-1 font-inter text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{ filter: "drop-shadow(0 12px 28px rgba(0,0,0,0.85))" }}
        >
          <div className="flex flex-col gap-1">
            {chainOptions.map((chain) => {
              const active = chain.id === "robinhood" && isRobinhood;
              return (
                <button
                  key={chain.id}
                  type="button"
                  disabled={chain.disabled || isSwitching}
                  onClick={() => handleSelectChain(chain)}
                  className={`flex items-center justify-between w-full px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "bg-[#1a1a1a] text-[#ccff00]"
                      : chain.disabled
                        ? "cursor-not-allowed opacity-40 text-[#666]"
                        : "text-[#ededea] hover:bg-[#161616] hover:text-[#ccff00]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {chain.id === "robinhood" ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src="/brand/logo-sm.webp"
                        alt=""
                        className="size-3.5 object-contain rounded-[2px]"
                      />
                    ) : (
                      <span
                        className={`size-2 rounded-full ${
                          active ? "bg-[#ccff00]" : chain.disabled ? "bg-[#444]" : "bg-[#666]"
                        }`}
                      />
                    )}
                    <span>{chain.name}</span>
                  </div>

                  {active && <Check className="size-3.5 text-[#ccff00] shrink-0" />}
                </button>
              );
            })}
          </div>

          {isWrongChain && (
            <div className="mt-1 border-t border-[#262626] px-2.5 py-1.5 text-[9px] text-[#e0897a] font-mono normal-case tracking-normal">
              Unsupported network. Click Robinhood above to switch.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
