// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Abi } from "viem";

import { batchRead } from "../rpc/multicall";

import { v2FactoryAbi, v2PairAbi, v3FactoryAbi, v3PoolStateAbi, V3_FEE_TIERS } from "../rpc/abis";

import { clFactories, v2Factories, v3Factories, quoteAssets } from "../config/dex-registry";

import { trustedAddressCachePrimed } from "../config/trusted-addresses";

import { discoverClPoolsBatched } from "./slipstream";

import type { PoolRef } from "./types";

export interface CustodyDiscovery {
  pools: PoolRef[];
  /**
   * False when any V3 factory or pool read faulted, so the pool set may be
   * missing a member. Travels to lp_custody's §15.10c gate exactly like the
   * single-factory `complete` flag did — a short set can't be scored on shares.
   */
  v3Complete: boolean;
  /**
   * Same contract as `v3Complete`, for the V2 factory/pair reads. This existed
   * for V3 from the start and was simply never added for V2, so a faulted V2
   * `getPair` was indistinguishable from "this token has no V2 pair" — the
   * exact asymmetry that let an RPC blip shrink the custody set silently.
   */
  v2Complete: boolean;
  /**
   * Same contract again, for the Slipstream/CL leg. Added WITH its reader: L6's
   * lesson was that a flag nothing consumes is not tracking (§8 #8, #10), so
   * every place that ANDs `v2Complete && v3Complete` ANDs this too.
   */
  clComplete: boolean;
  /**
   * False when no Slipstream deployment is registered, so this venue was never
   * searched. Deliberately NOT part of `clComplete`: that one reaches the RPC
   * health gate, and a missing registry row is not a transport fault.
   */
  clRegistered: boolean;
  /**
   * False when there was nothing to pair the token against, so NO venue was
   * searched and every flag above describes a sweep of zero factories (§8 #9).
   * Reachable two ways: `quoteAssets()` drops its env fallback as soon as the
   * trusted-address cache is primed, and a cache that primed with no rows is
   * primed; and the filter below removes the traded token from its own quote
   * list, so a one-asset registry leaves nothing when that asset is the subject.
   *
   * Sits beside `clRegistered` and for the same reason: an empty registry is a
   * configuration gap, not a transport fault, so it must not reach
   * `assertRpcHealthy` and answer it with "the chain RPC could not answer".
   */
  quoteAssetsRegistered: boolean;
}

export async function discoverCustodyPools(token: `0x${string}`, customQuotes?: readonly string[], options: { includeCl?: boolean; dexIds?: readonly string[]; v3FeeTiersByDex?: Readonly<Record<string, readonly number[]>> } = undefined as any): Promise<CustodyDiscovery> {
  throw new NotImplementedInPublicBuild("lib/dex/discovery.ts#discoverCustodyPools");
}