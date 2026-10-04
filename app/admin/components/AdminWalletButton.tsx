"use client";

import { useWallet } from "@/lib/wallet/useWallet";
import { useWalletIcon } from "@/app/components/site/useWalletIcon";
import { activeSaleChainId } from "@/lib/config/chain";
import { Button } from "@/components/ui/button";

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The admin shell's wallet island. The sale panel has its own connect control —
 * this one is for every OTHER admin page: read-only pages never needed a wallet
 * before, but the operator wallet being visible (and switchable) in the chrome
 * means the sale panel is no longer the only place a wrong-chain state is
 * discoverable.
 *
 * `prepare()` on hover: AppKit registers connectors lazily on purpose, and the
 * hover head-start is what keeps the click feeling instant (useWallet docs).
 */
export function AdminWalletButton() {
  const wallet = useWallet();
  const icon = useWalletIcon();

  if (!wallet.isConnected) {
    return (
      <Button
        variant="outline"
        size="sm"
        onMouseEnter={wallet.prepare}
        onFocus={wallet.prepare}
        disabled={wallet.isLoading}
        onClick={() => void wallet.connect()}
      >
        {wallet.isLoading ? "CONNECTING…" : "CONNECT WALLET"}
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      {wallet.isWrongChain && (
        <Button
          variant="outline"
          size="sm"
          className="border-[#8a6d1f] text-[#d9c96a] hover:text-[#d9c96a]"
          onClick={() => void wallet.switchChain()}
        >
          WRONG CHAIN ({wallet.chainId}) — SWITCH
        </Button>
      )}
      {!wallet.isWrongChain && (
        <span className="hidden font-mono text-[11px] text-[#8a8a8a] md:inline">
          chain {wallet.chainId ?? activeSaleChainId()}
        </span>
      )}
      <span className="flex items-center gap-1.5 border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-foreground">
        {icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" width={14} height={14} className="size-3.5 rounded-full object-contain" />
        )}
        {wallet.providerName} · {shortAddr(wallet.address ?? "")}
      </span>
      <Button variant="ghost" size="sm" onClick={wallet.disconnect}>
        disconnect
      </Button>
    </span>
  );
}
