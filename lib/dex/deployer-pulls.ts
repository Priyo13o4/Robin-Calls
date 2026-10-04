// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeEventLog, encodePacked, keccak256, parseAbiItem, type Abi, type Log } from "viem";

import { explorer } from "../explorer/router";

import type { ExplorerTx } from "../explorer/types";

import { rpc } from "../rpc/client";

import { addresses } from "../config/chain";

import { erc20Abi, transferEvent, v3BurnEvent, v3PoolStateAbi, v4ModifyLiquidityEvent, v4StateViewAbi } from "../rpc/abis";

import type { AttributedPull, PullProtocol } from "./liquidity-pulls";

import type { PoolRef } from "./types";

import { KNOWN_BATCHERS } from "./pool-origin";

export const MAX_PULL_RECEIPTS = 60;

export const DUST_PULL_SUPPLY_BPS = 10n;

export interface PullPools {
  v2: ReadonlySet<string>;
  v3: ReadonlyMap<string, "uniswap-v3" | "slipstream-cl">;
  v4: ReadonlySet<string>;
}

export function pullPoolsFrom(refs: readonly PoolRef[]): PullPools {
  throw new NotImplementedInPublicBuild("lib/dex/deployer-pulls.ts#pullPoolsFrom");
}

export interface ReceiptPull extends AttributedPull {
  /** Token units that left the pool in this removal; null when the receipt does not say. */
  tokenAmount: string | null;
  /** The pool's own record of the position, so "closed completely" is read, never assumed. */
  position?: { owner: string; tickLower: number; tickUpper: number; salt?: string };
}

type ReceiptLog = Pick<Log, "address" | "topics" | "data" | "logIndex">;

export function pullsFromReceipt(input: {
  token: string;
  txHash: string;
  block: number;
  by: string;
  logs: readonly ReceiptLog[];
  pools: PullPools;
  /** token0 side per V2/V3 pool, lowercased; absent = unknown side. */
  tokenIsToken0: ReadonlyMap<string, boolean>;
  poolManager?: string;
}): ReceiptPull[] {
  throw new NotImplementedInPublicBuild("lib/dex/deployer-pulls.ts#pullsFromReceipt");
}

export function rankPullCandidates(txs: readonly ExplorerTx[], fromBlock: number | null): ExplorerTx[] {
  throw new NotImplementedInPublicBuild("lib/dex/deployer-pulls.ts#rankPullCandidates");
}

export interface DeployerSidePulls {
  /** OK: every subject's history since the lower bound and every candidate receipt was read. */
  status: "OK" | "PARTIAL" | "UNAVAILABLE";
  pulls: ReceiptPull[];
  /** Pulls under DUST_PULL_SUPPLY_BPS of supply: recorded, never accusing. */
  dust: ReceiptPull[];
  receiptsRead: number;
  /** Gaps that forbid an all-clear, in the `venuesUnread` vocabulary. */
  unread: string[];
}

export interface DeployerPullDeps {
  history(subject: string): Promise<{ items: ExplorerTx[]; complete: boolean } | null>;
  receipt(hash: string): Promise<{ blockNumber: bigint; logs: ReceiptLog[] } | null>;
  /** Liquidity left in the pulled position at the pull's block (V2: the signer's LP balance); null = could not read. */
  remaining(pull: ReceiptPull): Promise<bigint | null>;
}

export async function readDeployerSidePulls(input: {
  token: string;
  subjects: readonly string[];
  pools: PullPools;
  tokenIsToken0: ReadonlyMap<string, boolean>;
  /** No removal can precede the token's first pool; null = read everything we can. */
  fromBlock: number | null;
  totalSupply: bigint | null;
  poolManager?: string;
  deps?: Partial<DeployerPullDeps>;
}): Promise<DeployerSidePulls> {
  throw new NotImplementedInPublicBuild("lib/dex/deployer-pulls.ts#readDeployerSidePulls");
}