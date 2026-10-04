"use client";

import { useEffect, useState } from "react";
import type { PublicClient } from "viem";
import {
  ETH_PRICE_MAX_AGE_MS,
  ETH_PRICE_POLL_MS,
  readEthUsd,
} from "./eth-price";

export interface EthUsdState {
  usd: number | null;
  asOf: number | null;
}

export function useEthUsd(
  client?: Pick<PublicClient, "multicall"> | null,
): EthUsdState {
  const [state, setState] = useState<EthUsdState>({ usd: null, asOf: null });

  useEffect(() => {
    if (!client) return;

    let unmounted = false;
    // Per effect, not a ref: under Strict Mode's mount-unmount-mount, a ref still set by the dropped
    // first read made the live effect skip its own, and the price stayed blank for a whole poll.
    let inFlight = false;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const price = await readEthUsd(client);
        if (unmounted) return;
        if (price !== null) {
          setState({ usd: price, asOf: Date.now() });
        } else {
          setState((prev) => {
            if (prev.asOf !== null && Date.now() - prev.asOf > ETH_PRICE_MAX_AGE_MS) {
              return { usd: null, asOf: prev.asOf };
            }
            return prev;
          });
        }
      } catch {
        // RPC transport fault: retain last good price until it expires.
        if (unmounted) return;
        setState((prev) => {
          if (prev.asOf !== null && Date.now() - prev.asOf > ETH_PRICE_MAX_AGE_MS) {
            return { usd: null, asOf: prev.asOf };
          }
          return prev;
        });
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, ETH_PRICE_POLL_MS);

    return () => {
      unmounted = true;
      clearInterval(timer);
    };
  }, [client]);

  const isStale = state.asOf !== null && Date.now() - state.asOf > ETH_PRICE_MAX_AGE_MS;
  return {
    usd: isStale ? null : state.usd,
    asOf: state.asOf,
  };
}
