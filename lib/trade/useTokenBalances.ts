"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { createPublicClient, erc20Abi, fallback, formatUnits, http, isAddress } from "viem";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_TESTNET_CHAIN_ID,
  getSaleChain,
  robinhoodChain,
  robinhoodTestnetChain,
} from "@/lib/config/chain";
import { firstSet } from "@/lib/config/env";
import type { SelectableToken } from "./types";

const primaryRpc = firstSet(process.env.ROBINHOOD_RPC_URL, process.env.NEXT_PUBLIC_RPC_URL);
const canonicalPublicRpc = "https://rpc.mainnet.chain.robinhood.com";

export const robinhoodPublicClient = createPublicClient({
  chain: robinhoodChain,
  batch: {
    multicall: {
      batchSize: 1024,
      wait: 32,
    },
  },
  transport: primaryRpc && primaryRpc !== canonicalPublicRpc
    ? fallback([
        http(primaryRpc, { timeout: 3000, retryCount: 1 }),
        http(canonicalPublicRpc, {
          timeout: 6000,
          retryCount: 2,
          batch: {
            batchSize: 1024,
            wait: 32,
          },
        }),
      ])
    : http(canonicalPublicRpc, {
        timeout: 6000,
        retryCount: 2,
        batch: {
          batchSize: 1024,
          wait: 32,
        },
      }),
});

export const robinhoodTestnetPublicClient = createPublicClient({
  chain: robinhoodTestnetChain,
  transport: http("https://rpc.testnet.chain.robinhood.com", { timeout: 6000, retryCount: 2 }),
});

// The browser reads the public node from the visitor's IP, which it throttles in bursts (L213 #10):
// ride out a short lockout before calling a balance unavailable.
const READ_RETRIES = 3;
const readRetryDelay = (attempt: number) => Math.min(8_000, 1_000 * 2 ** attempt);

/**
 * Batches on-chain ERC-20 balances for the active token selector list
 * via Multicall3, plus native ETH balance on the active Robinhood Chain.
 * Preserves exact rawBalance and differentiates loaded, loading, error, and disconnected states.
 */
