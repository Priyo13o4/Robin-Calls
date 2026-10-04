/**
 * Uniswap Smart Order Router (AlphaRouter) vs. Current RobinCalls V3 Planner Benchmark Spike
 *
 * Repaired benchmark implementing:
 * 1. Transport-level HTTP meter capturing all physical RPC requests to public URL (fetch + ethers send)
 * 2. Hard physical request cap <= 200 total across the entire run and max 3 concurrency semaphore
 * 3. Consistent block number pinning across both Current Planner (viem readContract) and SOR (routingConfig.blockNumber)
 * 4. Equal-scope comparison: Current total search (direct + two-hop over supplied candidate subset) vs SOR graph search
 * 5. Cold vs Warmed execution measured by repeating the exact same request
 * 6. Explicit synthetic markers for placeholder TVL fixtures and heuristic gas baselines
 * 7. Disallowing SWAP_ROUTER_02 alias to Universal Router (no transaction building via this override)
 * 8. Independent selected-route simulations through the app executor at the pinned block
 */

import fs from "node:fs";
import { simulateSelectedV3Route } from "./benchmark-route-execution";
import path from "node:path";
import { createPublicClient, http, type PublicClient } from "viem";
import { robinhoodChain } from "../lib/config/chain";
import { quoterV2Abi } from "../lib/rpc/abis";
import { UNISWAP_UR } from "../lib/swap/venues";
import { quoteMultihopRoutes } from "../lib/swap/multihop-quote";

// Pinned SOR paths from /tmp/robincalls-sor-benchmark
const BENCHMARK_PREFIX = "/tmp/robincalls-sor-benchmark/node_modules";

export const PUBLIC_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

export interface TransportRpcEvidence {
  timestamp: number;
  source: "viem" | "ethers";
  method: string;
  durationMs: number;
  status: "ok" | "error";
  blockNumber?: string;
}

export class TransportMeterManager {
  public totalPhysicalRequests = 0;
  public methodCounts: Record<string, number> = {};
  public rawEvidence: TransportRpcEvidence[] = [];

  private activeConcurrency = 0;
  private queue: (() => void)[] = [];
  public readonly cap: number;
  public readonly maxConcurrency: number;
  private origFetch = globalThis.fetch;
  private attached = false;

  constructor(public readonly rpcUrl: string = PUBLIC_RPC_URL, cap = 200, maxConcurrency = 3) {
    this.cap = cap;
    this.maxConcurrency = maxConcurrency;
  }

  public async acquirePermit(): Promise<() => void> {
    while (this.activeConcurrency >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    // Reserve the budget at dispatch, including in-flight attempts. Recheck after
    // waiting so queued work cannot exceed the cap.
    if (this.totalPhysicalRequests >= this.cap) {
      const next = this.queue.shift();
      next?.();
      throw new Error(`TransportMeter: hard cap of ${this.cap} physical requests exceeded`);
    }
    this.totalPhysicalRequests++;
    this.activeConcurrency++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeConcurrency--;
      this.queue.shift()?.();
    };
  }

  public recordRequest(source: "viem" | "ethers", method: string, durationMs: number, status: "ok" | "error", blockNumber?: string) {
    this.methodCounts[method] = (this.methodCounts[method] || 0) + 1;
    this.rawEvidence.push({ timestamp: Date.now(), source, method, durationMs, status, blockNumber });
  }

  private async measuredFetch(source: "viem" | "ethers", input: RequestInfo | URL, init?: RequestInit) {
    const payload = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const method = payload.method ?? "unknown";
    const blockNumber = ["eth_call", "eth_getCode"].includes(method) ? String(payload.params?.[1]) : undefined;
    const release = await this.acquirePermit();
    const start = Date.now();
    let status: "ok" | "error" = "ok";
    try {
      const res = await this.origFetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20000) });
      if (!res.ok) status = "error";
      else if ((await res.clone().json()).error) status = "error";
      return res;
    } catch (error) { status = "error"; throw error; }
    finally { this.recordRequest(source, method, Date.now() - start, status, blockNumber); release(); }
  }

  public attach() {
    if (this.attached) return;
    this.attached = true;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new URL(url).href === new URL(this.rpcUrl).href ? this.measuredFetch("viem", input, init) : this.origFetch(input, init);
    };
  }

  public wrapEthersProvider(provider: any) {
    // Use one explicit HTTP attempt per send, instead of counting an ethers
    // logical request that may hide internal transport retries or caching.
    let nextId = 0;
    provider.send = async (method: string, params: unknown[]) => {
      const response = await this.measuredFetch("ethers", this.rpcUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }),
      });
      const body = await response.json();
      if (!response.ok || body.error) {
        const error = new Error(body.error?.message ?? `HTTP ${response.status}`);
        Object.assign(error, { code: body.error?.code, data: body.error?.data });
        throw error;
      }
      return body.result;
    };
    return provider;
  }

  public reset() {
    this.totalPhysicalRequests = 0;
    this.methodCounts = {};
    this.rawEvidence = [];
  }

  public detach() {
    if (this.attached) {
      globalThis.fetch = this.origFetch;
      this.attached = false;
    }
  }
}

export const transportMeter = new TransportMeterManager(PUBLIC_RPC_URL, 200, 3);

