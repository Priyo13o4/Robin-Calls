// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { randomBytes } from "crypto";

import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  numberToHex,
  parseEther,
} from "viem";

import { rpc } from "../rpc/client";

import { erc20Abi } from "../rpc/abis";

export function randomSimWallet(): `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/dex/erc20-sim.ts#randomSimWallet");
}

export const SIM_WALLET = "0x1337000000000000000000000000000000001337" as const;

export function mappingSlot(key: `0x${string}`, baseSlot: bigint): `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/dex/erc20-sim.ts#mappingSlot");
}

export function nestedMappingSlot(ownerKey: `0x${string}`, spenderKey: `0x${string}`, baseSlot: bigint): `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/dex/erc20-sim.ts#nestedMappingSlot");
}

export const MAX_SLOT_PROBE = 12n;

export function tokenUnit(decimals: number | null | undefined): bigint {
  throw new NotImplementedInPublicBuild("lib/dex/erc20-sim.ts#tokenUnit");
}

export async function findBalanceSlot(token: `0x${string}`, probe: `0x${string}`, overrideBalance: bigint): Promise<bigint | null> {
  throw new NotImplementedInPublicBuild("lib/dex/erc20-sim.ts#findBalanceSlot");
}

export async function findAllowanceSlot(token: `0x${string}`, probe: `0x${string}`, spender: `0x${string}`, overrideBalance: bigint): Promise<bigint | null> {
  throw new NotImplementedInPublicBuild("lib/dex/erc20-sim.ts#findAllowanceSlot");
}

export function buildSellOverrides(token: `0x${string}`, wallet: `0x${string}`, spender: `0x${string}`, balanceSlot: bigint, allowanceSlot: bigint | null, overrideBalance: bigint): any {
  throw new NotImplementedInPublicBuild("lib/dex/erc20-sim.ts#buildSellOverrides");
}