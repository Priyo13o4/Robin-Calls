import { defineChain } from "viem";
import { firstSet } from "./env";

/**
 * Robinhood Chain — Arbitrum Orbit L2, chain id 4663.
 * The only chain RobinCalls operates on (PRD §2 locked decision). The testnet
 * below exists solely for token-sale testing and is build-gated out of
 * production bundles.
 */
export const ROBINHOOD_CHAIN_ID = 4663;

/**
 * Robinhood Chain Testnet — the token sale is walked through its lifecycle here
 * before mainnet. This definition ships in EVERY bundle (the URLs below have
 * public fallbacks); what production withholds is only the build-args, per
 * tests/testnet-build-lane.test.ts. What keeps a production page off testnet is
 * `site_config.token_sale_chain_id`, nothing here.
 */
export const ROBINHOOD_TESTNET_CHAIN_ID = 46630;

const testnetRpc =
  process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL?.trim() ||
  "https://rpc.testnet.chain.robinhood.com";

const testnetExplorer =
  process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_EXPLORER_URL?.trim() ||
  "https://explorer.testnet.chain.robinhood.com";

export const robinhoodTestnetChain = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [testnetRpc] } },
  blockExplorers: { default: { name: "Testnet Explorer", url: testnetExplorer } },
  // Multicall3 at its canonical cross-chain address, verified deployed here
  // (3,808 bytes, both 4663 and 46630). viem's `client.multicall` reads it from
  // HERE, not from `addresses.multicall3` below — that one feeds server-side
  // `batchRead`. Without this key the browser path throws
  // ChainDoesNotSupportContract, which `isTransientRpcError` calls transient,
  // so the read never falls back and `view.mine` is never populated at all.
  contracts: { multicall3: { address: "0xca11bde05977b3631167028862be2a173976ca11" } },
});

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  // Two environments read this ONE field, and they must not read the same
  // value. Server-side, ROBINHOOD_RPC_URL wins and may be a keyed provider.
  // In the browser Next inlines only NEXT_PUBLIC_*, so that first term is
  // `undefined` there and the public one is what survives — which is the
  // point, because this field is also the payload of
  // wallet_addEthereumChain: whatever stands here gets WRITTEN INTO the
  // user's wallet and is then used by their own activity forever.
  //
  // So NEXT_PUBLIC_RPC_URL must always be a public, unkeyed endpoint. A keyed
  // URL here would be published in the client bundle and would bill your quota
  // for every visitor's wallet, indefinitely, with no way to retract it.
  //
  // Before this chain, the browser read a server-only var: setting
  // ROBINHOOD_RPC_URL on the VM looked like it configured the wallet and
  // silently did nothing at all.
  rpcUrls: {
    default: {
      http: [
        // firstSet, NOT `??`: the workflow passes a build-arg for every
        // NEXT_PUBLIC_ var whether or not the repo Variable exists, and
        // Dockerfile.prod's `ENV X=$X` turns an unset one into the EMPTY
        // STRING. `"" ?? fallback` is `""`, so the chain shipped with an empty
        // RPC url and the fallback below was unreachable — verified in a real
        // client bundle, not reasoned about.
        firstSet(
          process.env.ROBINHOOD_RPC_URL,
          process.env.NEXT_PUBLIC_RPC_URL,
        ) ?? "https://rpc.mainnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url:
        process.env.EXPLORER_WEB_URL ??
        "https://robinhoodchain.blockscout.com",
    },
  },
  // Multicall3 at its canonical cross-chain address, verified deployed here
  // (3,808 bytes, both 4663 and 46630). viem's `client.multicall` reads it from
  // HERE, not from `addresses.multicall3` below — that one feeds server-side
  // `batchRead`. Without this key the browser path throws
  // ChainDoesNotSupportContract, which `isTransientRpcError` calls transient,
  // so the read never falls back and `view.mine` is never populated at all.
  contracts: { multicall3: { address: "0xca11bde05977b3631167028862be2a173976ca11" } },
});

/**
 * The chain the SALE is on. Not a build flag: it is a column
 * (`site_config.token_sale_chain_id`), resolved server-side by
 * `resolveSaleAddress()` and handed to the browser by RootLayout as
 * `window.__SALE_CHAIN_ID__`.
 *
 * Pass the id whenever you have it. The window read is the fallback for code
 * that runs where no id was threaded through, and it answers mainnet on the
 * server, where that global does not exist.
 */
export function getSaleChain(chainId?: number | null): typeof robinhoodChain | typeof robinhoodTestnetChain {
  if (chainId === ROBINHOOD_TESTNET_CHAIN_ID) return robinhoodTestnetChain;
  if (chainId === ROBINHOOD_CHAIN_ID) return robinhoodChain;
  return activeSaleChain();
}