export interface CandidateSearchOutcome {
  chosenRoute: "direct" | "twoHop" | "none";
  chosenAmountOutRaw: string;
  chosenPath: string;
  directQuote: {
    amountOutRaw: string;
    gasEstimate: string;
  };
  twoHopQuote: {
    amountOutRaw: string;
    bridgeSymbol: string;
  };
  totalSearchElapsedMs: number;
  physicalRpcRequests: number;
  logicalSubcalls: number;
}

export interface AlphaRouterSearchOutcome {
  chosenRoute: string;
  chosenAmountOutRaw: string;
  chosenPath: string;
  hops: number;
  estimatedGasUsed: string;
  searchElapsedMs: number;
  physicalRpcRequests: number;
  logicalSubcalls: number;
}

export interface BenchmarkCaseResult {
  caseIndex: number;
  mode: "cold" | "warm";
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountInFormatted: string;
  amountInRaw: string;
  pinnedBlockNumber: string;
  currentPlannerSearch: CandidateSearchOutcome;
  alphaRouterSearch: AlphaRouterSearchOutcome;
  parityDeltaBps: number;
  latencyRatioSorVsCurrent: number;
  executionStatus: string;
  executionComparison?: { current: Awaited<ReturnType<typeof simulateSelectedV3Route>>; sorSelected: Awaited<ReturnType<typeof simulateSelectedV3Route>>; httpRequests: number };
}

export interface BenchmarkReport {
  timestamp: string;
  chainId: number;
  pinnedBlockNumber: string;
  fixtureSnapshot: {
    sorPackageVersion: string;
    sdkCoreVersion: string;
    ethersVersion: string;
    pinnedBlockNumber: string;
    sourcePools: Array<{
      id: string;
      feeTier: string;
      token0: string;
      token1: string;
      syntheticTvl: boolean;
    }>;
  };
  sorConfig: {
    maxSwapsPerPath: number;
    minSplits: number;
    maxSplits: number;
    distributionPercent: number;
  };
  unsupportedChainBlockersIdentified: string[];
  adapterOverridesApplied: string[];
  timings: {
    currentPlannerColdTotalMs: number;
    currentPlannerWarmedTotalMs: number;
    sorColdInitMs: number;
    sorWarmedQuoteMs: number;
  };
  totalRpcCallsUsed: {
    physicalRequests: number;
    cap: number;
    capEnforced: boolean;
    maxConcurrency: number;
    methodCounts: Record<string, number>;
  };
  simulationEvidence: {
    status: "SIMULATED" | "PARTIAL";
    feasible: boolean;
    reason: string;
  };
  cases: BenchmarkCaseResult[];
}

export const VERIFIED_ADDRESSES = {
  chainId: 4663,
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  aapl: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  nvda: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
  tsla: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  quoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  universalRouter: "0x204FAca1764B154221e35c0d20aBb3c525710498",
  multicall3: "0xca11bde05977b3631167028862be2a173976ca11"
} as const;

/**
 * Verified pool catalogue fixture for Robinhood Chain stock paths.
 * NOTE: tvlETH and tvlUSD values are explicitly SYNTHETIC fixtures required by SOR's internal
 * heuristic candidate ranking; they are not measured on-chain TVL data.
 */
export const KNOWN_V3_POOLS = [
  {
    id: "0x8bb3514e2204E1cDF3Ac149EFEe7Ff04D91B719f".toLowerCase(),
    feeTier: "500",
    liquidity: "5561608767906839416092",
    token0: { id: VERIFIED_ADDRESSES.weth.toLowerCase() },
    token1: { id: VERIFIED_ADDRESSES.aapl.toLowerCase() },
    tvlETH: 100, // SYNTHETIC
    tvlUSD: 250000, // SYNTHETIC
    syntheticTvl: true
  },
  {
    id: "0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a".toLowerCase(),
    feeTier: "500",
    liquidity: "1000000000000000000",
    token0: { id: VERIFIED_ADDRESSES.usdg.toLowerCase() },
    token1: { id: VERIFIED_ADDRESSES.weth.toLowerCase() },
    tvlETH: 100, // SYNTHETIC
    tvlUSD: 250000, // SYNTHETIC
    syntheticTvl: true
  },
  {
    id: "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D".toLowerCase(),
    feeTier: "500",
    liquidity: "1061075408181102343",
    token0: { id: VERIFIED_ADDRESSES.usdg.toLowerCase() },
    token1: { id: VERIFIED_ADDRESSES.aapl.toLowerCase() },
    tvlETH: 50, // SYNTHETIC
    tvlUSD: 125000, // SYNTHETIC
    syntheticTvl: true
  },
  {
    id: "0x62AB521f71431f78ac374CdbadC6cda3c8916b6C".toLowerCase(),
    feeTier: "500",
    liquidity: "18007387117635068589633",
    token0: { id: VERIFIED_ADDRESSES.weth.toLowerCase() },
    token1: { id: VERIFIED_ADDRESSES.nvda.toLowerCase() },
    tvlETH: 100, // SYNTHETIC
    tvlUSD: 250000, // SYNTHETIC
    syntheticTvl: true
  },
  {
    id: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3".toLowerCase(),
    feeTier: "500",
    liquidity: "29569626381996719416",
    token0: { id: VERIFIED_ADDRESSES.usdg.toLowerCase() },
    token1: { id: VERIFIED_ADDRESSES.nvda.toLowerCase() },
    tvlETH: 50, // SYNTHETIC
    tvlUSD: 125000, // SYNTHETIC
    syntheticTvl: true
  },
  {
    id: "0xA953CA88ff430e9487c60cA34d757414f4efdA07".toLowerCase(),
    feeTier: "3000",
    liquidity: "4501612624125397339167",
    token0: { id: VERIFIED_ADDRESSES.weth.toLowerCase() },
    token1: { id: VERIFIED_ADDRESSES.tsla.toLowerCase() },
    tvlETH: 100, // SYNTHETIC
    tvlUSD: 250000, // SYNTHETIC
    syntheticTvl: true
  },
  {
    id: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3".toLowerCase(),
    feeTier: "3000",
    liquidity: "438601524930041809",
    token0: { id: VERIFIED_ADDRESSES.tsla.toLowerCase() },
    token1: { id: VERIFIED_ADDRESSES.usdg.toLowerCase() },
    tvlETH: 50, // SYNTHETIC
    tvlUSD: 125000, // SYNTHETIC
    syntheticTvl: true
  }
];

