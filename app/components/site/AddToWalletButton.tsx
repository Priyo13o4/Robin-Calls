"use client";

import { useState } from "react";
import { useConfig } from "wagmi";
import { getAccount, switchChain, watchAsset } from "wagmi/actions";
import { ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";
import { TOKEN_ADDRESS, TOKEN_DECIMALS, TOKEN_SYMBOL } from "@/lib/sale/token";
import { useWallet } from "@/lib/wallet/useWallet";

type State = "idle" | "working" | "added" | "failed";

/**
 * Connect if needed, move the wallet to Robinhood Chain, then import the token.
 * wagmi's switchChain falls back to wallet_addEthereumChain on 4902, so a wallet
 * that has never seen chain 4663 gets it added from lib/config/chain.ts first.
 */
export function AddToWalletButton({ variant = "block" }: { variant?: "block" | "pill" }) {
  const wallet = useWallet();
  const config = useConfig();
  const [state, setState] = useState<State>("idle");

  const add = async () => {
    setState("working");
    try {
      if (!wallet.isConnected && !(await wallet.connect())) return setState("idle");
      if (getAccount(config).chainId !== ROBINHOOD_CHAIN_ID) await switchChain(config, { chainId: ROBINHOOD_CHAIN_ID });
      const added = await watchAsset(config, {
        type: "ERC20",
        options: {
          address: TOKEN_ADDRESS,
          symbol: TOKEN_SYMBOL,
          decimals: TOKEN_DECIMALS,
          image: `${window.location.origin}/brand/logo.png`,
        },
      });
      setState(added ? "added" : "idle");
    } catch {
      // Rejected prompt or a wallet without watchAsset: say so, let them retry.
      setState("failed");
    }
  };

  const label =
    state === "working" ? "Check your wallet…"
    : state === "added" ? "Added to wallet ✓"
    : state === "failed" ? "Not added. Try again"
    : "Add to wallet";

  return (
    <button
      type="button"
      onClick={() => void add()}
      disabled={state === "working"}
      className={
        variant === "pill"
          ? "inline-flex items-center gap-2 rounded-full bg-[#ccff00] px-4 py-2 font-inter text-[11px] font-bold uppercase tracking-[0.06em] text-[#0a0a0a] shadow-[0_0_32px_-10px_rgba(204,255,0,0.7)] transition-transform hover:-translate-y-0.5 disabled:opacity-70 sm:px-5 sm:text-[12px] sm:tracking-[0.1em]"
          : "brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light inline-flex flex-none items-center gap-2 self-start whitespace-nowrap border-[#ccff00] bg-[#ccff00] px-4 py-2.5 font-inter text-[12px] font-bold uppercase tracking-[0.14em] text-[#0a0a0a] disabled:opacity-70 lg:self-center"
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/robincalls-32.svg" alt="" aria-hidden width={16} height={16} className="h-4 w-4 rounded-full" />
      {label}
    </button>
  );
}
