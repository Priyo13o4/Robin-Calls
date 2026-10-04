// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeFunctionData, getAddress, parseAbi, parseTransaction } from "viem";

import type { Redis } from "ioredis";

import { redisClient } from "@/lib/redis/client";

import { recordSequencerMetric } from "@/lib/data/sequencer";

import { COMMON_BASES_BY_CHAIN } from "@/lib/trade/types";

import { ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";

import { recoverSenderSync } from "./decoder";

import type { SequencerTransaction } from "./types";

import { BOT_LIFETIME_TXS } from "@/lib/trade/wallet-tags";

export const WATCH_KEY = "trades:watch";

export const TXCOUNT_PREFIX = "trades:txcount:";

export const TXCOUNT_TTL_S = 6 * 3600;

export const txCountTtl = (n: number): any => {
  throw new NotImplementedInPublicBuild("lib/sequencer/trade-senders.ts#txCountTtl");
};

export const WATCH_TTL_MS = 120_000;

export const SENDER_TTL_S = 600;

export const MAX_WATCHED = 200;

export const MAX_WATCH_POOLS = 6;

export const REGISTER_WATCH_LUA = {} as any;

export interface TradeSender {
  hash: string;
  from: string;
  /** "userop": the smart wallet named in an EntryPoint bundle, not the bundler that sent it. */
  via: "tx" | "userop";
  /** The tx nonce: how many txs this wallet had sent before. Absent for userops (a 4337 nonce is not a count). */
  nonce?: number;
}

export function needlesFor(token: string, pools: readonly string[]): string[] {
  throw new NotImplementedInPublicBuild("lib/sequencer/trade-senders.ts#needlesFor");
}

export function matchTradeSenders(txs: readonly SequencerTransaction[], needles: readonly string[]): TradeSender[] {
  throw new NotImplementedInPublicBuild("lib/sequencer/trade-senders.ts#matchTradeSenders");
}

export const tradeSenderMetrics = {} as any;

export async function recordTradeSenders(txs: readonly SequencerTransaction[]): Promise<number> {
  throw new NotImplementedInPublicBuild("lib/sequencer/trade-senders.ts#recordTradeSenders");
}

export async function watchTradeToken(token: string, pools: readonly string[]): Promise<boolean> {
  throw new NotImplementedInPublicBuild("lib/sequencer/trade-senders.ts#watchTradeToken");
}

export async function registerTradeTokenWatch(redis: Pick<Redis, "eval">, token: string, pools: readonly string[], now: any = undefined as any): Promise<boolean> {
  throw new NotImplementedInPublicBuild("lib/sequencer/trade-senders.ts#registerTradeTokenWatch");
}

export async function readTradeSenders(hashes: readonly string[]): Promise<Record<string, { from: string; via: string }>> {
  throw new NotImplementedInPublicBuild("lib/sequencer/trade-senders.ts#readTradeSenders");
}

export async function readWalletTxCounts(wallets: readonly string[]): Promise<Map<string, number>> {
  throw new NotImplementedInPublicBuild("lib/sequencer/trade-senders.ts#readWalletTxCounts");
}

export async function writeWalletTxCounts(counts: ReadonlyMap<string, number>): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/sequencer/trade-senders.ts#writeWalletTxCounts");
}