export function applyAlphaRouterChainOverrides(sorModule: any, ethersModule: any) {
  const chains = require(path.join(BENCHMARK_PREFIX, "@uniswap/smart-order-router/build/main/util/chains"));
  const addresses = require(path.join(BENCHMARK_PREFIX, "@uniswap/smart-order-router/build/main/util/addresses"));
  const { usdGasTokensByChain } = require(path.join(BENCHMARK_PREFIX, "@uniswap/smart-order-router/build/main/routers/alpha-router/gas-models/gas-model"));
  const gasCosts = require(path.join(BENCHMARK_PREFIX, "@uniswap/smart-order-router/build/main/routers/alpha-router/gas-models/gas-costs"));
  const { Token } = require(path.join(BENCHMARK_PREFIX, "@uniswap/sdk-core"));

  const chainId = 4663;

  // 1. ID_TO_NETWORK_NAME & ID_TO_CHAIN_ID shims
  const originalIdToNet = chains.ID_TO_NETWORK_NAME;
  chains.ID_TO_NETWORK_NAME = (id: number) => (id === chainId ? "robinhood" : originalIdToNet(id));

  const originalIdToChain = chains.ID_TO_CHAIN_ID;
  chains.ID_TO_CHAIN_ID = (id: number) => (id === chainId ? chainId : originalIdToChain(id));

  if (!chains.SUPPORTED_CHAINS.includes(chainId)) {
    chains.SUPPORTED_CHAINS.push(chainId);
  }

  // 2. Deployments & router addresses
  addresses.V3_CORE_FACTORY_ADDRESSES[chainId] = VERIFIED_ADDRESSES.v3Factory;
  addresses.QUOTER_V2_ADDRESSES[chainId] = VERIFIED_ADDRESSES.quoterV2;
  addresses.NEW_QUOTER_V2_ADDRESSES[chainId] = VERIFIED_ADDRESSES.quoterV2;
  addresses.UNISWAP_MULTICALL_ADDRESSES[chainId] = VERIFIED_ADDRESSES.multicall3;

  // NOTE: SWAP_ROUTER_02_ADDRESSES[4663] is intentionally NOT set to Universal Router.
  // Universal Router is NOT SwapRouter02 ABI compatible. No transaction building via this override.

  // 3. Tokens & Gas costs (SYNTHETIC heuristic baseline)
  const wethToken = new Token(chainId, VERIFIED_ADDRESSES.weth, 18, "WETH", "Wrapped Ether");
  const usdgToken = new Token(chainId, VERIFIED_ADDRESSES.usdg, 6, "USDG", "USDG");

  chains.WRAPPED_NATIVE_CURRENCY[chainId] = wethToken;
  usdGasTokensByChain[chainId] = [usdgToken];

  const origCostPerHop = gasCosts.COST_PER_HOP;
  gasCosts.COST_PER_HOP = (id: number) => (id === chainId ? ethersModule.BigNumber.from(80000) : origCostPerHop(id));

  const origCostPerInitTick = gasCosts.COST_PER_INIT_TICK;
  gasCosts.COST_PER_INIT_TICK = (id: number) => (id === chainId ? ethersModule.BigNumber.from(31000) : origCostPerInitTick(id));

  const origBaseSwapCost = gasCosts.BASE_SWAP_COST;
  gasCosts.BASE_SWAP_COST = (id: number) => (id === chainId ? ethersModule.BigNumber.from(5000) : origBaseSwapCost(id));

  const origSingleHopOverhead = gasCosts.SINGLE_HOP_OVERHEAD;
  gasCosts.SINGLE_HOP_OVERHEAD = (id: number) => (id === chainId ? ethersModule.BigNumber.from(15000) : origSingleHopOverhead(id));

  const origTokenOverhead = gasCosts.TOKEN_OVERHEAD;
  gasCosts.TOKEN_OVERHEAD = (id: number, route: any) => (id === chainId ? ethersModule.BigNumber.from(0) : origTokenOverhead(id, route));

  const origNativeOverhead = gasCosts.NATIVE_OVERHEAD;
  gasCosts.NATIVE_OVERHEAD = (id: number, inC: any, outC: any) => (id === chainId ? ethersModule.BigNumber.from(0) : origNativeOverhead(id, inC, outC));
}