/**
 * Set by a page whose SERVER render resolved the sale's chain, which beats the
 * injected global: `app/layout.tsx` reads the column at build time, where there
 * is no DATABASE_URL, so every PRERENDERED route ships
 * `__SALE_CHAIN_ID__=null` permanently (measured on dev 2026-09-10: `/` null,
 * force-dynamic `/token-sale` 46630). Deciding a chain from the global alone
 * therefore answers "mainnet" on most of the site, confidently (§8 #9).
 */
let resolvedSaleChainId: number | null = null;
const saleChainListeners = new Set<() => void>();

export function setActiveSaleChainId(chainId: number | null | undefined): void {
  // Browser only: module state on the server is per-process and shared by
  // every concurrent request, so a write here would leak across visitors.
  if (typeof window === "undefined") return;
  if (chainId !== ROBINHOOD_CHAIN_ID && chainId !== ROBINHOOD_TESTNET_CHAIN_ID) return;
  if (resolvedSaleChainId === chainId) return;
  resolvedSaleChainId = chainId;
  for (const listen of saleChainListeners) listen();
}

/** `useSyncExternalStore` seam, so a hook re-renders when the answer improves. */
export function subscribeSaleChainId(onChange: () => void): () => void {
  saleChainListeners.add(onChange);
  return () => {
    saleChainListeners.delete(onChange);
  };
}

/** A FUNCTION, not a constant: the framework's chunk scripts are `async`, so a
 *  module constant can evaluate before the inline script sets the global. */
export function activeSaleChainId(): number {
  if (resolvedSaleChainId !== null) return resolvedSaleChainId;
  if (typeof window !== "undefined") {
    const injected = (window as unknown as { __SALE_CHAIN_ID__?: number | null }).__SALE_CHAIN_ID__;
    if (injected === ROBINHOOD_TESTNET_CHAIN_ID) return ROBINHOOD_TESTNET_CHAIN_ID;
  }
  return ROBINHOOD_CHAIN_ID;
}

export function activeSaleChain(): typeof robinhoodChain | typeof robinhoodTestnetChain {
  return activeSaleChainId() === ROBINHOOD_TESTNET_CHAIN_ID ? robinhoodTestnetChain : robinhoodChain;
}

/**
 * BOTH Robinhood chains, the sale's own first (AppKit's default). Never one
 * entry: wagmi can only switch to a configured chain, and this list is frozen
 * at the first WalletKitProvider render from whatever the global then said. A
 * one-entry list built on a prerendered page pinned wagmi to 4663, made AppKit
 * open its UnsupportedChain view (whose X cannot close it — `safeClose` shakes)
 * and left `switchChain` unable to reach the chain the sale is on.
 * Which chain the sale IS on stays `site_config.token_sale_chain_id`, via
 * `getSaleChain` for reads and `sendTransaction({ chainId })` for sends.
 */
export function walletNetworks(): readonly [
  typeof robinhoodChain | typeof robinhoodTestnetChain,
  ...(typeof robinhoodChain | typeof robinhoodTestnetChain)[],
] {
  return activeSaleChainId() === ROBINHOOD_TESTNET_CHAIN_ID
    ? ([robinhoodTestnetChain, robinhoodChain] as const)
    : ([robinhoodChain, robinhoodTestnetChain] as const);
}

/**
 * Env addresses are lowercased before use: viem rejects mixed-case strings
 * whose EIP-55 checksum doesn't match (a hand-typed .env value would otherwise
 * make every readContract throw), while all-lowercase is always accepted.
 */
const envAddr = (v: string | undefined): `0x${string}` =>
  (v ?? "0x0").trim().toLowerCase() as `0x${string}`;

