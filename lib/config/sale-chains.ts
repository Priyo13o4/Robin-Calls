import {
  robinhoodChain,
  robinhoodTestnetChain,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_TESTNET_CHAIN_ID,
} from "@/lib/config/chain";
import type { Chain } from "viem";

/**
 * Explorer + default-chain helpers for the token-sale surface only. The chain
 * definitions themselves (mainnet, testnet, `walletNetworks`) live in
 * `lib/config/chain.ts` — wallet connect must not hang off a sale-named file.
 */

export { ROBINHOOD_TESTNET_CHAIN_ID, ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";

export const KNOWN_SALE_CHAINS: Record<number, Chain> = {
  [ROBINHOOD_CHAIN_ID]: robinhoodChain,
  [ROBINHOOD_TESTNET_CHAIN_ID]: robinhoodTestnetChain,
};

export const saleExplorerUrl = (chainId: number) => {
  const chain = KNOWN_SALE_CHAINS[chainId] ?? robinhoodChain;
  return chain.blockExplorers?.default.url ?? "https://robinhoodchain.blockscout.com";
};

export const explorerTxUrl = (chainId: number, hash: string) =>
  `${saleExplorerUrl(chainId)}/tx/${hash}`;

/** The chain an unconfigured wallet lands on: always mainnet unless testing. */
export const DEFAULT_SALE_CHAIN_ID = ROBINHOOD_CHAIN_ID;