export function createMulticall3Adapter(
  sorModule: any,
  ethersModule: any,
  provider: any,
  pinnedBlockNumber?: bigint,
  onLogicalCall?: (count: number) => void
) {
  const mc = new ethersModule.Contract(
    VERIFIED_ADDRESSES.multicall3,
    [
      "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
      "function getBlockNumber() view returns (uint256)"
    ],
    provider
  );

  return new (class extends sorModule.IMulticallProvider {
    async callSameFunctionOnMultipleContracts(params: any) {
      if (onLogicalCall) onLogicalCall(params.addresses.length);
      const { addresses, contractInterface, functionName, functionParams, providerConfig } = params;
      const fragment = contractInterface.getFunction(functionName);
      const callData = contractInterface.encodeFunctionData(fragment, functionParams);
      const calls = addresses.map((addr: string) => ({ target: addr, allowFailure: true, callData }));
      const rawBn = providerConfig?.blockNumber
        ? await providerConfig.blockNumber
        : pinnedBlockNumber
        ? Number(pinnedBlockNumber)
        : await provider.getBlockNumber();
      const aggregateResults = await mc.callStatic.aggregate3(calls, { blockTag: rawBn });
      const results = aggregateResults.map(({ success, returnData }: any) => {
        if (!success || returnData.length <= 2) return { success: false, returnData };
        return { success: true, result: contractInterface.decodeFunctionResult(fragment, returnData) };
      });
      return { blockNumber: ethersModule.BigNumber.from(rawBn), results };
    }

    async callSameFunctionOnContractWithMultipleParams(params: any) {
      if (onLogicalCall) onLogicalCall(params.functionParams.length);
      const { address, contractInterface, functionName, functionParams, providerConfig } = params;
      const fragment = contractInterface.getFunction(functionName);
      const calls = functionParams.map((param: any) => ({
        target: address,
        allowFailure: true,
        callData: contractInterface.encodeFunctionData(fragment, param)
      }));
      const rawBn = providerConfig?.blockNumber
        ? await providerConfig.blockNumber
        : pinnedBlockNumber
        ? Number(pinnedBlockNumber)
        : await provider.getBlockNumber();
      const aggregateResults = await mc.callStatic.aggregate3(calls, { blockTag: rawBn });
      const results = aggregateResults.map(({ success, returnData }: any) => {
        if (!success || returnData.length <= 2) return { success: false, returnData, gasUsed: ethersModule.BigNumber.from(0) };
        return {
          success: true,
          result: contractInterface.decodeFunctionResult(fragment, returnData),
          gasUsed: ethersModule.BigNumber.from(110000)
        };
      });
      return { blockNumber: ethersModule.BigNumber.from(rawBn), results, approxGasUsedPerSuccessCall: 110000 };
    }

    async callMultipleFunctionsOnSameContract(params: any) {
      if (onLogicalCall) onLogicalCall(params.functionNames.length);
      const { address, contractInterface, functionNames, functionParams, providerConfig } = params;
      const calls = functionNames.map((name: string, i: number) => {
        const fragment = contractInterface.getFunction(name);
        return {
          target: address,
          allowFailure: true,
          callData: contractInterface.encodeFunctionData(fragment, functionParams?.[i])
        };
      });
      const rawBn = providerConfig?.blockNumber
        ? await providerConfig.blockNumber
        : pinnedBlockNumber
        ? Number(pinnedBlockNumber)
        : await provider.getBlockNumber();
      const aggregateResults = await mc.callStatic.aggregate3(calls, { blockTag: rawBn });
      const results = aggregateResults.map(({ success, returnData }: any, i: number) => {
        if (!success || returnData.length <= 2) return { success: false, returnData };
        const fragment = contractInterface.getFunction(functionNames[i]);
        return { success: true, result: contractInterface.decodeFunctionResult(fragment, returnData) };
      });
      return { blockNumber: ethersModule.BigNumber.from(rawBn), results };
    }
  })();
}

/**
 * Pinned block readContract quoter helper for current RobinCalls V3 QuoterV2.
 */
export async function quoteV3Pinned(
  client: PublicClient,
  quoter: `0x${string}`,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  fee: number,
  blockNumber: bigint
): Promise<{ kind: "OUT"; amountOut: bigint; gasEstimate: bigint } | { kind: "REVERT"; detail: string }> {
  try {
    const result = await client.readContract({
      address: quoter,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
      blockNumber
    });
    const [amountOut, , , gasEstimate] = result as [bigint, bigint, number, bigint];
    return { kind: "OUT", amountOut, gasEstimate };
  } catch (err: any) {
    return { kind: "REVERT", detail: err?.message?.split("\n")[0] ?? String(err) };
  }
}

