"use client";

import { useCallback, useState } from "react";
import { createPublicClient, erc20Abi, http, isAddress } from "viem";
import { robinhoodChain } from "@/lib/config/chain";
import type { SelectableToken } from "./types";

/**
 * Resolves an arbitrary pasted contract address to ERC-20 token metadata
 * directly on-chain via Robinhood Chain RPC.
 */
export function useResolveToken() {
  const [isResolving, setIsResolving] = useState(false);
  const [resolved, setResolved] = useState<SelectableToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async (address: string): Promise<SelectableToken | null> => {
    const trimmed = address.trim();
    if (!isAddress(trimmed)) {
      setError("Invalid Ethereum address format.");
      setResolved(null);
      return null;
    }

    setIsResolving(true);
    setError(null);

    try {
      const client = createPublicClient({
        chain: robinhoodChain,
        transport: http(undefined, { timeout: 5000, retryCount: 0 }),
      });

      const [name, symbol, decimals] = await Promise.all([
        client
          .readContract({
            address: trimmed as `0x${string}`,
            abi: erc20Abi,
            functionName: "name",
          })
          .catch(() => "Unknown Token"),
        client
          .readContract({
            address: trimmed as `0x${string}`,
            abi: erc20Abi,
            functionName: "symbol",
          })
          .catch(() => "TOKEN"),
        client
          .readContract({
            address: trimmed as `0x${string}`,
            abi: erc20Abi,
            functionName: "decimals",
          })
          .catch(() => 18),
      ]);

      const token: SelectableToken = {
        symbol: String(symbol),
        name: String(name),
        address: trimmed,
        decimals: Number(decimals),
        priceUsd: 0,
        priceEth: 0,
        balance: 0,
        category: "ecosystem",
        volume24h: 0,
        imageUrl: `https://dd.dexscreener.com/ds-data/tokens/robinhood/${trimmed.toLowerCase()}.png`,
        iconBg: "bg-[#ccff00]/10",
        iconColor: "text-[#ccff00]",
        iconLabel: String(symbol).slice(0, 2),
      };

      setResolved(token);
      setIsResolving(false);
      return token;
    } catch {
      setError("Could not read token contract on-chain.");
      setResolved(null);
      setIsResolving(false);
      return null;
    }
  }, []);

  return { resolve, resolved, isResolving, error, setResolved };
}