export function useTokenBalances(
  tokens: SelectableToken[],
  overrideAddress?: string
): {
  tokensWithBalances: SelectableToken[];
  isLoading: boolean;
  isConnected: boolean;
  refetch: () => Promise<void>;
} {
  const { address: accountAddress, isConnected: isAccountConnected, chainId: accountChainId } = useAccount();
  const effectiveAddress = (overrideAddress || accountAddress) as `0x${string}` | undefined;
  const isConnected = isAccountConnected || !!effectiveAddress;
  const queryClient = useQueryClient();
  const [explicitlyRefreshing, setExplicitlyRefreshing] = useState(false);
  const refreshSequence = useRef(0);
  // Balances as they stood when a refresh was pressed: shown while it is in flight, never after an error.
  const latest = useRef<SelectableToken[]>([]);
  const [refreshSnapshot, setRefreshSnapshot] = useState<Map<string, bigint> | null>(null);
  const [fallbackData, setFallbackData] = useState<{
    ethBalance?: bigint;
    erc20Balances?: Map<string, bigint>;
    error?: boolean;
  }>({});

  const activeChain = getSaleChain(accountChainId);
  const targetChainId = activeChain.id;

  // 1. Native ETH balance matching SalePageClient: address presence drives wagmi enabled state
  const {
    data: ethBalance,
    isLoading: isEthLoading,
    isFetching: isEthFetching,
    isError: isEthError,
    isPending: isEthPending,
    refetch: refetchEth,
  } = useBalance({
    address: effectiveAddress,
    chainId: targetChainId,
    query: {
      enabled: isConnected && !!effectiveAddress,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
      retry: READ_RETRIES,
      retryDelay: readRetryDelay,
    },
  });

  // 2. Filter ERC-20 tokens that have valid non-zero hex addresses
  const erc20Tokens = useMemo(() => {
    return tokens.filter(
      (t) =>
        !t.isNative &&
        t.address !== "0x0000000000000000000000000000000000000000" &&
        isAddress(t.address)
    );
  }, [tokens]);

  // 3. Batch multicall for all ERC-20 token balances explicitly on the active Robinhood chain
  const contracts = useMemo(() => {
    if (!effectiveAddress) return [];
    return erc20Tokens.map((t) => ({
      address: t.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [effectiveAddress],
      chainId: targetChainId,
    }));
  }, [erc20Tokens, effectiveAddress, targetChainId]);

  const {
    data: erc20Balances,
    isLoading: isErc20Loading,
    isFetching: isErc20Fetching,
    isError: isErc20Error,
    isPending: isErc20Pending,
    refetch: refetchErc20,
  } = useReadContracts({
    contracts,
    query: {
      enabled: isConnected && !!effectiveAddress && contracts.length > 0,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
      retry: READ_RETRIES,
      retryDelay: readRetryDelay,
    },
  });

  // 4. Resilient fallback via direct viem public client when Wagmi encounters connector/provider errors
  // or when multicall items return failure
  const hasMulticallFailures = erc20Balances && erc20Balances.some((r) => r.status === "failure");

  useEffect(() => {
    if (!isConnected || !effectiveAddress) {
      setFallbackData({});
      return;
    }

    if (!isEthError && !isErc20Error && !hasMulticallFailures) return;

    let cancelled = false;
    const fetchDirect = async () => {
      try {
        const isTestnet = targetChainId === ROBINHOOD_TESTNET_CHAIN_ID;
        const client = isTestnet ? robinhoodTestnetPublicClient : robinhoodPublicClient;
        const [ethRes, erc20Res] = await Promise.allSettled([
          isEthError
            ? (isTestnet
                ? robinhoodTestnetPublicClient.getBalance({ address: effectiveAddress })
                : robinhoodPublicClient.getBalance({ address: effectiveAddress }))
            : Promise.resolve(ethBalance?.value),
          (isErc20Error || hasMulticallFailures) && contracts.length > 0
            ? (isTestnet
                ? robinhoodTestnetPublicClient.multicall({
                    contracts: contracts.map((c) => ({
                      address: c.address,
                      abi: erc20Abi,
                      functionName: "balanceOf",
                      args: [effectiveAddress],
                    })),
                  })
                : robinhoodPublicClient.multicall({
                    contracts: contracts.map((c) => ({
                      address: c.address,
                      abi: erc20Abi,
                      functionName: "balanceOf",
                      args: [effectiveAddress],
                    })),
                  }))
            : Promise.resolve([]),
        ]);

        if (cancelled) return;

        const newMap = new Map<string, bigint>();
        if (erc20Res.status === "fulfilled" && Array.isArray(erc20Res.value)) {
          erc20Tokens.forEach((t, i) => {
            const item = erc20Res.value[i];
            if (item && item.status === "success" && typeof item.result === "bigint") {
              newMap.set(t.address.toLowerCase(), item.result);
            }
          });
        }

        setFallbackData({
          ethBalance: ethRes.status === "fulfilled" ? ethRes.value : undefined,
          erc20Balances: newMap.size > 0 ? newMap : undefined,
          error: ethRes.status === "rejected" && erc20Res.status === "rejected",
        });
      } catch {
        if (!cancelled) setFallbackData((prev) => ({ ...prev, error: true }));
      }
    };

    void fetchDirect();
    return () => {
      cancelled = true;
    };
  }, [
    isConnected,
    effectiveAddress,
    isEthError,
    isErc20Error,
    hasMulticallFailures,
    contracts,
    ethBalance?.value,
    erc20Tokens,
    targetChainId,
  ]);

  // 5. Prompt refresh on account / connection / network change
  const lastAccountRef = useRef<string | null>(null);
  useEffect(() => {
    const current = isConnected && effectiveAddress ? `${effectiveAddress.toLowerCase()}:${accountChainId ?? "unknown"}` : null;
    if (current !== lastAccountRef.current) {
      lastAccountRef.current = current;
      if (current) {
        if (queryClient) {
          void queryClient.invalidateQueries({ queryKey: ["balance"] });
          void queryClient.invalidateQueries({ queryKey: ["readContracts"] });
        }
        void refetchEth();
        if (contracts.length > 0) {
          void refetchErc20();
        }
      }
    }
  }, [effectiveAddress, isConnected, accountChainId, queryClient, refetchEth, refetchErc20, contracts.length]);

  const refetch = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setRefreshSnapshot(new Map(latest.current
      .filter((t) => t.balanceStatus === "loaded" && t.rawBalance !== undefined)
      .map((t) => [t.isNative ? "0x0000000000000000000000000000000000000000" : t.address.toLowerCase(), t.rawBalance as bigint])));
    setExplicitlyRefreshing(true);
    try {
      if (queryClient) {
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ["balance"] }),
          queryClient.invalidateQueries({ queryKey: ["readContracts"] }),
        ]);
      }
      await Promise.allSettled([refetchEth(), ...(contracts.length > 0 ? [refetchErc20()] : [])]);
    } finally {
      if (sequence === refreshSequence.current) setExplicitlyRefreshing(false);
    }
  }, [queryClient, refetchEth, refetchErc20, contracts.length]);

  // 6. Merge balances back into tokens array without presenting pending/faulted/disconnected data as verified 0
  const tokensWithBalances = useMemo(() => {
    if (!isConnected || !effectiveAddress) {
      return tokens.map((t) => ({
        ...t,
        balance: 0,
        rawBalance: undefined,
        balanceStatus: "disconnected" as const,
      }));
    }

    const keyOf = (t: SelectableToken) => (t.isNative ? "0x0000000000000000000000000000000000000000" : t.address.toLowerCase());

    if (explicitlyRefreshing) {
      return tokens.map((t) => {
        const raw = refreshSnapshot?.get(keyOf(t));
        return raw === undefined
          ? { ...t, balance: 0, rawBalance: undefined, balanceStatus: "loading" as const }
          : { ...t, balance: parseFloat(formatUnits(raw, t.decimals ?? 18)), rawBalance: raw, balanceStatus: "loaded" as const };
      });
    }

    const balanceMap = new Map<
      string,
      { num: number; raw: bigint; status: "loaded" | "loading" | "error" }
    >();

    // Set ETH balance
    const effectiveEthRaw = ethBalance?.value ?? fallbackData.ethBalance;
    if (effectiveEthRaw !== undefined) {
      try {
        const val = parseFloat(formatUnits(effectiveEthRaw, 18));
        balanceMap.set("0x0000000000000000000000000000000000000000", {
          num: val,
          raw: effectiveEthRaw,
          status: "loaded",
        });
      } catch {
        balanceMap.set("0x0000000000000000000000000000000000000000", {
          num: 0,
          raw: 0n,
          status: "error",
        });
      }
    } else if (isEthError && fallbackData.error) {
      balanceMap.set("0x0000000000000000000000000000000000000000", {
        num: 0,
        raw: 0n,
        status: "error",
      });
    }

    // Set ERC-20 balances from multicall results or direct fallback
    erc20Tokens.forEach((t, index) => {
      const addr = t.address.toLowerCase();
      const res = erc20Balances ? erc20Balances[index] : undefined;
      const fallbackVal = fallbackData.erc20Balances?.get(addr);
      const rawVal =
        res?.status === "success" && typeof res.result === "bigint"
          ? res.result
          : fallbackVal;

      if (rawVal !== undefined) {
        try {
          const dec = t.decimals ?? 18;
          const parsed = parseFloat(formatUnits(rawVal, dec));
          balanceMap.set(addr, {
            num: parsed,
            raw: rawVal,
            status: "loaded",
          });
        } catch {
          balanceMap.set(addr, {
            num: 0,
            raw: 0n,
            status: "error",
          });
        }
      } else if ((isErc20Error && fallbackData.error) || res?.status === "failure") {
        balanceMap.set(addr, {
          num: 0,
          raw: 0n,
          status: "error",
        });
      }
    });

    return tokens.map((t) => {
      const addr = t.isNative ? "0x0000000000000000000000000000000000000000" : t.address.toLowerCase();
      const bal = balanceMap.get(addr);
      if (bal && bal.status === "loaded") {
        return {
          ...t,
          balance: bal.num,
          rawBalance: bal.raw,
          balanceStatus: "loaded" as const,
        };
      }
      if (bal && bal.status === "error") {
        return {
          ...t,
          balance: 0,
          rawBalance: undefined,
          balanceStatus: "error" as const,
        };
      }
      // Pending / loading state
      const isItemPending = t.isNative
        ? !ethBalance && fallbackData.ethBalance === undefined && !isEthError
        : !erc20Balances && (!fallbackData.erc20Balances || !fallbackData.erc20Balances.has(addr)) && !isErc20Error;

      const isItemLoading = t.isNative
        ? (isEthLoading || isEthFetching || isEthPending || isItemPending)
        : (isErc20Loading || isErc20Fetching || isErc20Pending || isItemPending);

      return {
        ...t,
        balance: 0,
        rawBalance: undefined,
        balanceStatus: isItemLoading ? ("loading" as const) : ("error" as const),
      };
    });
  }, [
    tokens,
    isConnected,
    effectiveAddress,
    refreshSnapshot,
    explicitlyRefreshing,
    ethBalance,
    fallbackData,
    isEthLoading,
    isEthFetching,
    isEthPending,
    isEthError,
    erc20Tokens,
    erc20Balances,
    isErc20Loading,
    isErc20Fetching,
    isErc20Pending,
    isErc20Error,
  ]);

  useEffect(() => {
    latest.current = tokensWithBalances;
  }, [tokensWithBalances]);

  return {
    tokensWithBalances,
    isLoading: explicitlyRefreshing || isEthLoading || isErc20Loading,
    isConnected,
    refetch,
  };
}