export async function runBenchmark(injectedPinnedBlock?: bigint): Promise<BenchmarkReport> {
  // 1. Attach transport-level meter
  transportMeter.attach();
  transportMeter.reset();

  const sorModule = require(path.join(BENCHMARK_PREFIX, "@uniswap/smart-order-router"));
  const ethersModule = require(path.join(BENCHMARK_PREFIX, "ethers"));
  const { Token, CurrencyAmount, TradeType } = require(path.join(BENCHMARK_PREFIX, "@uniswap/sdk-core"));
  const { Protocol } = require(path.join(BENCHMARK_PREFIX, "@uniswap/router-sdk"));

  // Apply chain overrides without SWAP_ROUTER_02 alias
  applyAlphaRouterChainOverrides(sorModule, ethersModule);

  const viemClient = createPublicClient({
    chain: robinhoodChain,
    transport: http(PUBLIC_RPC_URL, { timeout: 15_000, retryCount: 0 })
  });

  const rawProvider = new ethersModule.ethers.providers.JsonRpcProvider(PUBLIC_RPC_URL);
  const provider = transportMeter.wrapEthersProvider(rawProvider);

  // Pin block number for the entire run
  const pinnedBlockNumber = injectedPinnedBlock ?? (await viemClient.getBlockNumber());

  let sorLogicalSubcallsAccumulator = 0;
  const onLogicalSubcall = (count: number) => {
    sorLogicalSubcallsAccumulator += count;
  };

  const multicall3Adapter = createMulticall3Adapter(
    sorModule,
    ethersModule,
    provider,
    pinnedBlockNumber,
    onLogicalSubcall
  );

  const WETH = new Token(4663, VERIFIED_ADDRESSES.weth, 18, "WETH", "Wrapped Ether");
  const USDG = new Token(4663, VERIFIED_ADDRESSES.usdg, 6, "USDG", "USDG");
  const AAPL = new Token(4663, VERIFIED_ADDRESSES.aapl, 18, "AAPL", "Apple");

  class StaticCatalogueSubgraphProvider {
    async getPools() {
      return KNOWN_V3_POOLS;
    }
  }

  class StaticTokenPropertiesProvider {
    async getTokensProperties(tokens: any[]) {
      const res: Record<string, any> = {};
      for (const t of tokens) {
        const addr = (t.address ? t.address : t).toLowerCase();
        res[addr] = {
          tokenFeeResult: {
            feeTakenOnTransfer: false,
            externalTransferFailed: false,
            buyFeeBps: ethersModule.BigNumber.from(0),
            sellFeeBps: ethersModule.BigNumber.from(0)
          }
        };
      }
      return res;
    }
  }

  class StaticGasPriceProvider {
    async getGasPrice() {
      return { gasPriceWei: ethersModule.BigNumber.from("1000000000") };
    }
  }

  class StaticTokenProvider {
    async getTokens() {
      const map: Record<string, any> = {
        [WETH.address.toLowerCase()]: WETH,
        [USDG.address.toLowerCase()]: USDG,
        [AAPL.address.toLowerCase()]: AAPL
      };
      return {
        getTokenByAddress: (addr: string) => map[addr.toLowerCase()],
        getTokenBySymbol: () => null,
        getAllTokens: () => Object.values(map)
      };
    }
  }

  const v3PoolProvider = new sorModule.V3PoolProvider(4663, multicall3Adapter);

  const router = new sorModule.AlphaRouter({
    chainId: 4663,
    provider,
    multicall2Provider: multicall3Adapter,
    v3PoolProvider,
    v3SubgraphProvider: new StaticCatalogueSubgraphProvider(),
    tokenPropertiesProvider: new StaticTokenPropertiesProvider(),
    gasPriceProvider: new StaticGasPriceProvider(),
    tokenProvider: new StaticTokenProvider(),
    v4PoolParams: []
  });

  // Custom hop quoter using pinned block number
  let currentLogicalCalls = 0;
  const customQuoteHop = async (pool: any, tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, _c: any) => {
    currentLogicalCalls++;
    const res = await quoteV3Pinned(
      viemClient,
      VERIFIED_ADDRESSES.quoterV2 as `0x${string}`,
      tokenIn,
      tokenOut,
      amountIn,
      pool.feeTier ?? 500,
      pinnedBlockNumber
    );
    return res.kind === "OUT" ? res.amountOut : 0n;
  };

  // 3 representative cases: Cold Case 1, Warmed Case 1 (repeat identical), Case 2 (USDG -> AAPL)
  const testCases = [
    {
      mode: "cold" as const,
      inToken: WETH,
      outToken: AAPL,
      amountInRaw: "1000000000000000", // 0.001 ETH
      amountInFormatted: "0.001 WETH",
      directPool: { pool: "0x8bb3514e2204E1cDF3Ac149EFEe7Ff04D91B719f" as `0x${string}`, feeTier: 500, protocol: "uniswap-v3" as const, quoteAsset: VERIFIED_ADDRESSES.weth as `0x${string}` },
      leg1Pool: { pool: "0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a" as `0x${string}`, feeTier: 500, protocol: "uniswap-v3" as const, quoteAsset: VERIFIED_ADDRESSES.usdg as `0x${string}` },
      leg2Pool: { pool: "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D" as `0x${string}`, feeTier: 500, protocol: "uniswap-v3" as const, quoteAsset: VERIFIED_ADDRESSES.usdg as `0x${string}` },
      bridge: VERIFIED_ADDRESSES.usdg as `0x${string}`,
      bridgeSymbol: "USDG"
    },
    {
      mode: "warm" as const, // EXACT REPEAT OF CASE 1 FOR WARMED MEASUREMENT
      inToken: WETH,
      outToken: AAPL,
      amountInRaw: "1000000000000000",
      amountInFormatted: "0.001 WETH",
      directPool: { pool: "0x8bb3514e2204E1cDF3Ac149EFEe7Ff04D91B719f" as `0x${string}`, feeTier: 500, protocol: "uniswap-v3" as const, quoteAsset: VERIFIED_ADDRESSES.weth as `0x${string}` },
      leg1Pool: { pool: "0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a" as `0x${string}`, feeTier: 500, protocol: "uniswap-v3" as const, quoteAsset: VERIFIED_ADDRESSES.usdg as `0x${string}` },
      leg2Pool: { pool: "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D" as `0x${string}`, feeTier: 500, protocol: "uniswap-v3" as const, quoteAsset: VERIFIED_ADDRESSES.usdg as `0x${string}` },
      bridge: VERIFIED_ADDRESSES.usdg as `0x${string}`,
      bridgeSymbol: "USDG"
    },
    {
      mode: "warm" as const, // CASE 2: USDG -> AAPL
      inToken: USDG,
      outToken: AAPL,
      amountInRaw: "1000000", // 1 USDG
      amountInFormatted: "1.00 USDG",
      directPool: { pool: "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D" as `0x${string}`, feeTier: 500, protocol: "uniswap-v3" as const, quoteAsset: VERIFIED_ADDRESSES.usdg as `0x${string}` },
      leg1Pool: { pool: "0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a" as `0x${string}`, feeTier: 500, protocol: "uniswap-v3" as const, quoteAsset: VERIFIED_ADDRESSES.usdg as `0x${string}` },
      leg2Pool: { pool: "0x8bb3514e2204E1cDF3Ac149EFEe7Ff04D91B719f" as `0x${string}`, feeTier: 500, protocol: "uniswap-v3" as const, quoteAsset: VERIFIED_ADDRESSES.weth as `0x${string}` },
      bridge: VERIFIED_ADDRESSES.weth as `0x${string}`,
      bridgeSymbol: "WETH"
    }
  ];

  let currentPlannerColdTotalMs = 0;
  let currentPlannerWarmedTotalMs = 0;
  let sorColdInitMs = 0;
  let sorWarmedQuoteMs = 0;

  const results: BenchmarkCaseResult[] = [];

  for (let idx = 0; idx < testCases.length; idx++) {
    const c = testCases[idx];

    // ==========================================
    // 1. Current Planner TOTAL SEARCH (Direct + Two-Hop)
    // ==========================================
    currentLogicalCalls = 0;
    const currentPhysBefore = transportMeter.totalPhysicalRequests;
    const currentSearchStart = Date.now();

    // Leg A: Direct quote
    currentLogicalCalls++;
    const directOutcome = await quoteV3Pinned(
      viemClient,
      VERIFIED_ADDRESSES.quoterV2 as `0x${string}`,
      c.inToken.address as `0x${string}`,
      c.outToken.address as `0x${string}`,
      BigInt(c.amountInRaw),
      c.directPool.feeTier,
      pinnedBlockNumber
    );

    const directOutRaw = directOutcome.kind === "OUT" ? directOutcome.amountOut.toString() : "0";
    const directGasEst = directOutcome.kind === "OUT" ? directOutcome.gasEstimate.toString() : "0";

    // Leg B: Two-hop candidate search
    const twoHopOutcome = await quoteMultihopRoutes(
      [
        {
          family: "uniswap",
          protocol: "v3",
          profile: UNISWAP_UR,
          bridge: c.bridge,
          leg1Pool: c.leg1Pool,
          leg2Pool: c.leg2Pool
        }
      ],
      c.inToken.address as `0x${string}`,
      c.outToken.address as `0x${string}`,
      BigInt(c.amountInRaw),
      { client: viemClient, quoteHop: customQuoteHop }
    );

    const twoHopOutRaw = twoHopOutcome.quotes[0]?.amountOut.toString() ?? "0";
    const currentTotalSearchElapsedMs = Date.now() - currentSearchStart;
    const currentTotalPhysRpc = transportMeter.totalPhysicalRequests - currentPhysBefore;
    const currentTotalLogical = currentLogicalCalls;

    // Determine Current Chosen Winner (highest output)
    const bDirect = BigInt(directOutRaw);
    const bTwoHop = BigInt(twoHopOutRaw);
    let currentWinnerRoute: "direct" | "twoHop" = "direct";
    let currentWinnerAmountOut = directOutRaw;
    let currentWinnerPath = `${c.inToken.symbol}/${c.outToken.symbol} (${c.directPool.feeTier})`;

    if (bTwoHop > bDirect) {
      currentWinnerRoute = "twoHop";
      currentWinnerAmountOut = twoHopOutRaw;
      currentWinnerPath = `${c.inToken.symbol}/${c.bridgeSymbol} (${c.leg1Pool.feeTier}) -> ${c.bridgeSymbol}/${c.outToken.symbol} (${c.leg2Pool.feeTier})`;
    }

    if (idx === 0) currentPlannerColdTotalMs = currentTotalSearchElapsedMs;
    if (idx === 1) currentPlannerWarmedTotalMs = currentTotalSearchElapsedMs;

    // ==========================================
    // 2. AlphaRouter SEARCH (Same candidate pool graph)
    // ==========================================
    sorLogicalSubcallsAccumulator = 0;
    const sorPhysBefore = transportMeter.totalPhysicalRequests;
    const sorStart = Date.now();

    const amountInCurrency = CurrencyAmount.fromRawAmount(c.inToken, c.amountInRaw);
    const route = await router.route(
      amountInCurrency,
      c.outToken,
      TradeType.EXACT_INPUT,
      undefined,
      {
        protocols: [Protocol.V3],
        maxSwapsPerPath: 2,
        minSplits: 1,
        maxSplits: 1,
        distributionPercent: 100,
        blockNumber: Number(pinnedBlockNumber)
      }
    );

    const sorSearchElapsedMs = Date.now() - sorStart;
    const sorPhysRpc = transportMeter.totalPhysicalRequests - sorPhysBefore;
    const sorLogical = sorLogicalSubcallsAccumulator;

    if (idx === 0) sorColdInitMs = sorSearchElapsedMs;
    if (idx === 1) sorWarmedQuoteMs = sorSearchElapsedMs;

    const sorWinnerOutRaw = route ? route.quote.quotient.toString() : "0";
    const sorGasEst = route ? route.estimatedGasUsed.toString() : "0";
    const sorHops = route ? route.route[0].route.pools.length : 0;
    const sorPath = route ? route.route[0].route.pools.map((p: any) => `${p.token0.symbol}/${p.token1.symbol} (${p.fee})`).join(" -> ") : "none";

    // Parity calculation between Chosen Winners
    const bCurrentWinner = BigInt(currentWinnerAmountOut);
    const bSorWinner = BigInt(sorWinnerOutRaw);
    const diffBps = bCurrentWinner > 0n ? Number(((bSorWinner - bCurrentWinner) * 10000n) / bCurrentWinner) : 0;
    const latencyRatio = currentTotalSearchElapsedMs > 0 ? Number((sorSearchElapsedMs / currentTotalSearchElapsedMs).toFixed(2)) : 0;

    const executionBefore = transportMeter.totalPhysicalRequests;
    const executionInput = { tokenIn: c.inToken.address as `0x${string}`, tokenOut: c.outToken.address as `0x${string}`, amountIn: BigInt(c.amountInRaw), block: pinnedBlockNumber };
    const currentExecution = await simulateSelectedV3Route(provider.send.bind(provider), {
      ...executionInput, fees: currentWinnerRoute === "direct" ? [c.directPool.feeTier] : [c.leg1Pool.feeTier, c.leg2Pool.feeTier],
      ...(currentWinnerRoute === "twoHop" ? { bridge: c.bridge } : {}),
    });
    const sorPools = route?.route[0]?.route.pools ?? [];
    const sorFirst = sorPools[0];
    const sorBridge = sorHops === 2 ? (sorFirst.token0.address.toLowerCase() === c.inToken.address.toLowerCase() ? sorFirst.token1.address : sorFirst.token0.address) : undefined;
    const sorExecution = await simulateSelectedV3Route(provider.send.bind(provider), {
      ...executionInput, fees: sorPools.map((p: any) => p.fee), ...(sorBridge ? { bridge: sorBridge } : {}),
    });
    results.push({
      caseIndex: idx + 1,
      mode: c.mode,
      tokenInSymbol: c.inToken.symbol,
      tokenOutSymbol: c.outToken.symbol,
      amountInFormatted: c.amountInFormatted,
      amountInRaw: c.amountInRaw,
      pinnedBlockNumber: pinnedBlockNumber.toString(),
      currentPlannerSearch: {
        chosenRoute: currentWinnerRoute,
        chosenAmountOutRaw: currentWinnerAmountOut,
        chosenPath: currentWinnerPath,
        directQuote: {
          amountOutRaw: directOutRaw,
          gasEstimate: directGasEst
        },
        twoHopQuote: {
          amountOutRaw: twoHopOutRaw,
          bridgeSymbol: c.bridgeSymbol
        },
        totalSearchElapsedMs: currentTotalSearchElapsedMs,
        physicalRpcRequests: currentTotalPhysRpc,
        logicalSubcalls: currentTotalLogical
      },
      alphaRouterSearch: {
        chosenRoute: `${sorHops}-hop`,
        chosenAmountOutRaw: sorWinnerOutRaw,
        chosenPath: sorPath,
        hops: sorHops,
        estimatedGasUsed: sorGasEst,
        searchElapsedMs: sorSearchElapsedMs,
        physicalRpcRequests: sorPhysRpc,
        logicalSubcalls: sorLogical
      },
      parityDeltaBps: diffBps,
      latencyRatioSorVsCurrent: latencyRatio,
      executionStatus: currentExecution.status === "simulated" && sorExecution.status === "simulated" ? "SIMULATED via shared app execution builder, synthetic funded account, 1% fee, minOut=1" : "PARTIAL; inspect executionComparison",
      executionComparison: { current: currentExecution, sorSelected: sorExecution, httpRequests: transportMeter.totalPhysicalRequests - executionBefore }
    });
  }

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    chainId: 4663,
    pinnedBlockNumber: pinnedBlockNumber.toString(),
    fixtureSnapshot: {
      sorPackageVersion: "@uniswap/smart-order-router@4.31.10",
      sdkCoreVersion: "@uniswap/sdk-core@7.5.0",
      ethersVersion: "ethers@5.7.2",
      pinnedBlockNumber: pinnedBlockNumber.toString(),
      sourcePools: KNOWN_V3_POOLS.map((p) => ({
        id: p.id,
        feeTier: p.feeTier,
        token0: p.token0.id,
        token1: p.token1.id,
        syntheticTvl: true
      }))
    },
    sorConfig: {
      maxSwapsPerPath: 2,
      minSplits: 1,
      maxSplits: 1,
      distributionPercent: 100
    },
    unsupportedChainBlockersIdentified: [
      "ID_TO_NETWORK_NAME(4663) throws 'Unknown chain id: 4663'",
      "ID_TO_CHAIN_ID(4663) throws 'Unknown chain id: 4663'",
      "UNISWAP_MULTICALL_ADDRESSES[4663] is missing (Uniswap Multicall 0x1F98... has no bytecode on 4663)",
      "V3_CORE_FACTORY_ADDRESSES[4663] is undefined",
      "NEW_QUOTER_V2_ADDRESSES[4663] is undefined",
      "WRAPPED_NATIVE_CURRENCY[4663] is undefined",
      "usdGasTokensByChain[4663] is undefined (getHighestLiquidityV3USDPool throws)",
      "gas-costs.js (COST_PER_HOP, COST_PER_INIT_TICK, BASE_SWAP_COST, SINGLE_HOP_OVERHEAD) returns undefined on switch(chainId)",
      "No cloudflare-ipfs subgraph endpoint for Robinhood chain pool search"
    ],
    adapterOverridesApplied: [
      "Injected network name 'robinhood' and chain id 4663 into chains.ts mappings",
      "Registered V3 Core Factory (0x1f7d7550B1b028f7571E69A784071F0205FD2EfA) and QuoterV2 (0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7)",
      "Mapped canonical Multicall3 (0xca11bde05977b3631167028862be2a173976ca11) with aggregate3-based IMulticallProvider adapter",
      "Registered WETH (0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73) and USDG (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) gas token list",
      "Injected synthetic heuristic gas-costs.js baseline constants for chain 4663 (COST_PER_HOP=80000, COST_PER_INIT_TICK=31000, BASE_SWAP_COST=5000)",
      "Supplied StaticCatalogueSubgraphProvider consuming verified pool catalogue with synthetic TVL fixtures",
      "Explicitly omitted SWAP_ROUTER_02 alias to Universal Router (no transaction building via this override)"
    ],
    timings: {
      currentPlannerColdTotalMs,
      currentPlannerWarmedTotalMs,
      sorColdInitMs,
      sorWarmedQuoteMs
    },
    totalRpcCallsUsed: {
      physicalRequests: transportMeter.totalPhysicalRequests,
      cap: transportMeter.cap,
      capEnforced: true,
      maxConcurrency: transportMeter.maxConcurrency,
      methodCounts: { ...transportMeter.methodCounts }
    },
    simulationEvidence: {
      status: results.every((r) => r.executionStatus.startsWith("SIMULATED")) ? "SIMULATED" : "PARTIAL",
      feasible: results.every((r) => r.executionStatus.startsWith("SIMULATED")),
      reason: "Both selected routes compiled through our Universal Router builder and simulated independently at the pinned block. Synthetic funded account and approvals; 1% app fee, minimum 1 base unit. This tests SOR route selection with our executor, not SOR-generated transaction calldata."
    },
    cases: results
  };

  return report;
}