/** DEX + infra addresses (Uniswap-V3 style). All configurable via env. */
export const addresses = {
  quoterV2: envAddr(process.env.QUOTER_V2_ADDRESS),
  swapRouter: envAddr(process.env.SWAP_ROUTER_ADDRESS),
  positionManager: envAddr(process.env.NONFUNGIBLE_POSITION_MANAGER_ADDRESS),
  v3Factory: envAddr(process.env.V3_FACTORY_ADDRESS),
  weth: envAddr(process.env.WETH_ADDRESS),

  // Uniswap V2 — factory verified on chain 4663 (getPair round-trips against
  // the JOHN/NRV scam pairs). Router02 verified 2026-07-14: factory()/WETH()
  // round-trip OK, so the V2 sell-sim can use the classic supporting-fee swap
  // (PRD §14.6). See lib/dex/v2 + docs/GOTCHAS.md §5.
  v2Factory: envAddr(process.env.V2_FACTORY_ADDRESS),
  v2Router02: envAddr(process.env.V2_ROUTER02_ADDRESS),

  // Uniswap V4 — singleton architecture. There is no per-pool contract to
  // getPool against: every pool lives inside PoolManager keyed by a PoolKey
  // (currency0, currency1, fee, tickSpacing, hooks), and reads/quotes go
  // through the StateView + V4 Quoter periphery. Deployment VERIFIED
  // 2026-07-14: StateView.poolManager() round-trips, getLiquidity reads OK.
  // See lib/dex/v4 + docs/GOTCHAS.md §5a. Market/wash/pump-dump cover V4
  // tokens via the aggregators; the sim itself is still the Wave D remainder.
  v4PoolManager: envAddr(process.env.V4_POOL_MANAGER_ADDRESS),
  v4StateView: envAddr(process.env.V4_STATE_VIEW_ADDRESS),
  v4Quoter: envAddr(process.env.V4_QUOTER_ADDRESS),
  // V4 PositionManager (ERC-721 over singleton positions). OPTIONAL: everything
  // works without it, but the PoolManager's ModifyLiquidity logs name the
  // PositionManager as `sender`, so without this address a V4 NFT position
  // resolves only to "the PositionManager contract" and the wallet behind it
  // stays invisible. Configured, the salt (= bytes32(tokenId)) resolves to the
  // real owner via ownerOf, and §15.10's whale scan works on V4 (see
  // lib/dex/v4-custody.ts).
  v4PositionManager: envAddr(process.env.V4_POSITION_MANAGER_ADDRESS),
  // Uniswap ReservesLens, verified on 4663 2026-09-28. Defaulted, not env-only
  // (§8 #20): unset would silently restore the stale-DexScreener all-clear (L212).
  // A missing deployment reverts, which every caller reads as "not measured".
  v4ReservesLens: envAddr(process.env.V4_RESERVES_LENS_ADDRESS ?? "0x0000001b173C3bbF3984D417d8614E3eed34865B"),

  // Multicall3 — OPTIONAL and deliberately not defaulted to the canonical
  // 0xcA11bde05977b3631167028862bE2a173976CA11. That address is present on most
  // chains, which makes hardcoding it tempting and wrong: an address with no
  // bytecode would turn every batched read into a revert. `lib/rpc/multicall.ts`
  // probes for code once per process and falls back to individual calls when
  // it is absent, so leaving this unset is a supported (just costlier) state.
  multicall3: envAddr(process.env.MULTICALL3_ADDRESS),
} as const;

export const isAddressConfigured = (addr: string) =>
  /^0x[0-9a-fA-F]{40}$/.test(addr) &&
  addr !== "0x0000000000000000000000000000000000000000";

/*
 * `isInfraAsset` / `isTrustedProxyAdmin` deliberately do NOT live here.
 *
 * This module exports plain constants (`explorerWebUrl`,
 * `geckoTerminalNetwork`) that CLIENT components import — see
 * `app/components/site/VerdictView.tsx`. Anything reached from here is reached
 * from the browser bundle, and the trust lookup pulls
 * `lib/config/trusted-addresses.ts` → `lib/rpc/client.ts` →
 * `lib/rpc/provider-pool.ts` → `lib/observability/context.ts`, which imports
 * Node-only `async_hooks`/`crypto`. That combination fails the production
 * Turbopack build while `next dev` and `tsc --noEmit` both stay green, so the
 * only signal is a real `npm run build`.
 *
 * The canonical definitions are the two one-line helpers at the top of
 * `lib/scanner/checks.ts`, which is server-only and is the sole consumer.
 * Both read the DB-backed `trusted_address` cache (categories `infra-asset`
 * and `bridge-system-owner`); nothing is hardcoded and no env var is involved.
 */

export const explorerApiUrl =
  process.env.EXPLORER_API_URL ??
  "https://robinhoodchain.blockscout.com/api/v2";

export const explorerWebUrl =
  process.env.EXPLORER_WEB_URL ??
  "https://robinhoodchain.blockscout.com";

/**
 * Second Blockscout host asked ONLY when the primary reports no verified
 * source. The PRO gateway and the community instance are separate deployments
 * with separate verification stores: measured 2026-08-17 over all 57 scanned
 * tokens, the PRO API had no `/smart-contracts` row for LadyMarian (FULL) or
 * LaunchToken (PARTIAL) while the community instance served both, so the audit
 * ran source-less and a partial match published as an unqualified "verified".
 * Equal to `explorerApiUrl` in local/dev; `verifiedFallbackBase()` skips the
 * second call in that case.
 */
export const explorerFallbackApiUrl =
  process.env.EXPLORER_FALLBACK_API_URL ??
  "https://robinhoodchain.blockscout.com/api/v2";

export const geckoTerminalNetwork =
  process.env.GECKOTERMINAL_NETWORK ?? "robinhood";

/** Dead / burn addresses excluded from holder-concentration math. */
export const DEAD_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);
