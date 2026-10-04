// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";

import { rpc } from "../rpc/client";

import { addresses, isAddressConfigured } from "../config/chain";

import { isTransientRpcError } from "../rpc/fault";

import { erc20Abi, v2Router02Abi, v2PairAbi } from "../rpc/abis";

import {
  randomSimWallet,
  tokenUnit,
  findBalanceSlot,
  findAllowanceSlot,
  buildSellOverrides,
} from "./erc20-sim";

import {
  differentialSell,
  isInsufficientFundsError,
  resolveSimEnv,
  txFields,
  worstSensitivity,
  type SimEnv,
} from "./sim-env";

import type { SellSim } from "./types";

interface WalletSell {
  wallet: string;
  ok: boolean;
  feeOnTransfer: boolean;
  /** true when the revert was liquidity-related (thin pool), not a transfer block */
  liquidityRevert: boolean;
  /** The simulation never reached the node — `ok: false` proves nothing here. */
  faulted?: boolean;
  detail: string;
  amountOut?: string;
}

export interface V2SimDeployment {
  router: `0x${string}`;
  weth: `0x${string}`;
}

export type BuyerSell =
  | { kind: "sold" }
  | { kind: "reverted"; detail: string }
  | { kind: "unavailable"; detail: string };

type SimCall = { status: "success" | "failure"; data: Hex };

type SimulateBlocks = (args: Record<string, unknown>) => Promise<{ calls: SimCall[] }[]>;

export async function buyerSellV2(token: `0x${string}`, deployment: V2SimDeployment, env: SimEnv, simulate: SimulateBlocks = undefined as any, nowMs: any = undefined as any): Promise<BuyerSell> {
  throw new NotImplementedInPublicBuild("lib/dex/v2-sim.ts#buyerSellV2");
}

export function classifyBuyOnly(buyer: BuyerSell, evidence: Record<string, unknown>): SellSim {
  throw new NotImplementedInPublicBuild("lib/dex/v2-sim.ts#classifyBuyOnly");
}

export async function runV2SellSim(token: `0x${string}`, pair: `0x${string}`, deployment?: V2SimDeployment, reads?: {
    reserves?: () => Promise<readonly [bigint, bigint, number]>;
    decimals?: () => Promise<number>;
    balanceSlot?: (owner: `0x${string}`, amount: bigint) => Promise<bigint | null>;
    buyerSell?: (env: SimEnv) => Promise<BuyerSell>;
  }): Promise<SellSim> {
  throw new NotImplementedInPublicBuild("lib/dex/v2-sim.ts#runV2SellSim");
}