// Explicit CLI entry point
if (require.main === module) {
  (async () => {
    console.log("=== Starting Repaired Uniswap SOR vs Current Planner Benchmark Spike ===");
    const report = await runBenchmark();

    const evidencePath = path.join(
      process.cwd(),
      "/tmp/robincalls-swap-sor-benchmark-evidence.json"
    );
    fs.writeFileSync(evidencePath, JSON.stringify(report, null, 2), "utf8");
    console.log(`Saved benchmark evidence to: ${evidencePath}`);

    console.log("\n=== Benchmark Summary ===");
    console.log(`Pinned Block Number: ${report.pinnedBlockNumber}`);
    console.log(`Total Physical RPC Requests: ${report.totalRpcCallsUsed.physicalRequests} / ${report.totalRpcCallsUsed.cap} (Max Concurrency: ${report.totalRpcCallsUsed.maxConcurrency})`);
    console.log(`Method Counts:`, report.totalRpcCallsUsed.methodCounts);

    for (const c of report.cases) {
      console.log(`\nCase ${c.caseIndex} [${c.mode.toUpperCase()}]: ${c.tokenInSymbol} -> ${c.tokenOutSymbol} (${c.amountInFormatted})`);
      console.log(`- Current Total Search: ${c.currentPlannerSearch.chosenAmountOutRaw} via ${c.currentPlannerSearch.chosenRoute} [${c.currentPlannerSearch.chosenPath}] (${c.currentPlannerSearch.totalSearchElapsedMs}ms, ${c.currentPlannerSearch.physicalRpcRequests} phys RPC)`);
      console.log(`  * Direct candidate: ${c.currentPlannerSearch.directQuote.amountOutRaw}`);
      console.log(`  * TwoHop candidate: ${c.currentPlannerSearch.twoHopQuote.amountOutRaw} (via ${c.currentPlannerSearch.twoHopQuote.bridgeSymbol})`);
      console.log(`- AlphaRouter (SOR):    ${c.alphaRouterSearch.chosenAmountOutRaw} via ${c.alphaRouterSearch.chosenRoute} [${c.alphaRouterSearch.chosenPath}] (${c.alphaRouterSearch.searchElapsedMs}ms, ${c.alphaRouterSearch.physicalRpcRequests} phys RPC)`);
      console.log(`- Parity Delta:         ${c.parityDeltaBps} bps`);
      console.log(`- Latency Ratio (SOR/Current): ${c.latencyRatioSorVsCurrent}x`);
    }

    console.log(`\nTimings:`);
    console.log(`- Cold: Current Total Search ${report.timings.currentPlannerColdTotalMs}ms | SOR ${report.timings.sorColdInitMs}ms`);
    console.log(`- Warm (Repeat Case 1): Current Total Search ${report.timings.currentPlannerWarmedTotalMs}ms | SOR ${report.timings.sorWarmedQuoteMs}ms`);
    console.log(`\nExecutable Simulation Status: ${report.simulationEvidence.status} (${report.simulationEvidence.reason})`);
  })().catch((err) => {
    console.error("Benchmark failed with error:", err);
    process.exit(1);
  });
}
